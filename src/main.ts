import { TokenStorage } from './token/token-storage';
import { getCache } from './cache/get-cache';
import { CacheFile } from './cache/cache-file.interface';
import { writeCache } from './cache/write-cache';
import { TokenPermission } from './token/token-interfaces';
import { addToken } from './token/add-token';
import { deleteToken } from './token/delete-token';
import { createCacheStorage } from './cache/create-cache-storage';
import { listTokens } from './token/list-tokens';
import { logger } from './logger';
import { internalServerError, notFoundError } from './responses';
import { isValidHash } from './cache/is-valid-hash';
import { safeEqual } from './safe-equal';
import { MetricsRegistry } from './metrics/metrics-registry';
import { getMetrics } from './metrics/get-metrics';
import { getHealth } from './health/get-health';
import { loadTlsConfig, type TlsConfig } from './tls/load-tls-config';

const ADMIN_TOKEN = Bun.env.ADMIN_TOKEN;
const PORT = Number(Bun.env.PORT ?? '3000');
const HOSTNAME = Bun.env.BIND_ADDRESS ?? '0.0.0.0';
const TOKENS_DB_PATH = Bun.env.TOKENS_DB_PATH;
const MAX_UPLOAD_BYTES = Number(Bun.env.MAX_UPLOAD_BYTES ?? '524288000');
const storage = createCacheStorage(Bun.env);
const tokenStorage = new TokenStorage(TOKENS_DB_PATH);
const metrics = new MetricsRegistry();

if (isNaN(PORT) || PORT <= 0 || PORT >= 65536) {
  logger.error('Error: PORT environment variable must be a valid port number.');
  process.exit(1);
}

if (!Number.isFinite(MAX_UPLOAD_BYTES) || MAX_UPLOAD_BYTES <= 0) {
  logger.error('Error: MAX_UPLOAD_BYTES environment variable must be a positive number.');
  process.exit(1);
}

if (!ADMIN_TOKEN) {
  logger.error('Error: ADMIN_TOKEN environment variable must be set.');
  process.exit(1);
}

let tls: TlsConfig | undefined;
try {
  tls = await loadTlsConfig(Bun.env);
} catch (error) {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const getCacheFile = (hash: string): CacheFile => ({
  valid: () => isValidHash(hash),
  exists: () => storage.exists(hash),
  stream: () => storage.getStream(hash),
  size: () => storage.getSize(hash),
  writeStream: (stream: ReadableStream<Uint8Array>) => storage.writeStream(hash, stream),
});

const isAdmin = (token: string) => safeEqual(token, ADMIN_TOKEN ?? '');

function getAuthToken(headers: Request['headers']): string {
  const header = headers.get('Authorization');
  if (!header) return '';

  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return '';

  return (m[1] ?? '').trim();
}

const getTokenPermission = (headers: Headers): TokenPermission => {
  const tokenValue = getAuthToken(headers);
  if (isAdmin(tokenValue)) {
    return 'full';
  }
  return tokenValue ? tokenStorage.findToken(tokenValue)?.permission : null;
};

// Track in-flight uploads so shutdown can drain them. Bun's `server.stop()`
// closes active connections, so a graceful shutdown must wait for active
// writes to finish *before* calling it — otherwise SIGTERM during a rolling
// update aborts a cache write mid-stream.
let activeUploads = 0;
const drainWaiters = new Set<() => void>();
const uploadFinished = () => {
  activeUploads--;
  if (activeUploads === 0) {
    for (const resolve of drainWaiters) resolve();
    drainWaiters.clear();
  }
};
const waitForUploadsToDrain = (): Promise<void> =>
  activeUploads === 0 ? Promise.resolve() : new Promise((resolve) => drainWaiters.add(resolve));

export const server = Bun.serve({
  port: PORT,
  hostname: HOSTNAME,
  ...(tls ? { tls } : {}),
  routes: {
    '/health': {
      GET: () => getHealth(),
    },
    '/metrics': {
      GET: () => getMetrics(metrics),
    },
    '/v1/cache/:hash': {
      GET: async ({ params, headers }) => {
        const tokenPermission = getTokenPermission(headers);
        const cacheFile = getCacheFile(params.hash);

        const response = await getCache(cacheFile, tokenPermission);
        metrics.recordCacheRequest('GET', response.status);
        return response;
      },
      PUT: async ({ headers, params, body }) => {
        activeUploads++;
        try {
          const tokenPermission = getTokenPermission(headers);
          const cacheFile = getCacheFile(params.hash);
          const contentLength = headers.get('Content-Length') ?? '';

          const response = await writeCache(
            cacheFile,
            tokenPermission,
            body,
            contentLength,
            MAX_UPLOAD_BYTES,
          );
          const uploadedBytes = response.status === 200 ? Number(contentLength) || 0 : 0;
          metrics.recordCacheRequest('PUT', response.status, uploadedBytes);
          return response;
        } finally {
          uploadFinished();
        }
      },
    },
    '/v1/admin/tokens/:token': {
      DELETE: ({ params, headers }) => {
        const hasAdminRights = isAdmin(getAuthToken(headers));
        const tokenToDelete = params.token;
        return deleteToken(hasAdminRights, tokenStorage, tokenToDelete);
      },
    },
    '/v1/admin/tokens': {
      GET: ({ headers }) => {
        const hasAdminRights = isAdmin(getAuthToken(headers));
        return listTokens(hasAdminRights, tokenStorage);
      },
      POST: async (request) => {
        const hasAdminRights = isAdmin(getAuthToken(request.headers));
        return addToken(hasAdminRights, tokenStorage, request.json.bind(request));
      },
    },
  },
  fetch() {
    return notFoundError('');
  },
  error(error) {
    logger.error(error);
    return internalServerError('Internal Server Error');
  },
});

logger.info(`Server running at ${server.url}`);

const shutdown = async (signal: string) => {
  logger.info(`Received ${signal}, draining ${activeUploads} in-flight upload(s)`);
  try {
    // Drain active uploads before stopping; `server.stop()` would otherwise
    // close their connections. The orchestrator's termination grace period
    // (e.g. Kubernetes `terminationGracePeriodSeconds`) bounds this wait.
    await waitForUploadsToDrain();
    await server.stop();
    process.exit(0);
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

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
import { getReady } from './ready/get-ready';
import { loadTlsConfig, type TlsConfig } from './tls/load-tls-config';
import type { CacheStorageStrategy } from './cache/storage-strategy/storage-strategy.interface';
import { createCacheEvictor, type CacheEvictor } from './cache/eviction';
import { FileSystemStrategy } from './cache/storage-strategy/file-system';

const ADMIN_TOKEN = Bun.env.ADMIN_TOKEN;
const PORT = Number(Bun.env.PORT ?? '3000');
const HOSTNAME = Bun.env.BIND_ADDRESS ?? '0.0.0.0';
const TOKENS_DB_PATH = Bun.env.TOKENS_DB_PATH;
const MAX_UPLOAD_BYTES = Number(Bun.env.MAX_UPLOAD_BYTES ?? '524288000');
const SHUTDOWN_DRAIN_TIMEOUT_MS = Number(Bun.env.SHUTDOWN_DRAIN_TIMEOUT_MS ?? '30000');
const CACHE_MAX_BYTES = Bun.env.CACHE_MAX_BYTES ? Number(Bun.env.CACHE_MAX_BYTES) : undefined;
const CACHE_TTL_HOURS = Bun.env.CACHE_TTL_HOURS ? Number(Bun.env.CACHE_TTL_HOURS) : undefined;
const CACHE_SWEEP_INTERVAL_MS = Number(Bun.env.CACHE_SWEEP_INTERVAL_MS ?? '60000');

function exitOnError(error: unknown): never {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function requirePositiveNumber(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    logger.error(`Error: ${name} environment variable must be a positive number.`);
    process.exit(1);
  }
}

if (isNaN(PORT) || PORT <= 0 || PORT >= 65536) {
  logger.error('Error: PORT environment variable must be a valid port number.');
  process.exit(1);
}

requirePositiveNumber('MAX_UPLOAD_BYTES', MAX_UPLOAD_BYTES);
requirePositiveNumber('SHUTDOWN_DRAIN_TIMEOUT_MS', SHUTDOWN_DRAIN_TIMEOUT_MS);
if (CACHE_MAX_BYTES !== undefined) requirePositiveNumber('CACHE_MAX_BYTES', CACHE_MAX_BYTES);
if (CACHE_TTL_HOURS !== undefined) requirePositiveNumber('CACHE_TTL_HOURS', CACHE_TTL_HOURS);
requirePositiveNumber('CACHE_SWEEP_INTERVAL_MS', CACHE_SWEEP_INTERVAL_MS);

if (!ADMIN_TOKEN) {
  logger.error('Error: ADMIN_TOKEN environment variable must be set.');
  process.exit(1);
}

if (ADMIN_TOKEN.length < 16) {
  logger.error(
    'Error: ADMIN_TOKEN must be at least 16 characters. Generate one with: openssl rand -hex 32',
  );
  process.exit(1);
}

let storage: CacheStorageStrategy;
try {
  storage = createCacheStorage(Bun.env);
} catch (error) {
  exitOnError(error);
}

let tokenStorage: TokenStorage;
try {
  tokenStorage = new TokenStorage(TOKENS_DB_PATH);
} catch (error) {
  exitOnError(error);
}
const metrics = new MetricsRegistry();

const evictionEnabled = CACHE_MAX_BYTES !== undefined || CACHE_TTL_HOURS !== undefined;
let evictor: CacheEvictor | undefined;
if (evictionEnabled) {
  if (!(storage instanceof FileSystemStrategy)) {
    logger.error(
      'Error: CACHE_MAX_BYTES and CACHE_TTL_HOURS apply only to STORAGE_STRATEGY=filesystem. For object storage, use bucket lifecycle rules instead; see the storage-strategies guide.',
    );
    process.exit(1);
  }
  evictor = createCacheEvictor({
    cacheDir: storage.cacheDir,
    maxBytes: CACHE_MAX_BYTES,
    ttlMs: CACHE_TTL_HOURS !== undefined ? CACHE_TTL_HOURS * 3_600_000 : undefined,
    intervalMs: CACHE_SWEEP_INTERVAL_MS,
    onSweep: (result) => metrics.recordSweep(result),
  });
}

let tls: TlsConfig | undefined;
try {
  tls = await loadTlsConfig(Bun.env);
} catch (error) {
  exitOnError(error);
}

const getCacheFile = (hash: string): CacheFile => ({
  valid: () => isValidHash(hash),
  exists: () => storage.exists(hash),
  stream: () => storage.getStream(hash),
  size: () => storage.getSize(hash),
  writeStream: (stream: ReadableStream<Uint8Array>, contentLength: number) =>
    storage.writeStream(hash, stream, contentLength),
});

const isAdmin = (token: string) => safeEqual(token, ADMIN_TOKEN ?? '');

function getAuthToken(headers: Request['headers']): string {
  const header = headers.get('Authorization');
  if (!header) return '';

  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return '';

  return (m[1] ?? '').trim();
}

const getTokenPermission = (headers: Headers): TokenPermission | null => {
  const tokenValue = getAuthToken(headers);
  if (isAdmin(tokenValue)) {
    return 'full';
  }
  if (!tokenValue) return null;
  return tokenStorage.findToken(tokenValue)?.permission ?? null;
};

// Track in-flight handlers so shutdown can drain them. Bun's `server.stop()`
// closes active connections, so a graceful shutdown must wait for active
// handlers to finish *before* calling it.
let activeRequests = 0;
const drainWaiters = new Set<() => void>();
const requestFinished = () => {
  activeRequests--;
  if (activeRequests === 0) {
    for (const resolve of drainWaiters) resolve();
    drainWaiters.clear();
  }
};
const waitForRequestsToDrain = (): Promise<void> =>
  activeRequests === 0 ? Promise.resolve() : new Promise((resolve) => drainWaiters.add(resolve));

function trackRequest<T>(handler: () => T | Promise<T>): Promise<T> {
  activeRequests++;
  return Promise.resolve().then(handler).finally(requestFinished);
}

export const server = Bun.serve({
  port: PORT,
  hostname: HOSTNAME,
  // Bun's default maxRequestBodySize is 128 MiB and rejects larger bodies
  // before the route handler runs, silently overriding MAX_UPLOAD_BYTES.
  // +1 keeps writeCache's own 413 (with the documented message) authoritative
  // at the boundary; Bun still backstops anything larger.
  maxRequestBodySize: MAX_UPLOAD_BYTES + 1,
  ...(tls ? { tls } : {}),
  routes: {
    '/health': {
      GET: () => trackRequest(getHealth),
    },
    '/ready': {
      GET: () => trackRequest(() => getReady({ tokenStorage, storage })),
    },
    '/metrics': {
      GET: () => trackRequest(() => getMetrics(metrics)),
    },
    '/v1/cache/:hash': {
      GET: ({ params, headers }) =>
        trackRequest(async () => {
          const tokenPermission = getTokenPermission(headers);
          const cacheFile = getCacheFile(params.hash);

          const response = await getCache(cacheFile, tokenPermission);
          metrics.recordCacheRequest('GET', response.status);
          return response;
        }),
      PUT: ({ headers, params, body }) =>
        trackRequest(async () => {
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
        }),
    },
    '/v1/admin/tokens/:id': {
      DELETE: ({ params, headers }) =>
        trackRequest(() => {
          const hasAdminRights = isAdmin(getAuthToken(headers));
          return deleteToken(hasAdminRights, tokenStorage, params.id);
        }),
    },
    '/v1/admin/tokens': {
      GET: ({ headers }) =>
        trackRequest(() => {
          const hasAdminRights = isAdmin(getAuthToken(headers));
          return listTokens(hasAdminRights, tokenStorage);
        }),
      POST: (request) =>
        trackRequest(async () => {
          const hasAdminRights = isAdmin(getAuthToken(request.headers));
          return addToken(hasAdminRights, tokenStorage, request.json.bind(request));
        }),
    },
  },
  fetch() {
    return trackRequest(() => notFoundError(''));
  },
  error(error) {
    logger.error(error);
    return internalServerError('Internal Server Error');
  },
});

logger.info(`Server running at ${server.url}`);

evictor?.start();

const shutdown = async (signal: string) => {
  evictor?.stop();
  logger.info(`Received ${signal}, draining ${activeRequests} in-flight request(s)`);
  try {
    // Bound both route-handler drain and Bun's connection drain; streamed
    // responses can outlive the handler promise tracked above. Start
    // `server.stop(false)` immediately so new connections are refused while
    // existing requests are allowed to finish.
    const gracefulStop = Promise.all([server.stop(false), waitForRequestsToDrain()]);
    const stoppedGracefully = await Promise.race([
      gracefulStop.then(() => true),
      Bun.sleep(SHUTDOWN_DRAIN_TIMEOUT_MS).then(() => false),
    ]);

    if (!stoppedGracefully) {
      logger.error(`Graceful shutdown exceeded ${SHUTDOWN_DRAIN_TIMEOUT_MS}ms; forcing close`);
      void gracefulStop.catch(() => {});
      await server.stop(true);
    }
    process.exit(0);
  } catch (error) {
    exitOnError(error);
  }
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

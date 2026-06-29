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

export const server = Bun.serve({
  port: PORT,
  hostname: HOSTNAME,
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

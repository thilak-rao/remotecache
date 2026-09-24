import { TokenStorage } from './token/token-storage';
import { getCache } from './cache/get-cache';
import { CacheFile } from './cache/cache-file.interface';
import { writeCache } from './cache/write-cache';
import { resolveToken } from './token/resolve-token';
import { addToken } from './token/add-token';
import { deleteToken } from './token/delete-token';
import { createCacheStorage } from './cache/create-cache-storage';
import { listTokens } from './token/list-tokens';
import { logger } from './logger';
import { internalServerError, notFoundError } from './responses';
import { AuthThrottle, throttleAuthFailure } from './auth-throttle';
import { bindAddress, listenPort } from './config';
import { isValidHash } from './cache/is-valid-hash';
import { MetricsRegistry } from './metrics/metrics-registry';
import { getMetrics } from './metrics/get-metrics';
import { getHealth } from './health/get-health';
import { getReady } from './ready/get-ready';
import { loadTlsConfig, type TlsConfig } from './tls/load-tls-config';
import type { CacheStorageStrategy } from './cache/storage-strategy/storage-strategy.interface';
import { createCacheEvictor, type CacheEvictor } from './cache/eviction';
import { FileSystemStrategy } from './cache/storage-strategy/file-system';

const ADMIN_TOKEN = Bun.env.ADMIN_TOKEN;
const PORT = listenPort(Bun.env);
const HOSTNAME = bindAddress(Bun.env);
const TOKENS_DB_PATH = Bun.env.TOKENS_DB_PATH;
const MAX_UPLOAD_BYTES = Number(Bun.env.MAX_UPLOAD_BYTES ?? '524288000');
const SHUTDOWN_DRAIN_TIMEOUT_MS = Number(Bun.env.SHUTDOWN_DRAIN_TIMEOUT_MS ?? '30000');
const CACHE_MAX_BYTES = Bun.env.CACHE_MAX_BYTES ? Number(Bun.env.CACHE_MAX_BYTES) : undefined;
const CACHE_TTL_HOURS = Bun.env.CACHE_TTL_HOURS ? Number(Bun.env.CACHE_TTL_HOURS) : undefined;
const CACHE_SWEEP_INTERVAL_MS = Number(Bun.env.CACHE_SWEEP_INTERVAL_MS ?? '60000');
const CACHE_TTL_MS = CACHE_TTL_HOURS !== undefined ? CACHE_TTL_HOURS * 3_600_000 : undefined;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

function exitOnError(error: unknown, context?: string): never {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(context ? `${context}: ${message}` : message);
  process.exit(1);
}

function requirePositiveNumber(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    logger.error(`Error: ${name} environment variable must be a positive number.`);
    process.exit(1);
  }
}

function requirePositiveInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    logger.error(`Error: ${name} environment variable must be a positive integer.`);
    process.exit(1);
  }
}

if (!Number.isInteger(PORT) || PORT <= 0 || PORT >= 65536) {
  logger.error('Error: PORT environment variable must be a valid port number.');
  process.exit(1);
}

requirePositiveInteger('MAX_UPLOAD_BYTES', MAX_UPLOAD_BYTES);
requirePositiveInteger('SHUTDOWN_DRAIN_TIMEOUT_MS', SHUTDOWN_DRAIN_TIMEOUT_MS);
if (CACHE_MAX_BYTES !== undefined) requirePositiveInteger('CACHE_MAX_BYTES', CACHE_MAX_BYTES);
if (CACHE_TTL_HOURS !== undefined) requirePositiveNumber('CACHE_TTL_HOURS', CACHE_TTL_HOURS);
requirePositiveInteger('CACHE_SWEEP_INTERVAL_MS', CACHE_SWEEP_INTERVAL_MS);
if (CACHE_TTL_MS !== undefined && !Number.isFinite(CACHE_TTL_MS)) {
  logger.error(
    'Error: CACHE_TTL_HOURS environment variable is too large to convert to milliseconds.',
  );
  process.exit(1);
}
if (CACHE_SWEEP_INTERVAL_MS > MAX_TIMER_DELAY_MS) {
  logger.error(
    `Error: CACHE_SWEEP_INTERVAL_MS environment variable must not exceed ${MAX_TIMER_DELAY_MS}.`,
  );
  process.exit(1);
}

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
  exitOnError(error, 'Error: cannot open the token database (TOKENS_DB_PATH)');
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
    ttlMs: CACHE_TTL_MS,
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

const authThrottle = new AuthThrottle();

function getAuthToken(headers: Request['headers']): string {
  const header = headers.get('Authorization');
  if (!header) return '';

  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return '';

  return (m[1] ?? '').trim();
}

// Resolves the request's credential first, then applies the auth throttle to an
// authentication failure. `rejection` is the 429 to send instead of running the handler.
function authenticate(request: Request, server: Bun.Server<unknown>) {
  const { authFailed, ...auth } = resolveToken(
    getAuthToken(request.headers),
    tokenStorage,
    ADMIN_TOKEN ?? '',
  );
  const rejection = authFailed
    ? throttleAuthFailure(authThrottle, metrics, server.requestIP(request)?.address)
    : null;
  return { ...auth, rejection };
}

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
      GET: (request, server) =>
        trackRequest(async () => {
          const auth = authenticate(request, server);
          const response =
            auth.rejection ?? (await getCache(getCacheFile(request.params.hash), auth.permission));
          metrics.recordCacheRequest('GET', response.status);
          return response;
        }),
      PUT: (request, server) =>
        trackRequest(async () => {
          const auth = authenticate(request, server);
          const contentLength = request.headers.get('Content-Length') ?? '';

          const response =
            auth.rejection ??
            (await writeCache(
              getCacheFile(request.params.hash),
              auth.permission,
              request.body,
              contentLength,
              MAX_UPLOAD_BYTES,
            ));
          const uploadedBytes = response.status === 200 ? Number(contentLength) || 0 : 0;
          metrics.recordCacheRequest('PUT', response.status, uploadedBytes);
          return response;
        }),
    },
    '/v1/admin/tokens/:id': {
      DELETE: (request, server) =>
        trackRequest(() => {
          const auth = authenticate(request, server);
          return auth.rejection ?? deleteToken(auth.isAdmin, tokenStorage, request.params.id);
        }),
    },
    '/v1/admin/tokens': {
      GET: (request, server) =>
        trackRequest(() => {
          const auth = authenticate(request, server);
          return auth.rejection ?? listTokens(auth.isAdmin, tokenStorage);
        }),
      POST: (request, server) =>
        trackRequest(async () => {
          const auth = authenticate(request, server);
          return auth.rejection ?? addToken(auth.isAdmin, tokenStorage, request.json.bind(request));
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
    // Start `server.stop(false)` immediately so new connections are refused
    // while existing requests finish. Its promise is not the drain signal: it
    // never resolves while a keep-alive connection is still draining a body
    // Bun answered early (e.g. a 409 sent before the upload arrived). Instead
    // wait for the tracked handlers, then for `server.pendingRequests`, which
    // still counts streamed responses being sent after their handler returned
    // but not such a connection, and force-close whatever is left. Polling a
    // counter every 50 ms is cheap and adds at most 50 ms to shutdown.
    const gracefulStop = server.stop(false);
    const drained = (async () => {
      await waitForRequestsToDrain();
      while (server.pendingRequests > 0) await Bun.sleep(50);
    })();
    const stoppedGracefully = await Promise.race([
      drained.then(() => true),
      Bun.sleep(SHUTDOWN_DRAIN_TIMEOUT_MS).then(() => false),
    ]);

    if (!stoppedGracefully) {
      logger.error(`Graceful shutdown exceeded ${SHUTDOWN_DRAIN_TIMEOUT_MS}ms; forcing close`);
    }
    void gracefulStop.catch(() => {});
    await server.stop(true);
    process.exit(0);
  } catch (error) {
    exitOnError(error);
  }
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

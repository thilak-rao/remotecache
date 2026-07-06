import { rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../logger';

export interface SweepResult {
  scannedEntries: number;
  /** Committed cache size in bytes after the sweep. */
  totalBytes: number;
  evictedEntries: number;
  evictedBytes: number;
}

export interface CacheEvictor {
  /** One eviction pass. Exposed for tests; `start()` runs it on a timer. */
  sweep(): Promise<SweepResult>;
  start(): void;
  stop(): void;
}

interface Entry {
  path: string;
  size: number;
  mtimeMs: number;
}

type EvictStatus = 'deleted' | 'missing' | 'failed';

/**
 * Stateless filesystem cache evictor. Recency is the entry's mtime — bumped
 * on every cache hit by FileSystemStrategy — so no index is kept: each sweep
 * re-derives sizes and recency from a directory scan. Deployment is
 * single-writer (the chart fail-guards replicaCount > 1), so a scan cannot
 * race another evictor. A sweep never throws: per-file failures are logged
 * and retried naturally on the next pass.
 */
export function createCacheEvictor(options: {
  cacheDir: string;
  maxBytes?: number;
  ttlMs?: number;
  intervalMs: number;
  onSweep?: (result: SweepResult) => void;
}): CacheEvictor {
  const { cacheDir, maxBytes, ttlMs, intervalMs, onSweep } = options;
  let timer: ReturnType<typeof setInterval> | undefined;
  let sweepRunning = false;

  const emptyResult = (): SweepResult => ({
    scannedEntries: 0,
    totalBytes: 0,
    evictedEntries: 0,
    evictedBytes: 0,
  });

  async function evict(entry: Entry, result: SweepResult): Promise<EvictStatus> {
    try {
      await rm(entry.path);
      result.evictedEntries++;
      result.evictedBytes += entry.size;
      return 'deleted';
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
      logger.error(error);
      return 'failed';
    }
  }

  async function sweep(): Promise<SweepResult> {
    const result = emptyResult();
    if (sweepRunning) return result;
    sweepRunning = true;
    const now = Date.now();

    try {
      const entries: Entry[] = [];
      try {
        for await (const name of new Bun.Glob('*').scan({ cwd: cacheDir, onlyFiles: true })) {
          // `${hash}.<uuid>.tmp` write buffers are in-flight uploads, never
          // eviction candidates. Committed hashes cannot contain dots
          // (isValidHash), so the suffix check is exact.
          if (name.endsWith('.tmp')) continue;
          const path = join(cacheDir, name);
          try {
            const stats = await stat(path);
            entries.push({ path, size: stats.size, mtimeMs: stats.mtimeMs });
          } catch {
            // Deleted between scan and stat — skip.
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') logger.error(error);
        return result;
      }
      result.scannedEntries = entries.length;

      const survivors: Entry[] = [];
      for (const entry of entries) {
        if (ttlMs !== undefined && now - entry.mtimeMs > ttlMs) {
          if ((await evict(entry, result)) === 'failed') survivors.push(entry);
        } else {
          survivors.push(entry);
        }
      }

      let totalBytes = survivors.reduce((sum, entry) => sum + entry.size, 0);
      if (maxBytes !== undefined && totalBytes > maxBytes) {
        survivors.sort((a, b) => a.mtimeMs - b.mtimeMs);
        for (const entry of survivors) {
          if (totalBytes <= maxBytes) break;
          if ((await evict(entry, result)) !== 'failed') totalBytes -= entry.size;
        }
      }
      result.totalBytes = totalBytes;
      return result;
    } finally {
      sweepRunning = false;
    }
  }

  return {
    sweep,
    start(): void {
      if (timer !== undefined) return;
      timer = setInterval(() => {
        if (sweepRunning) return;
        sweep()
          .then(onSweep)
          .catch((error) => logger.error(error));
      }, intervalMs);
    },
    stop(): void {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    },
  };
}

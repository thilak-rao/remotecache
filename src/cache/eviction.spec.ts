import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCacheEvictor } from './eviction';

const logger = { error: mock() };
mock.module('../logger', () => ({ logger }));

const HOUR_MS = 3_600_000;

function makeCacheDir(): string {
  return mkdtempSync(join(tmpdir(), 'rc-evict-'));
}

/** Write `bytes` zero bytes at `dir/name` and backdate its mtime by `ageMs`. */
function makeEntry(dir: string, name: string, bytes: number, ageMs: number): string {
  const path = join(dir, name);
  writeFileSync(path, new Uint8Array(bytes));
  const seconds = (Date.now() - ageMs) / 1000;
  utimesSync(path, seconds, seconds);
  return path;
}

const exists = (path: string): Promise<boolean> => Bun.file(path).exists();

describe('createCacheEvictor sweep', () => {
  beforeEach(() => {
    logger.error.mockClear();
  });

  it('deletes entries older than the TTL and keeps younger ones', async () => {
    const dir = makeCacheDir();
    const stale = makeEntry(dir, 'stalehash01', 100, 3 * HOUR_MS);
    const fresh = makeEntry(dir, 'freshhash01', 100, 1 * HOUR_MS);
    const evictor = createCacheEvictor({ cacheDir: dir, ttlMs: 2 * HOUR_MS, intervalMs: 60_000 });

    const result = await evictor.sweep();

    expect(await exists(stale)).toBe(false);
    expect(await exists(fresh)).toBe(true);
    expect(result).toEqual({
      scannedEntries: 2,
      totalBytes: 100,
      evictedEntries: 1,
      evictedBytes: 100,
    });
    rmSync(dir, { recursive: true, force: true });
  });

  it('evicts least-recently-used entries until the total fits the cap', async () => {
    const dir = makeCacheDir();
    const oldest = makeEntry(dir, 'oldesthash01', 1000, 3 * HOUR_MS);
    const middle = makeEntry(dir, 'middlehash01', 1000, 2 * HOUR_MS);
    const newest = makeEntry(dir, 'newesthash01', 1000, 1 * HOUR_MS);
    const evictor = createCacheEvictor({ cacheDir: dir, maxBytes: 2000, intervalMs: 60_000 });

    const result = await evictor.sweep();

    // 3000 > 2000: only the oldest goes; deletion stops once total <= cap.
    expect(await exists(oldest)).toBe(false);
    expect(await exists(middle)).toBe(true);
    expect(await exists(newest)).toBe(true);
    expect(result).toEqual({
      scannedEntries: 3,
      totalBytes: 2000,
      evictedEntries: 1,
      evictedBytes: 1000,
    });
    rmSync(dir, { recursive: true, force: true });
  });

  it('runs the TTL pass before the size pass', async () => {
    // TTL removes the stale entry; the survivors then fit the cap, so the
    // LRU pass deletes nothing even though the pre-TTL total exceeded it.
    const dir = makeCacheDir();
    const stale = makeEntry(dir, 'stalehash02', 1500, 5 * HOUR_MS);
    const fresh = makeEntry(dir, 'freshhash02', 1000, 1 * HOUR_MS);
    const evictor = createCacheEvictor({
      cacheDir: dir,
      maxBytes: 2000,
      ttlMs: 2 * HOUR_MS,
      intervalMs: 60_000,
    });

    const result = await evictor.sweep();

    expect(await exists(stale)).toBe(false);
    expect(await exists(fresh)).toBe(true);
    expect(result.totalBytes).toBe(1000);
    expect(result.evictedEntries).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it('never touches in-flight .tmp upload buffers', async () => {
    const dir = makeCacheDir();
    const tmp = makeEntry(dir, `somehash01.${crypto.randomUUID()}.tmp`, 5000, 10 * HOUR_MS);
    const evictor = createCacheEvictor({
      cacheDir: dir,
      maxBytes: 1000,
      ttlMs: HOUR_MS,
      intervalMs: 60_000,
    });

    const result = await evictor.sweep();

    expect(await exists(tmp)).toBe(true);
    expect(result).toEqual({
      scannedEntries: 0,
      totalBytes: 0,
      evictedEntries: 0,
      evictedBytes: 0,
    });
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns an empty result when the cache dir does not exist yet', async () => {
    const evictor = createCacheEvictor({
      cacheDir: join(tmpdir(), `rc-evict-missing-${crypto.randomUUID()}`),
      maxBytes: 1,
      intervalMs: 60_000,
    });

    const result = await evictor.sweep();

    expect(result).toEqual({
      scannedEntries: 0,
      totalBytes: 0,
      evictedEntries: 0,
      evictedBytes: 0,
    });
  });

  it('skips entries it cannot delete and keeps reporting their size', async () => {
    const dir = makeCacheDir();
    makeEntry(dir, 'undeletable01', 100, 3 * HOUR_MS);
    chmodSync(dir, 0o500); // deleting requires write permission on the directory
    const evictor = createCacheEvictor({ cacheDir: dir, ttlMs: HOUR_MS, intervalMs: 60_000 });

    const result = await evictor.sweep();

    chmodSync(dir, 0o700);
    expect(result.evictedEntries).toBe(0);
    // The undeletable entry still counts toward the reported size.
    expect(result.totalBytes).toBe(100);
    expect(logger.error).toHaveBeenCalled();
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not double-count entries when sweeps overlap', async () => {
    const dir = makeCacheDir();
    for (let i = 0; i < 500; i++) {
      makeEntry(dir, `overlaphash${i}`, 10, 3 * HOUR_MS);
    }
    const evictor = createCacheEvictor({ cacheDir: dir, ttlMs: HOUR_MS, intervalMs: 60_000 });

    const results = await Promise.all([evictor.sweep(), evictor.sweep(), evictor.sweep()]);
    const evictedEntries = results.reduce((sum, result) => sum + result.evictedEntries, 0);
    const evictedBytes = results.reduce((sum, result) => sum + result.evictedBytes, 0);

    expect(evictedEntries).toBe(500);
    expect(evictedBytes).toBe(5000);
    rmSync(dir, { recursive: true, force: true });
  });
});

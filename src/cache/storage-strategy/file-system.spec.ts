import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemStrategy } from './file-system';
import { CacheEntryExistsError } from './storage-strategy.interface';

// Slow, chunked stream so two concurrent writes genuinely interleave.
const streamOf = (payload: string, chunkSize = 8) =>
  new ReadableStream<Uint8Array>({
    async start(controller) {
      const bytes = new TextEncoder().encode(payload);
      for (let i = 0; i < bytes.length; i += chunkSize) {
        controller.enqueue(bytes.slice(i, i + chunkSize));
        await Bun.sleep(1);
      }
      controller.close();
    },
  });

describe('FileSystemStrategy concurrent writes', () => {
  it('keeps exactly one intact artifact when two writers race the same hash', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rc-fs-race-'));
    const strategy = new FileSystemStrategy(dir);
    const hash = 'racehash01';
    const payloadA = 'A'.repeat(256);
    const payloadB = 'B'.repeat(256);

    const results = await Promise.allSettled([
      strategy.writeStream(hash, streamOf(payloadA), payloadA.length),
      strategy.writeStream(hash, streamOf(payloadB), payloadB.length),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(CacheEntryExistsError);

    // The committed artifact is one writer's payload intact — never interleaved.
    const stored = await Bun.file(join(dir, hash)).text();
    expect([payloadA, payloadB]).toContain(stored);

    rmSync(dir, { recursive: true, force: true });
  });

  it('sweeps orphaned temp files at startup while keeping committed entries', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rc-fs-sweep-'));
    // An orphan left behind by a hard crash, plus a real committed entry.
    await Bun.write(join(dir, 'orphanhash01.abc-123.tmp'), 'partial');
    await Bun.write(join(dir, 'realhash01'), 'committed');

    new FileSystemStrategy(dir);

    expect(await Bun.file(join(dir, 'orphanhash01.abc-123.tmp')).exists()).toBe(false);
    expect(await Bun.file(join(dir, 'realhash01')).exists()).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });

  it('cleans up its temp file after a successful write', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rc-fs-tmp-'));
    const strategy = new FileSystemStrategy(dir);
    await strategy.writeStream('tmphash01', streamOf('data'), 4);

    const leftovers = [...new Bun.Glob('*.tmp').scanSync(dir)];
    expect(leftovers).toEqual([]);

    rmSync(dir, { recursive: true, force: true });
  });

  it('cleans up its temp file when the source stream fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rc-fs-tmp-fail-'));
    const strategy = new FileSystemStrategy(dir);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('partial'));
        controller.error(new Error('upload aborted'));
      },
    });

    await expect(strategy.writeStream('failhash01', stream, 7)).rejects.toThrow('upload aborted');

    const leftovers = [...new Bun.Glob('*.tmp').scanSync(dir)];
    expect(leftovers).toEqual([]);
    expect(await Bun.file(join(dir, 'failhash01')).exists()).toBe(false);

    rmSync(dir, { recursive: true, force: true });
  });

  it('bumps mtime on getStream so eviction sees the entry as recently used', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rc-fs-recency-'));
    const strategy = new FileSystemStrategy(dir);
    const body = new Response(new Uint8Array(10)).body as ReadableStream<Uint8Array>;
    await strategy.writeStream('recencyhash01', body, 10);

    const path = join(dir, 'recencyhash01');
    const past = (Date.now() - 3_600_000) / 1000;
    utimesSync(path, past, past);

    const stream = await strategy.getStream('recencyhash01');

    // The recency update must be complete before callers receive the stream;
    // otherwise an eviction sweep can still see the stale mtime.
    const cutoff = Date.now() - 60_000;
    expect(statSync(path).mtimeMs).toBeGreaterThan(cutoff);
    await stream.getReader().read();
    rmSync(dir, { recursive: true, force: true });
  });
});

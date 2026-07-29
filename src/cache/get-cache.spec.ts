import { describe, expect, it, mock } from 'bun:test';
import { getCache } from './get-cache';
import type { CacheFile } from './cache-file.interface';
import type { TokenPermission } from '../token/token-interfaces';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemStrategy } from './storage-strategy/file-system';

const logger = { error: mock() };
mock.module('../logger', () => ({ logger }));

const makeCacheFile = () => ({
  valid: mock<CacheFile['valid']>(),
  exists: mock<CacheFile['exists']>(),
  stream: mock<CacheFile['stream']>(),
  size: mock<CacheFile['size']>(),
});

describe('getCache', () => {
  it('returns 403 when caller lacks read permission', async () => {
    const cacheFile = makeCacheFile();

    const response = await getCache(cacheFile, null);

    expect(response.status).toBe(403);
    expect(await response.text()).toBe('Access forbidden');
    expect(cacheFile.valid).not.toHaveBeenCalled();
    expect(cacheFile.exists).not.toHaveBeenCalled();
  });

  it('returns 400 when hash is missing/invalid and does not touch storage', async () => {
    const cacheFile = makeCacheFile();
    cacheFile.valid.mockReturnValue(false);

    const response = await getCache(cacheFile, 'readonly');

    expect(response.status).toBe(400);
    expect(await response.text()).toBe('Invalid hash');
    expect(cacheFile.valid).toHaveBeenCalled();
    expect(cacheFile.exists).not.toHaveBeenCalled();
    expect(cacheFile.stream).not.toHaveBeenCalled();
    expect(cacheFile.size).not.toHaveBeenCalled();
  });

  it('returns 404 when cache entry does not exist', async () => {
    const cacheFile = makeCacheFile();
    cacheFile.valid.mockReturnValue(true);
    cacheFile.exists.mockResolvedValue(false);

    const response = await getCache(cacheFile, 'readonly');

    expect(cacheFile.valid).toHaveBeenCalled();
    expect(cacheFile.exists).toHaveBeenCalled();
    expect(cacheFile.stream).not.toHaveBeenCalled();
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('The record was not found');
  });

  it('returns 500 when exists check throws', async () => {
    const boom = new Error('io error');
    const cacheFile = makeCacheFile();
    cacheFile.valid.mockReturnValue(true);
    cacheFile.exists.mockRejectedValue(boom);

    const response = await getCache(cacheFile, 'readonly');

    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Failed to read cache');
    expect(logger.error).toHaveBeenCalledWith(boom);
  });

  it('returns 500 when a filesystem entry disappears after the existence check', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rc-get-cache-disappear-'));
    const hash = 'disappearinghash01';
    const path = join(dir, hash);
    const strategy = new FileSystemStrategy(dir);

    try {
      await Bun.write(path, 'payload');
      const cacheFile = {
        valid: () => true,
        exists: async () => {
          const exists = await strategy.exists(hash);
          expect(exists).toBe(true);
          rmSync(path);
          return exists;
        },
        stream: () => strategy.getStream(hash),
        size: () => strategy.getSize(hash),
      };

      const response = await getCache(cacheFile, 'readonly');

      expect(response.status).toBe(500);
      expect(await response.text()).toBe('Failed to read cache');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns 200 with stream, content-type, and length when entry exists', async () => {
    const payload = 'hello world';
    const cacheFile = makeCacheFile();
    cacheFile.valid.mockReturnValue(true);
    cacheFile.exists.mockResolvedValue(true);
    cacheFile.stream.mockResolvedValue(new Response(payload).body as ReadableStream);
    cacheFile.size.mockResolvedValue(payload.length);

    const response = await getCache(cacheFile, 'full' as TokenPermission);

    expect(cacheFile.valid).toHaveBeenCalled();
    expect(cacheFile.exists).toHaveBeenCalled();
    expect(cacheFile.stream).toHaveBeenCalled();
    expect(cacheFile.size).toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(response.headers.get('Content-Length')).toBe(String(payload.length));
    expect(await response.text()).toBe(payload);
  });
});

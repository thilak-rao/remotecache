import { describe, expect, it, mock } from 'bun:test';
import { writeCache } from './write-cache';
import { CacheFile } from './cache-file.interface';
import { CacheEntryExistsError } from './storage-strategy/storage-strategy.interface';

const logger = { error: mock() };
mock.module('../logger', () => ({ logger }));

const maxUploadBytes = 1024;

describe('writeCache', () => {
  const makeCacheFile = () => ({
    valid: mock<CacheFile['valid']>().mockReturnValue(true),
    exists: mock<CacheFile['exists']>(),
    writeStream: mock<CacheFile['writeStream']>(),
  });

  const createStream = (value: string) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(value));
        controller.close();
      },
    });

  const consumeStream = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    return chunks;
  };

  it('returns 403 when token lacks write permission', async () => {
    const cacheFile = makeCacheFile();
    const body = createStream('data');
    const response = await writeCache(cacheFile, 'readonly', body, '4', maxUploadBytes);

    expect(response.status).toBe(403);
    expect(await response.text()).toBe('Access forbidden');
    expect(cacheFile.valid).not.toHaveBeenCalled();
    expect(cacheFile.exists).not.toHaveBeenCalled();
    expect(cacheFile.writeStream).not.toHaveBeenCalled();
  });

  it('returns 400 when hash is invalid and does not read body or touch storage', async () => {
    const cacheFile = makeCacheFile();
    cacheFile.valid.mockReturnValue(false);
    const body = createStream('data');

    const response = await writeCache(cacheFile, 'full', body, '4', maxUploadBytes);

    expect(response.status).toBe(400);
    expect(await response.text()).toBe('Invalid hash');
    expect(cacheFile.valid).toHaveBeenCalled();
    expect(cacheFile.exists).not.toHaveBeenCalled();
    expect(cacheFile.writeStream).not.toHaveBeenCalled();
  });

  it('returns 500 when reading request body fails', async () => {
    const bodyError = new Error('body read failed');
    const cacheFile = makeCacheFile();
    cacheFile.exists.mockResolvedValue(false);

    const body = new ReadableStream<Uint8Array>({
      pull() {
        throw bodyError;
      },
    });

    cacheFile.writeStream.mockImplementation(async (stream) => {
      await consumeStream(stream);
    });

    const response = await writeCache(cacheFile, 'full', body, '4', maxUploadBytes);

    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Failed to write to cache');
    expect(cacheFile.exists).toHaveBeenCalled();
    expect(cacheFile.writeStream).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(bodyError);
  });

  it('returns 500 when exists check fails', async () => {
    const existsError = new Error('stat failed');
    const cacheFile = makeCacheFile();
    cacheFile.exists.mockRejectedValue(existsError);

    const body = createStream('data');
    const response = await writeCache(cacheFile, 'full', body, '4', maxUploadBytes);

    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Failed to check cache');
    expect(cacheFile.writeStream).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(existsError);
  });

  it('returns 409 when file already exists', async () => {
    const cacheFile = makeCacheFile();
    cacheFile.exists.mockResolvedValue(true);

    const body = createStream('data');
    const response = await writeCache(cacheFile, 'full', body, '4', maxUploadBytes);

    expect(response.status).toBe(409);
    expect(await response.text()).toBe('Cannot override an existing record');
    expect(cacheFile.exists).toHaveBeenCalled();
    expect(cacheFile.writeStream).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid Content-Length syntax', async () => {
    for (const headerContentLength of [
      '',
      '0',
      '-1',
      '+4',
      ' 4 ',
      '4.0',
      '4e0',
      'Infinity',
      'NaN',
    ]) {
      const cacheFile = makeCacheFile();
      cacheFile.exists.mockResolvedValue(false);

      const body = createStream('data');
      const response = await writeCache(
        cacheFile,
        'full',
        body,
        headerContentLength,
        maxUploadBytes,
      );

      expect(response.status).toBe(400);
      expect(await response.text()).toBe('Invalid Content-Length header');
      expect(cacheFile.writeStream).not.toHaveBeenCalled();
    }
  });

  it('returns 413 and never reads the body when Content-Length exceeds the max', async () => {
    const cacheFile = makeCacheFile();
    cacheFile.exists.mockResolvedValue(false);

    const body = createStream('data');
    const response = await writeCache(
      cacheFile,
      'full',
      body,
      String(maxUploadBytes + 1),
      maxUploadBytes,
    );

    expect(response.status).toBe(413);
    expect(await response.text()).toBe(
      `Upload exceeds the maximum allowed size of ${maxUploadBytes} bytes`,
    );
    expect(cacheFile.writeStream).not.toHaveBeenCalled();
  });

  it('returns 400 and releases the source when the body ends too soon', async () => {
    const cacheFile = makeCacheFile();
    cacheFile.exists.mockResolvedValue(false);

    const body = createStream('data');
    cacheFile.writeStream.mockImplementation(async (stream) => {
      await consumeStream(stream);
    });

    const response = await writeCache(cacheFile, 'full', body, '5', maxUploadBytes);

    expect(response.status).toBe(400);
    expect(await response.text()).toBe('Invalid Content-Length header');
    expect(cacheFile.writeStream).toHaveBeenCalled();
    expect(body.locked).toBe(false);
  });

  it('cancels and releases the source when the body exceeds Content-Length', async () => {
    const cacheFile = makeCacheFile();
    cacheFile.exists.mockResolvedValue(false);
    let sourceCanceled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('12345'));
      },
      cancel() {
        sourceCanceled = true;
      },
    });
    cacheFile.writeStream.mockImplementation(async (stream) => {
      await consumeStream(stream);
    });

    const response = await writeCache(cacheFile, 'full', body, '4', maxUploadBytes);

    expect(cacheFile.writeStream).toHaveBeenCalled();
    expect(response.status).toBe(400);
    expect(await response.text()).toBe('Invalid Content-Length header');
    expect(sourceCanceled).toBe(true);
    expect(body.locked).toBe(false);
  });

  it('writes successfully and releases the source reader', async () => {
    const cacheFile = makeCacheFile();
    cacheFile.exists.mockResolvedValue(false);
    cacheFile.writeStream.mockImplementation(async (stream) => {
      const chunks = await consumeStream(stream);
      expect(Buffer.concat(chunks.map((c) => Buffer.from(c))).toString()).toBe('some-data');
    });

    const body = createStream('some-data');
    const response = await writeCache(cacheFile, 'full', body, '9', maxUploadBytes);

    expect(cacheFile.exists).toHaveBeenCalled();
    expect(cacheFile.writeStream).toHaveBeenCalled();
    expect(cacheFile.writeStream.mock.calls[0]?.[1]).toBe(9);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    expect(body.locked).toBe(false);
  });

  it('preserves success when a Bun-like reader rejects explicit release', async () => {
    const cacheFile = makeCacheFile();
    cacheFile.exists.mockResolvedValue(false);
    cacheFile.writeStream.mockImplementation(async (stream) => {
      await consumeStream(stream);
    });
    const body = createStream('data');
    const getReader = body.getReader.bind(body);
    let releaseAttempts = 0;
    Object.defineProperty(body, 'getReader', {
      value: () => {
        const reader = getReader();
        Object.defineProperty(reader, 'releaseLock', {
          value: () => {
            releaseAttempts++;
            throw new TypeError('Bun direct reader cannot release');
          },
        });
        return reader;
      },
    });

    const response = await writeCache(cacheFile, 'full', body, '4', maxUploadBytes);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    expect(releaseAttempts).toBe(1);
  });

  it('cancels and releases the source when storage rejects the write', async () => {
    const diskFullError = new Error('disk full');
    const cacheFile = makeCacheFile();
    cacheFile.exists.mockResolvedValue(false);
    cacheFile.writeStream.mockRejectedValue(diskFullError);
    let sourceCanceled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('payload'));
      },
      cancel() {
        sourceCanceled = true;
      },
    });

    const response = await writeCache(cacheFile, 'full', body, '7', maxUploadBytes);

    expect(cacheFile.exists).toHaveBeenCalled();
    expect(cacheFile.writeStream).toHaveBeenCalled();
    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Failed to write to cache');
    expect(logger.error).toHaveBeenCalledWith(diskFullError);
    expect(sourceCanceled).toBe(true);
    expect(body.locked).toBe(false);
  });

  it('cancels and releases the source when storage loses a first-writer race', async () => {
    const cacheFile = makeCacheFile();
    cacheFile.exists.mockResolvedValue(false);
    cacheFile.writeStream.mockRejectedValue(new CacheEntryExistsError('racehash'));
    let sourceCanceled = false;
    let cancellationSettled = false;
    const cancellationGate = Promise.withResolvers<void>();
    const releaseCancellation = () => {
      cancellationSettled = true;
      cancellationGate.resolve();
    };
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data'));
      },
      cancel() {
        sourceCanceled = true;
        return cancellationGate.promise;
      },
    });

    const responsePromise = writeCache(cacheFile, 'full', body, '4', maxUploadBytes);
    const timeout = Symbol('timeout');
    const promptResult = await Promise.race([responsePromise, Bun.sleep(100).then(() => timeout)]);
    const cancellationStartedBeforeSettlement = sourceCanceled && !cancellationSettled;
    const sourceUnlockedBeforeSettlement = !body.locked;
    releaseCancellation();
    const response = await responsePromise;

    expect(promptResult).not.toBe(timeout);
    expect(response.status).toBe(409);
    expect(await response.text()).toBe('Cannot override an existing record');
    expect(cancellationStartedBeforeSettlement).toBe(true);
    expect(sourceUnlockedBeforeSettlement).toBe(true);
    expect(body.locked).toBe(false);
  });
});

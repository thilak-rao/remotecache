import { describe, expect, it } from 'bun:test';
import { Readable, Writable } from 'node:stream';
import { GcsStrategy, type GcsClient, type GcsListOptions, type GcsWriteOptions } from './gcs';
import { CacheEntryExistsError } from './storage-strategy.interface';

class FakeFile {
  existsResult = true;
  metadataSize: string | number = '0';
  writeOptions: GcsWriteOptions | null = null;
  writeError: Error | null = null;
  earlyWriteError: Error | null = null;
  written = Buffer.alloc(0);

  async exists(): Promise<[boolean]> {
    return [this.existsResult];
  }

  async getMetadata(): Promise<[{ size?: string | number }]> {
    return [{ size: this.metadataSize }];
  }

  createReadStream(): Readable {
    return Readable.from([Buffer.from('artifact')]);
  }

  createWriteStream(options: GcsWriteOptions): Writable {
    this.writeOptions = options;
    let writes = 0;
    const writable = new Writable({
      write: (chunk: Buffer | string, _encoding, callback) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        this.written = Buffer.concat([this.written, buffer]);
        writes += 1;
        callback();
        const earlyWriteError = this.earlyWriteError;
        if (writes === 1 && earlyWriteError) {
          queueMicrotask(() => {
            writable.destroy(earlyWriteError);
          });
        }
      },
      final: (callback) => {
        callback(this.writeError);
      },
    });
    return writable;
  }
}

class FakeBucket {
  fileRef = new FakeFile();
  readyError: Error | null = null;
  listOptions: GcsListOptions | null = null;

  file(_name: string): FakeFile {
    return this.fileRef;
  }

  async getFiles(options: GcsListOptions): Promise<[FakeFile[]]> {
    this.listOptions = options;
    if (this.readyError) throw this.readyError;
    return [[]];
  }
}

class FakeClient implements GcsClient {
  bucketRef = new FakeBucket();

  bucket(_name: string): FakeBucket {
    return this.bucketRef;
  }
}

describe('GcsStrategy', () => {
  it('checks object existence', async () => {
    const client = new FakeClient();
    client.bucketRef.fileRef.existsResult = false;
    const strategy = new GcsStrategy({ bucket: 'b', client });

    expect(await strategy.exists('hash')).toBe(false);
  });

  it('streams object data without buffering it into memory', async () => {
    const strategy = new GcsStrategy({ bucket: 'b', client: new FakeClient() });
    const stream = await strategy.getStream('hash');

    expect(await new Response(stream).text()).toBe('artifact');
  });

  it('reads object size from metadata', async () => {
    const client = new FakeClient();
    client.bucketRef.fileRef.metadataSize = '123';
    const strategy = new GcsStrategy({ bucket: 'b', client });

    expect(await strategy.getSize('hash')).toBe(123);
  });

  it('uploads with ifGenerationMatch 0 so existing objects are never overwritten', async () => {
    const client = new FakeClient();
    const strategy = new GcsStrategy({ bucket: 'b', client });

    await strategy.writeStream('hash', new Blob(['abc']).stream(), 3);

    expect(client.bucketRef.fileRef.written.toString()).toBe('abc');
    expect(client.bucketRef.fileRef.writeOptions).toEqual({
      resumable: true,
      validation: 'crc32c',
      metadata: {
        contentType: 'application/octet-stream',
      },
      preconditionOpts: {
        ifGenerationMatch: 0,
      },
    });
  });

  it('maps GCS 412 precondition failures to CacheEntryExistsError', async () => {
    const client = new FakeClient();
    const error = Object.assign(new Error('precondition failed'), { code: 412 });
    client.bucketRef.fileRef.writeError = error;
    const strategy = new GcsStrategy({ bucket: 'b', client });

    await expect(
      strategy.writeStream('hash', new Blob(['abc']).stream(), 3),
    ).rejects.toBeInstanceOf(CacheEntryExistsError);
  });

  it('maps GCS statusCode 412 precondition failures to CacheEntryExistsError', async () => {
    const client = new FakeClient();
    const error = Object.assign(new Error('precondition failed'), { statusCode: 412 });
    client.bucketRef.fileRef.writeError = error;
    const strategy = new GcsStrategy({ bucket: 'b', client });

    await expect(
      strategy.writeStream('hash', new Blob(['abc']).stream(), 3),
    ).rejects.toBeInstanceOf(CacheEntryExistsError);
  });

  it('rejects promptly and cancels the source when the target fails before the body finishes', async () => {
    const client = new FakeClient();
    const error = new Error('target failed early');
    client.bucketRef.fileRef.earlyWriteError = error;
    const strategy = new GcsStrategy({ bucket: 'b', client });
    let canceledWith: unknown;
    let closeSource = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([97]));
        const timeout = setTimeout(() => {
          controller.close();
        }, 500);
        closeSource = () => {
          clearTimeout(timeout);
          controller.close();
        };
      },
      cancel(reason) {
        canceledWith = reason;
      },
    });

    const upload = strategy.writeStream('hash', stream, 1);

    try {
      const result = await Promise.race([
        upload.then(
          () => 'resolved' as const,
          (rejection: unknown) => rejection,
        ),
        Bun.sleep(50).then(() => 'timed out' as const),
      ]);

      expect(result).toBe(error);
      expect(canceledWith).toBe(error);
    } finally {
      try {
        closeSource();
      } catch {
        // The source may already be canceled before cleanup runs.
      }
      await upload.catch(() => undefined);
    }
  });

  it('checks bucket readiness with a non-mutating object-list probe', async () => {
    const client = new FakeClient();
    const strategy = new GcsStrategy({ bucket: 'b', client });

    await expect(strategy.checkReady()).resolves.toBeUndefined();
    expect(client.bucketRef.listOptions).toEqual({ autoPaginate: false, maxResults: 1 });
  });

  it('fails readiness when the object-list probe fails', async () => {
    const client = new FakeClient();
    client.bucketRef.readyError = new Error('storage.objects.list denied');
    const strategy = new GcsStrategy({ bucket: 'b', client });

    await expect(strategy.checkReady()).rejects.toThrow('storage.objects.list denied');
  });
});

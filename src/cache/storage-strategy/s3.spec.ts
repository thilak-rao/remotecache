import { afterEach, describe, expect, it } from 'bun:test';
import { S3Client } from 'bun';
import { S3Strategy, shouldRefreshCredentials } from './s3';

type S3ClientPrototype = {
  exists(path: string, options?: Bun.S3Options): Promise<boolean>;
  list(input?: Bun.S3ListObjectsOptions | null): Promise<Bun.S3ListObjectsResponse>;
};

const s3Prototype = S3Client.prototype as unknown as S3ClientPrototype;
const originalExists = s3Prototype.exists;
const originalList = s3Prototype.list;
const originalFetch = globalThis.fetch;

afterEach(() => {
  s3Prototype.exists = originalExists;
  s3Prototype.list = originalList;
  globalThis.fetch = originalFetch;
});

describe('shouldRefreshCredentials', () => {
  const now = 1_000_000_000_000;

  it('never refreshes when expiration is null (static credentials)', () => {
    expect(shouldRefreshCredentials(null, now)).toBe(false);
  });

  it('refreshes within five minutes of expiry', () => {
    expect(shouldRefreshCredentials(now + 4 * 60 * 1000, now)).toBe(true);
  });

  it('does not refresh comfortably before expiry', () => {
    expect(shouldRefreshCredentials(now + 30 * 60 * 1000, now)).toBe(false);
  });

  it('refreshes when already expired', () => {
    expect(shouldRefreshCredentials(now - 1000, now)).toBe(true);
  });
});

describe('S3Strategy', () => {
  const createStrategy = () =>
    new S3Strategy({
      bucket: 'bucket',
      credentials: { accessKeyId: 'access', secretAccessKey: 'secret' },
    });

  it('coalesces concurrent credential resolution', async () => {
    let providerCalls = 0;
    const { promise: credentialsGate, resolve: releaseCredentials } = Promise.withResolvers<void>();
    s3Prototype.exists = () => Promise.resolve(false);
    const strategy = new S3Strategy({
      bucket: 'bucket',
      credentials: async () => {
        providerCalls++;
        await credentialsGate;
        return {
          accessKeyId: 'access',
          secretAccessKey: 'secret',
          expiration: new Date(Date.now() + 30 * 60 * 1000),
        };
      },
    });

    const requests = Array.from({ length: 32 }, () => strategy.exists('hash'));
    expect(providerCalls).toBe(1);
    releaseCredentials();

    await expect(Promise.all(requests)).resolves.toEqual(Array<boolean>(32).fill(false));
    expect(providerCalls).toBe(1);
  });

  it('retries credential resolution after a provider failure', async () => {
    let providerCalls = 0;
    s3Prototype.exists = () => Promise.resolve(true);
    const strategy = new S3Strategy({
      bucket: 'bucket',
      credentials: async () => {
        providerCalls++;
        if (providerCalls === 1) {
          throw new Error('STS unavailable');
        }
        return { accessKeyId: 'access', secretAccessKey: 'secret' };
      },
    });

    await expect(strategy.exists('hash')).rejects.toThrow(/^STS unavailable$/);
    await expect(strategy.exists('hash')).resolves.toBe(true);
    expect(providerCalls).toBe(2);
  });

  it('rejects writes when the backend does not support conditional writes', async () => {
    globalThis.fetch = Object.assign(
      async () => new Response('conditional writes unsupported', { status: 501 }),
      { preconnect: originalFetch.preconnect },
    );

    await expect(
      createStrategy().writeStream('hash', new Blob(['data']).stream(), 4),
    ).rejects.toThrow('does not support conditional writes');
  });

  it('checks bucket readiness by listing at most one object', async () => {
    let listInput: Bun.S3ListObjectsOptions | null | undefined;
    s3Prototype.exists = () => Promise.resolve(false);
    s3Prototype.list = (input) => {
      listInput = input;
      return Promise.resolve({});
    };

    await expect(createStrategy().checkReady()).resolves.toBeUndefined();

    expect(listInput).toEqual({ maxKeys: 1 });
  });

  it('fails readiness when the bucket list probe fails', async () => {
    s3Prototype.exists = () => Promise.resolve(false);
    s3Prototype.list = () => Promise.reject(new Error('NoSuchBucket'));

    await expect(createStrategy().checkReady()).rejects.toThrow('NoSuchBucket');
  });
});

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

afterEach(() => {
  s3Prototype.exists = originalExists;
  s3Prototype.list = originalList;
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

describe('S3Strategy readiness', () => {
  const createStrategy = () =>
    new S3Strategy({
      bucket: 'bucket',
      credentials: { accessKeyId: 'access', secretAccessKey: 'secret' },
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

import { describe, expect, it } from 'bun:test';
import { resolveS3Config } from './create-cache-storage';

const asEnv = (o: Record<string, string>) => o as unknown as typeof Bun.env;

describe('resolveS3Config', () => {
  it('throws without a bucket', () => {
    expect(() => resolveS3Config(asEnv({}))).toThrow(/S3_BUCKET/);
  });

  it('uses static credentials when both keys are present', () => {
    const cfg = resolveS3Config(
      asEnv({ S3_BUCKET: 'b', S3_REGION: 'r', S3_ACCESS_KEY_ID: 'a', S3_SECRET_ACCESS_KEY: 's' }),
    );
    expect(cfg.mode).toBe('static');
    if (cfg.mode === 'static') {
      expect(cfg.credentials.accessKeyId).toBe('a');
      expect(cfg.credentials.secretAccessKey).toBe('s');
    }
  });

  it('passes a session token through in static mode', () => {
    const cfg = resolveS3Config(
      asEnv({
        S3_BUCKET: 'b',
        S3_ACCESS_KEY_ID: 'a',
        S3_SECRET_ACCESS_KEY: 's',
        S3_SESSION_TOKEN: 't',
      }),
    );
    expect(cfg.mode === 'static' && cfg.credentials.sessionToken).toBe('t');
  });

  it('falls back to the AWS provider chain when keys are absent', () => {
    const cfg = resolveS3Config(asEnv({ S3_BUCKET: 'b', S3_REGION: 'r' }));
    expect(cfg.mode).toBe('chain');
  });

  it('throws when only S3_ACCESS_KEY_ID is set', () => {
    expect(() => resolveS3Config(asEnv({ S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'a' }))).toThrow(
      /S3_ACCESS_KEY_ID.*S3_SECRET_ACCESS_KEY/,
    );
  });

  it('throws when only S3_SECRET_ACCESS_KEY is set', () => {
    expect(() => resolveS3Config(asEnv({ S3_BUCKET: 'b', S3_SECRET_ACCESS_KEY: 's' }))).toThrow(
      /S3_ACCESS_KEY_ID.*S3_SECRET_ACCESS_KEY/,
    );
  });

  it('falls back to AWS_REGION when S3_REGION is unset', () => {
    const cfg = resolveS3Config(
      asEnv({
        S3_BUCKET: 'b',
        AWS_REGION: 'us-west-2',
        S3_ACCESS_KEY_ID: 'a',
        S3_SECRET_ACCESS_KEY: 's',
      }),
    );
    expect(cfg.region).toBe('us-west-2');
  });
});

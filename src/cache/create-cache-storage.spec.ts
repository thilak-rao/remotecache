import { describe, expect, it } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCacheStorage, resolveGcsConfig, resolveS3Config } from './create-cache-storage';
import { GcsStrategy } from './storage-strategy/gcs';

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

describe('resolveGcsConfig', () => {
  it('throws without a bucket', () => {
    expect(() => resolveGcsConfig(asEnv({}))).toThrow(/GCS_BUCKET/);
  });

  it('uses ambient credentials with only a bucket', () => {
    expect(resolveGcsConfig(asEnv({ GCS_BUCKET: 'b' }))).toEqual({
      bucket: 'b',
    });
  });

  it('passes project id through when set', () => {
    expect(resolveGcsConfig(asEnv({ GCS_BUCKET: 'b', GCS_PROJECT_ID: 'p' }))).toEqual({
      bucket: 'b',
      projectId: 'p',
    });
  });

  it('uses a key file when GCS_KEY_FILENAME is set', () => {
    expect(resolveGcsConfig(asEnv({ GCS_BUCKET: 'b', GCS_KEY_FILENAME: '/var/gcp.json' }))).toEqual(
      {
        bucket: 'b',
        keyFilename: '/var/gcp.json',
      },
    );
  });

  it('parses GCS_CREDENTIALS JSON', () => {
    const cfg = resolveGcsConfig(
      asEnv({
        GCS_BUCKET: 'b',
        GCS_CREDENTIALS: JSON.stringify({
          client_email: 'svc@example.iam.gserviceaccount.com',
          project_id: 'project',
          private_key: 'private-key',
        }),
      }),
    );

    expect(cfg.credentials?.client_email).toBe('svc@example.iam.gserviceaccount.com');
    expect(cfg.credentials?.project_id).toBe('project');
    expect(cfg.credentials?.private_key).toBe('private-key');
  });

  it('throws when explicit credential sources conflict', () => {
    expect(() =>
      resolveGcsConfig(
        asEnv({
          GCS_BUCKET: 'b',
          GCS_KEY_FILENAME: '/var/gcp.json',
          GCS_CREDENTIALS: '{}',
        }),
      ),
    ).toThrow(/GCS_KEY_FILENAME.*GCS_CREDENTIALS/);
  });

  it('throws when GCS_CREDENTIALS is not JSON object text', () => {
    expect(() => resolveGcsConfig(asEnv({ GCS_BUCKET: 'b', GCS_CREDENTIALS: 'not-json' }))).toThrow(
      /GCS_CREDENTIALS/,
    );
  });

  it('throws when GCS_CREDENTIALS is missing service-account fields', () => {
    expect(() => resolveGcsConfig(asEnv({ GCS_BUCKET: 'b', GCS_CREDENTIALS: '{}' }))).toThrow(
      /client_email.*private_key/,
    );
  });

  it('throws when GCS_CREDENTIALS service-account fields are not strings', () => {
    expect(() =>
      resolveGcsConfig(
        asEnv({
          GCS_BUCKET: 'b',
          GCS_CREDENTIALS: JSON.stringify({
            client_email: 123,
            private_key: null,
          }),
        }),
      ),
    ).toThrow(/client_email.*private_key/);
  });
});

describe('createCacheStorage', () => {
  it('creates GCS storage when STORAGE_STRATEGY is gcs', () => {
    expect(createCacheStorage(asEnv({ STORAGE_STRATEGY: 'gcs', GCS_BUCKET: 'b' }))).toBeInstanceOf(
      GcsStrategy,
    );
  });

  it('throws on an unknown STORAGE_STRATEGY', () => {
    expect(() => createCacheStorage(asEnv({ STORAGE_STRATEGY: 'azure' }))).toThrow(
      /Unknown STORAGE_STRATEGY "azure"/,
    );
  });

  it('throws when CACHE_DIR cannot be created or written', () => {
    const base = mkdtempSync(join(tmpdir(), 'rc-config-'));
    chmodSync(base, 0o500);
    try {
      expect(() => createCacheStorage(asEnv({ CACHE_DIR: join(base, 'cache') }))).toThrow(
        /not writable/,
      );
    } finally {
      chmodSync(base, 0o700);
      rmSync(base, { recursive: true, force: true });
    }
  });
});

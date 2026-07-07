import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import type { StorageOptions } from '@google-cloud/storage';
import { CacheStorageStrategy } from './storage-strategy/storage-strategy.interface';
import { S3Strategy } from './storage-strategy/s3';
import { GcsStrategy } from './storage-strategy/gcs';
import { FileSystemStrategy, assertFileSystemCacheDirReady } from './storage-strategy/file-system';

export type S3Resolved = {
  bucket: string;
  region?: string;
  endpoint?: string;
} & (
  | {
      mode: 'static';
      credentials: { accessKeyId: string; secretAccessKey: string; sessionToken?: string };
    }
  | { mode: 'chain' }
);

type GcsCredentials = NonNullable<StorageOptions['credentials']> & {
  client_email: string;
  private_key: string;
};

export type GcsResolved = {
  bucket: string;
  projectId?: string;
  keyFilename?: string;
  credentials?: GcsCredentials;
};

/**
 * Resolve S3 settings from the environment. Static credentials take precedence;
 * when access key and secret are both absent, fall back to the AWS provider
 * chain (env, web identity / IRSA, ECS task role, EC2 IMDS). `region` accepts
 * `S3_REGION` or the AWS-standard `AWS_REGION`.
 *
 * @throws if `S3_BUCKET` is missing, or if exactly one of `S3_ACCESS_KEY_ID` /
 * `S3_SECRET_ACCESS_KEY` is set — a partial static credential is rejected
 * rather than silently falling back to the provider chain, which would start
 * the server with unintended ambient credentials.
 */
export function resolveS3Config(env: typeof Bun.env): S3Resolved {
  const bucket = env.S3_BUCKET;
  if (!bucket) {
    throw new Error('S3 storage requires S3_BUCKET.');
  }

  const region = env.S3_REGION ?? env.AWS_REGION;
  const endpoint = env.S3_ENDPOINT;
  const accessKeyId = env.S3_ACCESS_KEY_ID;
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY;

  if (accessKeyId && secretAccessKey) {
    return {
      bucket,
      region,
      endpoint,
      mode: 'static',
      credentials: { accessKeyId, secretAccessKey, sessionToken: env.S3_SESSION_TOKEN },
    };
  }

  if (accessKeyId || secretAccessKey) {
    throw new Error(
      'S3 static credentials require both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY. ' +
        'Set both, or unset both to use the AWS provider chain.',
    );
  }

  return { bucket, region, endpoint, mode: 'chain' };
}

function isGcsCredentials(credentials: unknown): credentials is GcsCredentials {
  if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) {
    return false;
  }

  const candidate = credentials as { client_email?: unknown; private_key?: unknown };
  return typeof candidate.client_email === 'string' && typeof candidate.private_key === 'string';
}

function parseGcsCredentials(raw: string): GcsCredentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('GCS_CREDENTIALS must be valid service account JSON.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('GCS_CREDENTIALS must be a JSON object.');
  }

  if (!isGcsCredentials(parsed)) {
    throw new Error(
      'GCS_CREDENTIALS must be service account JSON with string client_email and private_key fields.',
    );
  }

  return parsed;
}

/**
 * Resolve Google Cloud Storage settings from the environment.
 *
 * @throws if `GCS_BUCKET` is missing, if explicit credential sources conflict,
 * or if `GCS_CREDENTIALS` is not service-account JSON object text.
 */
export function resolveGcsConfig(env: typeof Bun.env): GcsResolved {
  const bucket = env.GCS_BUCKET;
  if (!bucket) {
    throw new Error('GCS storage requires GCS_BUCKET.');
  }

  const projectId = env.GCS_PROJECT_ID;
  const keyFilename = env.GCS_KEY_FILENAME;
  const credentialsRaw = env.GCS_CREDENTIALS;

  if (keyFilename && credentialsRaw) {
    throw new Error(
      'GCS_KEY_FILENAME and GCS_CREDENTIALS are mutually exclusive. Set one explicit credential source, or unset both to use ambient credentials.',
    );
  }

  if (keyFilename) {
    return { bucket, ...(projectId ? { projectId } : {}), keyFilename };
  }

  if (credentialsRaw) {
    return {
      bucket,
      ...(projectId ? { projectId } : {}),
      credentials: parseGcsCredentials(credentialsRaw),
    };
  }

  return { bucket, ...(projectId ? { projectId } : {}) };
}

/**
 * Build the configured storage backend. Fails fast instead of falling back:
 * an unknown `STORAGE_STRATEGY` or an unwritable `CACHE_DIR` is a deployment
 * mistake that should stop the server at boot, not surface as 500s at the
 * first upload.
 *
 * @throws on unknown `STORAGE_STRATEGY`, unwritable `CACHE_DIR`, invalid S3
 * settings (see {@link resolveS3Config}), or invalid GCS settings (see
 * {@link resolveGcsConfig}).
 */
export function createCacheStorage(env: typeof Bun.env): CacheStorageStrategy {
  const kind = (env.STORAGE_STRATEGY ?? 'filesystem').toLowerCase();
  if (kind === 's3') {
    const cfg = resolveS3Config(env);
    const credentials = cfg.mode === 'static' ? cfg.credentials : fromNodeProviderChain();
    return new S3Strategy({
      bucket: cfg.bucket,
      region: cfg.region,
      endpoint: cfg.endpoint,
      credentials,
    });
  }

  if (kind === 'gcs') {
    return new GcsStrategy(resolveGcsConfig(env));
  }

  if (kind !== 'filesystem') {
    throw new Error(
      `Unknown STORAGE_STRATEGY "${env.STORAGE_STRATEGY}". Use "filesystem", "s3", or "gcs".`,
    );
  }

  const cacheDir = env.CACHE_DIR ?? './cache';
  assertFileSystemCacheDirReady(cacheDir);
  return new FileSystemStrategy(cacheDir);
}

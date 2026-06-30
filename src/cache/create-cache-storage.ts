import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { CacheStorageStrategy } from './storage-strategy/storage-strategy.interface';
import { S3Strategy } from './storage-strategy/s3';
import { FileSystemStrategy } from './storage-strategy/file-system';

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

  const cacheDir = env.CACHE_DIR ?? './cache';
  return new FileSystemStrategy(cacheDir);
}

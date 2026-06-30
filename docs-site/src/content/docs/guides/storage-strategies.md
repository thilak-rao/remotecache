---
title: Storage strategies
description: Store your self-hosted Nx remote cache on local disk or any S3-compatible bucket (AWS S3, MinIO), or write a custom storage strategy.
---

The self-hosted Nx remote cache server has two built-in storage backends: **filesystem** (the default) and **S3-compatible object storage**. Both are append-only — an existing hash always returns `409` and is never overwritten.

## Filesystem (default)

When `STORAGE_STRATEGY` is not set (or is anything other than `s3`), cache entries are stored on disk under `CACHE_DIR` (default: `./cache`).

In production, mount a persistent volume at `./cache`, or point `CACHE_DIR` at a path that survives restarts. See [Configuration](/guides/configuration/) for all environment variables.

Writes are atomic: each upload streams to a `${hash}.tmp` file and is renamed into place only on success, so a partial or failed upload never appears as a readable cache entry.

## S3-compatible storage

Set `STORAGE_STRATEGY=s3` and `S3_BUCKET` — the bucket is the only required S3 variable. `S3_REGION` (or the standard `AWS_REGION`) sets the region, and `S3_ENDPOINT` is needed only for MinIO or other S3-compatible providers. Provide credentials one of two ways.

**Static keys.** Set `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` (and `S3_SESSION_TOKEN` for temporary STS credentials). When both keys are set, they take precedence over any ambient credentials. Set them together or not at all — providing only one fails fast at startup instead of silently falling back to the provider chain.

```sh
export STORAGE_STRATEGY=s3
export S3_BUCKET=nx-cache
export S3_REGION=us-east-1
export S3_ACCESS_KEY_ID=...
export S3_SECRET_ACCESS_KEY=...
# export S3_SESSION_TOKEN=...                 # temporary / assumed-role credentials
# export S3_ENDPOINT=http://localhost:9000    # MinIO and other S3-compatible providers
```

**Ambient / IAM-role credentials.** Omit the static keys and the server resolves credentials through the AWS provider chain — environment, EKS IRSA web identity, ECS task role, then EC2 instance profile — refreshing them before they expire. This is the recommended path on AWS: no long-lived secrets to store or rotate.

```sh
export STORAGE_STRATEGY=s3
export S3_BUCKET=nx-cache
export S3_REGION=us-east-1
# no S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY — resolved from the pod or instance role
```

On Kubernetes, wire IRSA through the chart's `serviceAccount.annotations`; see [Kubernetes & Helm](/deploy/kubernetes/). With S3 there is no local cache directory to persist; the bucket handles durability.

## Custom storage strategy

Implement the `CacheStorageStrategy` interface (`src/cache/storage-strategy/storage-strategy.interface.ts`) and register the new class in `createCacheStorage` (`src/cache/create-cache-storage.ts`). The existing `file-system.ts` and `s3.ts` are the simplest references.

All strategies are append-only: if an entry already exists for a given hash, the handler returns `409` without calling `write`. See [Security](/guides/security/) for how this ties into the server's trust model.

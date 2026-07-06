---
title: Storage strategies
description: Store your self-hosted Nx remote cache on local disk or any S3-compatible bucket (AWS S3, MinIO), or write a custom storage strategy.
---

The self-hosted Nx remote cache server has two built-in storage backends: **filesystem** (the default) and **S3-compatible object storage**. Both reject known existing hashes with `409` and avoid overwriting existing entries. The filesystem backend commits atomically with hard links. S3 uses conditional `PUT`; its concurrent-write guarantee requires a provider that honors `If-None-Match: *`.

Cache downloads (`GET`) stream the artifact with `Transfer-Encoding: chunked` and carry no `Content-Length` header on either backend. This is a Bun HTTP limitation: `Bun.serve` strips a manually set `Content-Length` from a streamed (`ReadableStream`) response body. Upstream [Bun PR #27262](https://github.com/oven-sh/bun/pull/27262), which would have preserved it, was closed unmerged, so Nx clients read the body as a chunked stream.

## Filesystem (default)

When `STORAGE_STRATEGY` is unset or `filesystem`, cache entries are stored on disk under `CACHE_DIR` (default: `./cache`). Any other value except `s3` fails at startup, as does a `CACHE_DIR` the server cannot create or write — misconfiguration surfaces at boot, not as `500`s on the first upload.

In production, mount a persistent volume at `./cache`, or point `CACHE_DIR` at a path that survives restarts. See [Configuration](/guides/configuration/) for all environment variables.

Writes are atomic: each upload streams to a unique `${hash}.<uuid>.tmp` file and is committed into place with a hard link (`link(2)`) only on success, so a partial or failed upload never appears as a readable cache entry. Because the commit step relies on hard links, `CACHE_DIR` must live on a filesystem that supports them (exFAT and FAT do not). Any `.tmp` files orphaned by a hard crash mid-upload are swept away the next time the server starts.

## S3-compatible storage

Set `STORAGE_STRATEGY=s3` and `S3_BUCKET` — the bucket is the only required S3 variable. `S3_REGION` (or the standard `AWS_REGION`) sets the region, and `S3_ENDPOINT` is needed only for MinIO or other S3-compatible providers. Provide credentials one of two ways.

S3 writes use a conditional `PUT` (`If-None-Match: *`) so AWS S3, MinIO, and other providers that honor S3 conditional writes reject a second writer instead of overwriting an existing object. See [Security](/guides/security/#append-only-writes) for how this ties into the trust model.

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

## Cache growth and pruning

Set `CACHE_MAX_BYTES` and/or `CACHE_TTL_HOURS` to turn on built-in eviction for the filesystem
strategy: a background sweep evicts least-recently-used entries once the cache exceeds the cap and
deletes entries not accessed within the TTL window. Every cache hit refreshes an entry's recency,
so artifacts in active use stay. See [Configuration](/guides/configuration/) for the variables,
and watch `nx_cache_size_bytes` / `nx_cache_evicted_bytes_total` on `/metrics` to confirm eviction
keeps up with growth.

**Filesystem (manual fallback).** On releases without built-in eviction, prune with cron. Entries
are plain files named by hash under `CACHE_DIR`; deleting one just makes the next request for that
hash a cache miss, and writes are atomic, so pruning while the server is running is safe:

```sh
find "$CACHE_DIR" -maxdepth 1 -type f -mtime +30 -delete
```

(Current releases treat mtime as last-access — it's bumped on every read — so `-mtime` is the
right find test; `-atime` breaks on `noatime` mounts.)

**S3.** Use a bucket lifecycle rule; the server is not involved:

```json
{
  "Rules": [
    {
      "ID": "expire-nx-cache",
      "Status": "Enabled",
      "Filter": {},
      "Expiration": { "Days": 30 }
    }
  ]
}
```

Apply with `aws s3api put-bucket-lifecycle-configuration --bucket <bucket> --lifecycle-configuration file://lifecycle.json`; MinIO supports the same API (`mc ilm rule add`).

## Custom storage strategy

Implement the `CacheStorageStrategy` interface (`src/cache/storage-strategy/storage-strategy.interface.ts`) and register the new class in `createCacheStorage` (`src/cache/create-cache-storage.ts`). The existing `file-system.ts` and `s3.ts` are the simplest references.

All strategies are append-only: if an entry already exists for a given hash, the handler returns `409` without calling `write`. See [Security](/guides/security/) for how this ties into the server's trust model.

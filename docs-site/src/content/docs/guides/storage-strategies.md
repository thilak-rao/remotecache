---
title: Storage strategies
description: Store your self-hosted Nx remote cache on local disk, S3-compatible object storage, Google Cloud Storage, or a custom storage strategy.
---

The self-hosted Nx remote cache server has three built-in storage backends: **filesystem** (the default), **S3-compatible object storage**, and **Google Cloud Storage**. Each backend rejects known existing hashes with `409` and avoids overwriting existing entries. The filesystem backend commits atomically with hard links. S3 uses conditional `PUT`; its concurrent-write guarantee requires a provider that honors `If-None-Match: *`. GCS uses object generation preconditions.

Cache downloads (`GET`) stream the artifact with `Transfer-Encoding: chunked` and carry no `Content-Length` header on every built-in backend. This is a Bun HTTP limitation: `Bun.serve` strips a manually set `Content-Length` from a streamed (`ReadableStream`) response body. Upstream [Bun PR #27262](https://github.com/oven-sh/bun/pull/27262), which would have preserved it, was closed unmerged, so Nx clients read the body as a chunked stream.

## Filesystem (default)

When `STORAGE_STRATEGY` is unset or `filesystem`, cache entries are stored on disk under `CACHE_DIR` (default: `./cache`). Values other than `filesystem`, `s3`, or `gcs` fail at startup. The server also fails if it cannot create or write `CACHE_DIR`, so misconfiguration surfaces at boot instead of the first upload.

In production, mount a persistent volume at `./cache`, or point `CACHE_DIR` at a path that survives restarts. See [Configuration](/guides/configuration/) for all environment variables.

Writes are atomic: each upload streams to a unique `${hash}.<uuid>.tmp` file and is committed into place with a hard link (`link(2)`) only on success, so a partial or failed upload never appears as a readable cache entry. Because the commit step relies on hard links, `CACHE_DIR` must live on a filesystem that supports them (exFAT and FAT do not). Any `.tmp` files orphaned by a hard crash mid-upload are swept away the next time the server starts.

## S3-compatible storage

Set `STORAGE_STRATEGY=s3` and `S3_BUCKET` — the bucket is the only required S3 variable. `S3_REGION` (or the standard `AWS_REGION`) sets the region, and `S3_ENDPOINT` is needed only for MinIO or other S3-compatible providers. Provide credentials one of two ways.

S3 writes use a conditional `PUT` (`If-None-Match: *`) so AWS S3, MinIO, and other providers that honor S3 conditional writes reject a second writer instead of overwriting an existing object. See [Security](/guides/security/#append-only-writes) for how this ties into the trust model. Conditional-write support is a hard requirement: backends without it (for example older MinIO releases or other partial S3 implementations) reject every upload with `501 Not Implemented`, which the server surfaces as a `500` and logs with the backend's error body.

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

Grant object read, object create, and bucket list permissions on the cache bucket. The `/ready` probe lists at most one object to verify bucket reachability, so credentials that can only read or write known object keys are not enough for readiness.

## Google Cloud Storage

Set `STORAGE_STRATEGY=gcs` and `GCS_BUCKET`. The server uses ambient Google credentials by default, so prefer Workload Identity, Application Default Credentials, or the credential source provided by your runtime. For explicit credentials, set exactly one of `GCS_KEY_FILENAME` or `GCS_CREDENTIALS`; setting both fails at startup. Use `GCS_PROJECT_ID` only when the runtime cannot infer the project.

GCS writes use `ifGenerationMatch: 0`, so the bucket rejects a second writer instead of replacing an existing object. This keeps cache writes append-only, matching the filesystem and S3 strategies.

Grant object read, create, and list permissions on the cache bucket. The `/ready` probe uses object listing to verify bucket reachability without requiring bucket metadata access.

```sh
export STORAGE_STRATEGY=gcs
export GCS_BUCKET=nx-cache
# export GCS_PROJECT_ID=my-project
# export GCS_KEY_FILENAME=/var/run/secrets/gcp/service-account.json
# export GCS_CREDENTIALS='{"client_email":"...","private_key":"..."}'
```

With GCS there is no local cache directory to persist. Use a bucket lifecycle rule to expire old cache objects.

On Kubernetes, the Helm chart accepts `storage.strategy=gcs` with `gcs.bucket` and optional `gcs.projectId`. Use ambient credentials such as GKE Workload Identity, or set exactly one explicit source with `gcs.keyFilename` or `gcs.existingSecret`.

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

**Object storage.** Use a bucket lifecycle rule for S3 or GCS; the server is not involved. For S3-compatible storage, write `s3-lifecycle.json`:

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

Apply it with `aws s3api put-bucket-lifecycle-configuration --bucket <bucket> --lifecycle-configuration file://s3-lifecycle.json`; MinIO supports the same API (`mc ilm rule add`).

For GCS, write `gcs-lifecycle.json`:

```json
{
  "rule": [
    {
      "action": { "type": "Delete" },
      "condition": { "age": 30 }
    }
  ]
}
```

Apply it with the Cloud Storage CLI:

```sh
gcloud storage buckets update gs://<bucket> --lifecycle-file=gcs-lifecycle.json
```

## Custom storage strategy

Implement the `CacheStorageStrategy` interface (`src/cache/storage-strategy/storage-strategy.interface.ts`) and register the new class in `createCacheStorage` (`src/cache/create-cache-storage.ts`). The existing `file-system.ts`, `s3.ts`, and `gcs.ts` files are the simplest references.

All strategies are append-only: if an entry already exists for a given hash, the handler returns `409` without calling `write`. See [Security](/guides/security/) for how this ties into the server's trust model.

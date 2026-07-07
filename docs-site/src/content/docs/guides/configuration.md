---
title: Configuration
description: 'Every environment variable for the self-hosted Nx remote cache server: admin token, port, storage strategy, GCS, readiness probes, upload limits, and object storage settings.'
---

The self-hosted Nx remote cache server reads all configuration from environment variables. There are no config files.

## Environment variables

| Variable                    | Required | Default                                | Purpose                                                                                                                                         |
| --------------------------- | -------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `ADMIN_TOKEN`               | yes      | —                                      | Admin API auth; full cache access. Server exits on startup without it.                                                                          |
| `PORT`                      | no       | `3000`                                 | HTTP port.                                                                                                                                      |
| `TOKENS_DB_PATH`            | no       | `./data/nx-cache-server-tokens.sqlite` | SQLite token DB path. Persist this in production.                                                                                               |
| `MAX_UPLOAD_BYTES`          | no       | `524288000` (500 MiB)                  | Upload size cap for `PUT`; over the limit returns `413`.                                                                                        |
| `SHUTDOWN_DRAIN_TIMEOUT_MS` | no       | `30000`                                | Max wait for in-flight requests on `SIGTERM`/`SIGINT` before the server exits anyway.                                                           |
| `STORAGE_STRATEGY`          | no       | filesystem                             | `filesystem`, `s3`, or `gcs`. Any other value refuses to start.                                                                                 |
| `CACHE_DIR`                 | no       | `./cache`                              | Filesystem cache directory (filesystem strategy).                                                                                               |
| `CACHE_MAX_BYTES`           | no       | —                                      | Opt-in size cap for the filesystem cache; a background sweep evicts least-recently-used entries until the cache fits. Filesystem strategy only. |
| `CACHE_TTL_HOURS`           | no       | —                                      | Opt-in TTL for the filesystem cache; the sweep deletes entries not accessed within the window. Filesystem strategy only.                        |
| `CACHE_SWEEP_INTERVAL_MS`   | no       | `60000`                                | Eviction sweep period. The sweeper only runs when a cap or TTL is set.                                                                          |
| `S3_REGION`                 | no       | —                                      | S3 region. Falls back to `AWS_REGION`; omit both when the SDK can infer it (IRSA, ECS, EC2).                                                    |
| `AWS_REGION`                | no       | —                                      | Standard AWS region variable; used when `S3_REGION` is unset.                                                                                   |
| `S3_BUCKET`                 | for s3   | —                                      | S3 bucket. The only required S3 variable.                                                                                                       |
| `S3_ACCESS_KEY_ID`          | no       | —                                      | S3 access key. Omit (with the secret) to use the AWS credential chain.                                                                          |
| `S3_SECRET_ACCESS_KEY`      | no       | —                                      | S3 secret key. Omit (with the key id) to use the AWS credential chain.                                                                          |
| `S3_SESSION_TOKEN`          | no       | —                                      | Session token for temporary S3 credentials (STS / assumed roles).                                                                               |
| `S3_ENDPOINT`               | no       | —                                      | Custom endpoint for MinIO / other S3-compatible providers.                                                                                      |
| `GCS_BUCKET`                | for gcs  | —                                      | Google Cloud Storage bucket. Required when `STORAGE_STRATEGY=gcs`.                                                                              |
| `GCS_PROJECT_ID`            | no       | —                                      | Google Cloud project ID. Set when ambient credentials do not provide a project.                                                                 |
| `GCS_KEY_FILENAME`          | no       | —                                      | Path to a service-account JSON key file. Do not set with `GCS_CREDENTIALS`.                                                                     |
| `GCS_CREDENTIALS`           | no       | —                                      | Service-account JSON text from a secret. Do not set with `GCS_KEY_FILENAME`.                                                                    |
| `BIND_ADDRESS`              | no       | `0.0.0.0`                              | Listen interface. Use `::` for IPv6 / dual-stack.                                                                                               |
| `TLS_CERT_PATH`             | no       | —                                      | PEM certificate path. Set with `TLS_KEY_PATH` to serve HTTPS directly.                                                                          |
| `TLS_KEY_PATH`              | no       | —                                      | PEM private-key path. Set with `TLS_CERT_PATH` to serve HTTPS directly.                                                                         |
| `VERBOSE`                   | no       | —                                      | Set `1` or `true` to print `logger.info`/`logger.log` output; errors always print.                                                              |

## Notes

`ADMIN_TOKEN` is the only required variable. The server exits on startup if it's not set. Must be at least 16 characters (the server refuses to start otherwise); generate one with `openssl rand -hex 32`. There is no rate limiting on authentication — treat this value like a root credential.

`GET /health` has no configuration. It returns `OK` when the process is accepting requests. Use it for liveness only.

`GET /ready` is unauthenticated and checks SQLite token storage plus the configured cache backend. It returns a static `Not Ready` response on failure; dependency details go to the logs.

For production, `TOKENS_DB_PATH` and `CACHE_DIR` (or the object storage bucket) need to survive restarts. Mount a persistent volume for `./data` and `./cache`, or point these variables at a path that persists.

`CACHE_MAX_BYTES` and `CACHE_TTL_HOURS` enable built-in eviction for the filesystem strategy; each works alone and they compose (TTL runs first, then the size cap). "Accessed" means read or written: every cache hit refreshes an entry's recency, so artifacts in active use survive the TTL and are the last candidates for the size cap. Size the cap well above your largest artifact: a smaller cap evicts that artifact on the next sweep. Setting either variable with object storage (`s3` or `gcs`) is a startup error. Use bucket lifecycle rules instead (see [Storage strategies](/guides/storage-strategies/)).

For S3, set `STORAGE_STRATEGY=s3` and `S3_BUCKET`. Provide credentials one of two ways:

- **Static keys:** set `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` (and `S3_SESSION_TOKEN` for temporary credentials).
- **Ambient roles:** omit the keys. The server resolves credentials through the AWS provider chain — environment, EKS IRSA web identity, ECS task role, or EC2 instance profile — and refreshes them before they expire.

Set the two static keys together or not at all: providing only one fails fast at startup rather than silently falling back to the provider chain.

`S3_REGION` (or the AWS-standard `AWS_REGION`) sets the region. MinIO and other compatible providers also need `S3_ENDPOINT`. If you are moving from `@nx/s3-cache` (or another deprecated `@nx/*-cache` plugin), see [Migrate from @nx/s3-cache](/guides/migrate-from-nx-s3-cache/).

For GCS, set `STORAGE_STRATEGY=gcs` and `GCS_BUCKET`. Prefer ambient Google credentials from the runtime, such as Workload Identity or Application Default Credentials. For explicit credentials, set exactly one of `GCS_KEY_FILENAME` or secret-backed `GCS_CREDENTIALS`; setting both fails at startup.

`MAX_UPLOAD_BYTES` caps `PUT /v1/cache/:hash` uploads. Anything over the limit returns `413` before
the body hits storage. The server sizes its HTTP request-body limit from this value, so caps above
Bun's 128 MiB default work as configured.

`BIND_ADDRESS` sets the listen interface (`0.0.0.0` by default; `::` for IPv6). On `SIGTERM`/`SIGINT`, the server stops accepting new requests and drains in-flight requests before exiting. Kubernetes pod termination and `docker stop` both use that path. The Helm chart uses `Recreate`, so upgrades can still have a brief availability gap. The drain is bounded by `SHUTDOWN_DRAIN_TIMEOUT_MS` (default 30 s), so a stalled client cannot hold the process open indefinitely.

Set `TLS_CERT_PATH` and `TLS_KEY_PATH` together to serve HTTPS directly; the server exits on startup if only one is set or a file is missing. For most deployments, terminate TLS at an ingress or reverse proxy instead. See [Docker](/deploy/docker/#direct-tls) for direct TLS and [Kubernetes & Helm](/deploy/kubernetes/) for the chart.

Errors always print. Set `VERBOSE=1` (or `true`) to also see request details and cache hits/misses.

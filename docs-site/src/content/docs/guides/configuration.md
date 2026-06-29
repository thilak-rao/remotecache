---
title: Configuration
description: 'Every environment variable for the self-hosted Nx remote cache server: admin token, port, storage strategy, upload limits, and S3 settings.'
---

The self-hosted Nx remote cache server reads all configuration from environment variables. There are no config files.

## Environment variables

| Variable               | Required | Default                                | Purpose                                                                     |
| ---------------------- | -------- | -------------------------------------- | --------------------------------------------------------------------------- |
| `ADMIN_TOKEN`          | yes      | —                                      | Admin API auth; full cache access. Server exits on startup without it.      |
| `PORT`                 | no       | `3000`                                 | HTTP port.                                                                  |
| `TOKENS_DB_PATH`       | no       | `./data/nx-cache-server-tokens.sqlite` | SQLite token DB path. Persist this in production.                           |
| `MAX_UPLOAD_BYTES`     | no       | `524288000` (500 MiB)                  | Upload size cap for `PUT`; over the limit returns `413`.                    |
| `STORAGE_STRATEGY`     | no       | filesystem                             | Set to `s3` for S3-compatible storage; any other value uses the filesystem. |
| `CACHE_DIR`            | no       | `./cache`                              | Filesystem cache directory (filesystem strategy).                           |
| `S3_REGION`            | for s3   | —                                      | S3 region.                                                                  |
| `S3_BUCKET`            | for s3   | —                                      | S3 bucket.                                                                  |
| `S3_ACCESS_KEY_ID`     | no       | —                                      | S3 access key. Omit (with the secret) to use the AWS credential chain.      |
| `S3_SECRET_ACCESS_KEY` | no       | —                                      | S3 secret key. Omit (with the key id) to use the AWS credential chain.      |
| `S3_SESSION_TOKEN`     | no       | —                                      | Session token for temporary S3 credentials (STS / assumed roles).           |
| `S3_ENDPOINT`          | no       | —                                      | Custom endpoint for MinIO / other S3-compatible providers.                  |
| `BIND_ADDRESS`         | no       | `0.0.0.0`                              | Listen interface. Use `::` for IPv6 / dual-stack.                           |
| `TLS_CERT_PATH`        | no       | —                                      | PEM certificate path. Set with `TLS_KEY_PATH` to serve HTTPS directly.      |
| `TLS_KEY_PATH`         | no       | —                                      | PEM private-key path. Set with `TLS_CERT_PATH` to serve HTTPS directly.     |
| `VERBOSE`              | no       | —                                      | Set `1` to print `logger.info`/`logger.log` output; errors always print.    |

## Notes

`ADMIN_TOKEN` is the only required variable. The server exits on startup if it's not set.

`GET /health` has no configuration. It returns `OK` when the process is accepting requests. Use it for liveness/readiness checks.

For production, `TOKENS_DB_PATH` and `CACHE_DIR` (or the S3 bucket) need to survive restarts. Mount a persistent volume for `./data` and `./cache`, or point these variables at a path that persists.

For S3, set `STORAGE_STRATEGY=s3` and `S3_BUCKET`. Provide credentials one of two ways:

- **Static keys:** set `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` (and `S3_SESSION_TOKEN` for temporary credentials).
- **Ambient roles:** omit the keys. The server resolves credentials through the AWS provider chain — environment, EKS IRSA web identity, ECS task role, or EC2 instance profile — and refreshes them before they expire.

`S3_REGION` (or the AWS-standard `AWS_REGION`) sets the region. MinIO and other compatible providers also need `S3_ENDPOINT`. If you are moving from `@nx/s3-cache` (or another deprecated `@nx/*-cache` plugin), see [Migrate from @nx/s3-cache](/guides/migrate-from-nx-s3-cache/).

`MAX_UPLOAD_BYTES` caps `PUT /v1/cache/:hash` uploads. Anything over the limit returns `413` before the body hits storage.

`BIND_ADDRESS` sets the listen interface (`0.0.0.0` by default; `::` for IPv6). On `SIGTERM`/`SIGINT`, the server drains in-flight requests before exiting — Kubernetes rolling updates and `docker stop` wait for active uploads to finish.

Set `TLS_CERT_PATH` and `TLS_KEY_PATH` together to serve HTTPS directly; the server exits on startup if only one is set or a file is missing. For most deployments, terminate TLS at an ingress or reverse proxy instead. See [Docker](/deploy/docker/#direct-tls) for direct TLS and [Kubernetes & Helm](/deploy/kubernetes/) for the chart.

Errors always print. Set `VERBOSE=1` to also see request details and cache hits/misses.

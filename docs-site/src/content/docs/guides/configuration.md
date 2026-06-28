---
title: Configuration
description: "Every environment variable for the self-hosted Nx remote cache server: admin token, port, storage strategy, upload limits, and S3 settings."
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
| `S3_ACCESS_KEY_ID`     | for s3   | —                                      | S3 access key.                                                              |
| `S3_SECRET_ACCESS_KEY` | for s3   | —                                      | S3 secret key.                                                              |
| `S3_ENDPOINT`          | no       | —                                      | Custom endpoint for MinIO / other S3-compatible providers.                  |
| `VERBOSE`              | no       | —                                      | Set `1` to print `logger.info`/`logger.log` output; errors always print.    |

## Notes

`ADMIN_TOKEN` is the only required variable. The server exits on startup if it's not set.

For production, `TOKENS_DB_PATH` and `CACHE_DIR` (or the S3 bucket) need to survive restarts. Mount a persistent volume for `./data` and `./cache`, or point these variables at a path that persists.

For S3, set `STORAGE_STRATEGY=s3` along with `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY`. MinIO and other compatible providers also need `S3_ENDPOINT`. If you are moving from `@nx/s3-cache` (or another deprecated `@nx/*-cache` plugin), see [Migrate from @nx/s3-cache](/guides/migrate-from-nx-s3-cache/).

`MAX_UPLOAD_BYTES` caps `PUT /v1/cache/:hash` uploads. Anything over the limit returns `413` before the body hits storage.

Errors always print. Set `VERBOSE=1` to also see request details and cache hits/misses.

---
title: Deployment
description: Deploying the server in production.
---

## Container image

Images are published to the GitHub Container Registry:

```
ghcr.io/thilak-rao/nx-cache-server-bun
```

| Tag            | Published when              |
| -------------- | --------------------------- |
| `:latest`      | Push to `main`              |
| `:sha-<short>` | Push to `main`              |
| `:X.Y.Z`       | Version tag (e.g. `v1.2.3`) |
| `:X.Y`         | Version tag                 |

The container runs as a non-root user. The Bun base image is pinned by digest.

## Run

`ADMIN_TOKEN` is the only required variable. For the filesystem strategy, persist `./data` (token database) and `./cache` (cache entries) between restarts:

```sh
docker run -p 3000:3000 \
  -e ADMIN_TOKEN="change-me" \
  -v "$PWD/data:/app/data" \
  -v "$PWD/cache:/app/cache" \
  ghcr.io/thilak-rao/nx-cache-server-bun:latest
```

For S3 storage, omit the `./cache` volume and pass the S3 environment variables instead. The `./data` volume is still needed for the token database. See [Storage strategies](/guides/storage-strategies/) for details.

## Configuration

See the [Configuration](/guides/configuration/) page for all environment variables, including `PORT`, `TOKENS_DB_PATH`, `MAX_UPLOAD_BYTES`, and S3 options.

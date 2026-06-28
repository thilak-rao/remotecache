# nx-cache-server-bun

A small, self-hosted **Nx Remote Cache** server built on **Bun**.

[![CI](https://github.com/thilak-rao/nx-cache-server-bun/actions/workflows/ci.yml/badge.svg)](https://github.com/thilak-rao/nx-cache-server-bun/actions/workflows/ci.yml)
[![Docs](https://github.com/thilak-rao/nx-cache-server-bun/actions/workflows/docs.yml/badge.svg)](https://thilak-rao.github.io/nx-cache-server-bun/)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/thilak-rao/nx-cache-server-bun/badge)](https://scorecard.dev/viewer/?uri=github.com/thilak-rao/nx-cache-server-bun)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

**Full documentation:** [thilak-rao.github.io/nx-cache-server-bun](https://thilak-rao.github.io/nx-cache-server-bun/)

## Features

- Nx remote cache endpoints
  - `GET /v1/cache/:hash` (download)
  - `PUT /v1/cache/:hash` (upload)
- Token-based auth
  - **readonly** tokens can download
  - **full** tokens can download + upload
  - an **admin token** can manage tokens and also has **full** access
- Storage strategies
  - local filesystem (default)
  - S3-compatible storage (AWS S3, MinIO, etc.)
- SQLite-backed token store

## Quickstart

```sh
bun install
ADMIN_TOKEN="change-me" bun run serve
```

The server starts on `http://localhost:3000`. Create a **full** token (can read/write cache):

```sh
curl -sS -X POST \
  -H "Authorization: Bearer change-me" \
  -H "Content-Type: application/json" \
  "http://localhost:3000/v1/admin/tokens" \
  -d '{"id":"CI","permission":"full"}'
```

The response contains the generated token value. Save it: tokens are stored hashed (SHA-256) and cannot be recovered.

## Configure Nx

Set these environment variables wherever Nx runs (local dev, CI, etc.):

- `NX_SELF_HOSTED_REMOTE_CACHE_SERVER` – base URL of this server (e.g. `https://cache.example.com`)
- `NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN` – a token value with `readonly` or `full` permission

## Docker

```sh
docker run -p 3000:3000 \
  -e ADMIN_TOKEN="change-me" \
  -v "$PWD/data:/app/data" \
  -v "$PWD/cache:/app/cache" \
  ghcr.io/thilak-rao/nx-cache-server-bun:latest
```

See the [Deployment guide](https://thilak-rao.github.io/nx-cache-server-bun/guides/deployment/) for S3 storage and production setup.

## Links

- [Configuration](https://thilak-rao.github.io/nx-cache-server-bun/guides/configuration/) — all environment variables
- [API Reference](https://thilak-rao.github.io/nx-cache-server-bun/api/) — full HTTP API
- [Security model](https://thilak-rao.github.io/nx-cache-server-bun/guides/security/) — token auth, hashing, permissions
- [Contributing](https://thilak-rao.github.io/nx-cache-server-bun/contributing/) — how to contribute

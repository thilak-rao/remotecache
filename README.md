<p align="center">
  <img src="docs-site/src/assets/logo.png" alt="remotecache" width="120" height="120">
</p>

# remotecache

A small, self-hosted Nx remote cache server built on Bun.

[![CI](https://github.com/thilak-rao/remotecache/actions/workflows/ci.yml/badge.svg)](https://github.com/thilak-rao/remotecache/actions/workflows/ci.yml)
[![Docs](https://github.com/thilak-rao/remotecache/actions/workflows/docs.yml/badge.svg)](https://remotecache.dev/)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/thilak-rao/remotecache/badge)](https://scorecard.dev/viewer/?uri=github.com/thilak-rao/remotecache)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

**Full documentation:** [remotecache.dev](https://remotecache.dev/)

Nx's official self-hosted cache went free, then paid ($250/seat/year Powerpack), then free again (but Commercial-licensed, not MIT), then deprecated in under two years — all four `@nx/*-cache` plugins were sunset in May 2026 citing CVE-2025-36852 cache poisoning. This server is the MIT-licensed alternative: a custom remote-cache endpoint you own and operate, with no license restrictions and no vendor lock-in. [Full story →](https://remotecache.dev/why/)

## Features

- Nx remote cache endpoints
  - `GET /v1/cache/:hash` (download)
  - `PUT /v1/cache/:hash` (upload)
- Prometheus metrics at `GET /metrics` (unauthenticated; cache hit-rate, request counts, uploaded bytes)
- Health check at `GET /health` (unauthenticated; process liveness)
- Token-based auth
  - **readonly** tokens can download
  - **full** tokens can download + upload
  - an **admin token** can manage tokens and also has **full** access
- Storage strategies
  - local filesystem (default)
  - S3-compatible storage (AWS S3, MinIO, etc.)
- SQLite-backed token store
- Direct TLS (`TLS_CERT_PATH` + `TLS_KEY_PATH`) or terminate TLS at your proxy/ingress
- Helm chart for Kubernetes (`charts/remotecache/`)

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
  ghcr.io/thilak-rao/remotecache:latest
```

`latest` points at the newest stable release. Use `edge` only for unreleased builds from `main`.
Health checks can call `GET /health` without a token.

For Kubernetes, install the Helm chart in `charts/remotecache/`. See the [Deployment guide](https://remotecache.dev/guides/deployment/).

Released versions also publish a Helm OCI chart (`oci://ghcr.io/thilak-rao/charts/remotecache`) and standalone binaries for Linux, macOS, and Windows on the [Releases page](https://github.com/thilak-rao/remotecache/releases). See the [Deployment guide](https://remotecache.dev/guides/deployment/) for verification and install steps.

## Links

- [Configuration](https://remotecache.dev/guides/configuration/) — all environment variables
- [API Reference](https://remotecache.dev/api/) — full HTTP API
- [Security model](https://remotecache.dev/guides/security/) — token auth, hashing, permissions
- [Contributing](https://remotecache.dev/contributing/) — how to contribute

---

Built on the MIT-licensed [`jase88/nx-cache-server-bun`](https://github.com/jase88/nx-cache-server-bun); the original copyright is preserved in [LICENSE](./LICENSE).

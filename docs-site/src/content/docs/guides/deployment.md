---
title: Deployment
description: Deploy the self-hosted Nx remote cache server as a small non-root container from GHCR, with persistence for the token DB and cache.
---

The self-hosted Nx remote cache server ships as a pre-built container image published to GHCR — no build step needed.

## Container image

Images are published to the GitHub Container Registry:

```
ghcr.io/thilak-rao/remotecache
```

| Tag            | Published when              | Use                                    |
| -------------- | --------------------------- | -------------------------------------- |
| `:edge`        | Successful push to `main`   | Testing unreleased changes from `main` |
| `:sha-<short>` | Successful push to `main`   | Pinning an exact unreleased build      |
| `:latest`      | Version tag (e.g. `v1.2.3`) | Latest stable release                  |
| `:X.Y.Z`       | Version tag                 | Pinning an exact stable release        |
| `:X.Y`         | Version tag                 | Tracking patch releases within a minor |

The old main-branch `latest` behavior is intentionally retired. For production, pin `:X.Y.Z` or `:X.Y`; use `:latest` only when you deliberately want the newest stable release.

Images are published for `linux/amd64` and `linux/arm64`. Release builds include BuildKit SBOM and provenance attestations.

The container runs as a non-root user. The Bun base image is pinned by digest.

## Run

`ADMIN_TOKEN` is the only required variable. For the filesystem strategy, persist `./data` (token database) and `./cache` (cache entries) between restarts:

```sh
docker run -p 3000:3000 \
  -e ADMIN_TOKEN="change-me" \
  -v "$PWD/data:/app/data" \
  -v "$PWD/cache:/app/cache" \
  ghcr.io/thilak-rao/remotecache:latest
```

For S3 storage, omit the `./cache` volume and pass the S3 environment variables instead. The `./data` volume is still needed for the token database. See [Storage strategies](/guides/storage-strategies/) for details.

## Health checks

`GET /health` returns `200 OK` with a plain text `OK` body and does not require a token. Use it for container and orchestrator liveness/readiness checks.

This endpoint confirms the server process is running and accepting requests. It does not validate filesystem or S3 backend reachability.

```sh
curl -fsS http://localhost:3000/health
```

## Monitoring

The server exposes Prometheus metrics at `GET /metrics` in the text exposition format (version 0.0.4):

- `nx_cache_requests_total{method,result}` — cache requests by method and outcome. The `GET` `hit`/`miss` split is the cache hit-rate; `PUT` `forbidden` counts read-only tokens rejected from writing, and `PUT` `immutable` counts attempts to overwrite an existing entry.
- `nx_cache_uploaded_bytes_total` — total bytes accepted by successful uploads.

`/metrics` is **unauthenticated** and reports only aggregate counters — no token values or cache hashes. Scrape it over a private network and keep it off any public route (for example, block `/metrics` at your reverse proxy and point the collector at the container directly).

```yaml
# Prometheus scrape config
scrape_configs:
  - job_name: nx-cache
    static_configs:
      - targets: ['nx-cache:3000']
```

## Configuration

See the [Configuration](/guides/configuration/) page for all environment variables, including `PORT`, `TOKENS_DB_PATH`, `MAX_UPLOAD_BYTES`, and S3 options. Before exposing the server to CI traffic, review the [Security](/guides/security/) guide for token scoping and the append-only trust model.

---
title: Docker
description: Run the self-hosted Nx remote cache server as a small non-root container from GHCR, with persistence, health checks, direct TLS, and Prometheus metrics.
---

The self-hosted Nx remote cache server ships as a pre-built container image published to GHCR, so there is no build step. Docker is the recommended path for production. For a host install without a container runtime see [Standalone binaries](/deploy/binaries/), and for clusters see [Kubernetes & Helm](/deploy/kubernetes/).

## Container image

Images are published to the GitHub Container Registry:

```
ghcr.io/thilak-rao/remotecache
```

| Tag            | Published when            | Use                                    |
| -------------- | ------------------------- | -------------------------------------- |
| `:edge`        | Successful push to `main` | Testing unreleased changes from `main` |
| `:sha-<short>` | Successful push to `main` | Pinning an exact unreleased build      |
| `:latest`      | Stable version tag        | Latest stable release                  |
| `:X.Y.Z`       | Any version tag           | Pinning an exact release               |
| `:X.Y`         | Stable version tag        | Tracking patch releases within a minor |

The old main-branch `latest` behavior is intentionally retired. For production, pin `:X.Y.Z` or `:X.Y`; use `:latest` only when you deliberately want the newest stable release.

Images are published for `linux/amd64` and `linux/arm64`. Release builds include BuildKit SBOM and provenance attestations. The container runs as a non-root user, and the Bun base image is pinned by digest.

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

The server listens on `0.0.0.0:3000` by default. Set `BIND_ADDRESS` to change the interface — use `::` for IPv6 or dual-stack. On `docker stop` the server receives `SIGTERM` and drains in-flight requests before exiting, so uploads in progress are not cut off. See [Configuration](/guides/configuration/) for every environment variable.

## Health checks

`GET /health` returns `200 OK` with a plain text `OK` body and does not require a token. Use it for container and orchestrator liveness/readiness checks:

```sh
curl -fsS http://localhost:3000/health
```

It confirms the server process is running and accepting requests. It does not validate filesystem or S3 backend reachability.

## Direct TLS

The server can terminate TLS itself. Mount a certificate and key, then point the server at them with `TLS_CERT_PATH` and `TLS_KEY_PATH`:

```sh
docker run -p 3000:3000 \
  -e ADMIN_TOKEN="change-me" \
  -e TLS_CERT_PATH=/certs/tls.crt \
  -e TLS_KEY_PATH=/certs/tls.key \
  -v "$PWD/certs:/certs:ro" \
  ghcr.io/thilak-rao/remotecache:latest
```

Set both variables or neither — the server exits on startup if only one is set, or if a file is missing. For most deployments, terminating TLS at an ingress or reverse proxy is simpler. In Kubernetes the chart wires TLS from a Secret; see [Kubernetes & Helm](/deploy/kubernetes/).

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

## Next steps

See [Configuration](/guides/configuration/) for all environment variables, and the [Security](/guides/security/) guide for token scoping and the append-only trust model before exposing the server to CI traffic.

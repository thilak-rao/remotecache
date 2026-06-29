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

## Standalone binaries

Each release attaches standalone executables to the GitHub Release for Linux, macOS (x64 and arm64), and Windows (x64), along with a `checksums.txt`. Docker is still the recommended path for production; the binaries are handy for direct host installs and quick trials.

Download the binary for your platform from the [Releases page](https://github.com/thilak-rao/remotecache/releases), verify it, and run it:

```sh
# verify the checksum (run from the download directory)
sha256sum -c checksums.txt --ignore-missing

# verify build provenance (optional; requires the gh CLI)
gh attestation verify remotecache-X.Y.Z-linux-x64 --repo thilak-rao/remotecache

# run
chmod +x remotecache-X.Y.Z-linux-x64
ADMIN_TOKEN="change-me" ./remotecache-X.Y.Z-linux-x64
```

The binary bundles everything it needs, so the host does not need Bun installed.

## Kubernetes (Helm)

A Helm chart is published to GHCR as an OCI artifact on every release. Install a released version straight from the registry:

```sh
helm install remotecache oci://ghcr.io/thilak-rao/charts/remotecache \
  --version X.Y.Z \
  --set adminToken="change-me"
```

Or install from a checkout of the repository (tracks `main`):

```sh
helm install remotecache ./charts/remotecache \
  --set adminToken="change-me"
```

Reference an existing Secret instead of a literal token:

```sh
helm install remotecache ./charts/remotecache \
  --set existingSecret=remotecache-admin \
  --set existingSecretKey=admin-token
```

The chart defaults to filesystem storage with PersistentVolumeClaims for the token database and cache. Probes call the unauthenticated `/health` endpoint.

For S3 with EKS IRSA — no static keys, credentials resolved from the pod's IAM role:

```sh
helm install remotecache ./charts/remotecache \
  --set adminToken="change-me" \
  --set storage.strategy=s3 \
  --set s3.bucket=my-cache-bucket \
  --set s3.region=us-east-1 \
  --set serviceAccount.annotations."eks\.amazonaws\.com/role-arn"=arn:aws:iam::123456789012:role/remotecache
```

Key values: `image.repository`/`image.tag`, `adminToken`/`existingSecret`, `storage.strategy`, `s3.*`, `tls.*`, `persistence.*`, `serviceAccount.annotations`, `config.maxUploadBytes`, `config.bindAddress`, `resources`, and the `extraEnv`/`extraVolumes`/`extraVolumeMounts` escape hatches. See `charts/remotecache/values.yaml` for the full list.

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

Set both variables or neither — the server exits on startup if only one is set, or if a file is missing. In the Helm chart, set `tls.enabled=true` and `tls.existingSecret` to a `kubernetes.io/tls` Secret; the chart mounts it and switches the probes to HTTPS. For most deployments, terminating TLS at an ingress or reverse proxy is simpler.

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

# Documentation Sync + DevRel Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the documentation accurately and discoverably reflect every surface the `teardown-fix` branch shipped, and pull the roadmap's "final docs-site revision" forward by restructuring deployment into a first-class "Deploy" section.

**Architecture:** Docs-only change. The code is correct; where docs and code disagree, the docs are fixed to match the code. Six content tasks plus a final verification gate. Each task ends green (`docs-site` builds, links validate, format passes) and is independently committable. The deployment monolith is split first so every later task references stable URLs.

**Tech Stack:** Astro Starlight (`@astrojs/starlight` ^0.41, `astro` ^7), `starlight-openapi` (generates the API Reference from `nx-cache-server.openapi.json`), `starlight-links-validator` (fails the build on broken internal links), oxfmt (formats Markdown/JSON), Bun.

## Global Constraints

- **Docs-only.** No source-code change. The OpenAPI spec (`nx-cache-server.openapi.json`) is a docs artifact and may change; `src/` may not.
- **Source of truth:** the HTTP API is documented only in `nx-cache-server.openapi.json`; the API Reference is generated from it. Never hand-write API tables that duplicate it.
- **Build gate:** `cd docs-site && bun run build` must pass after every task — it runs `starlight-links-validator`, so any broken internal link or missing heading anchor fails it.
- **Format:** run `bun run format` (from the repo root) on every changed Markdown/JSON file before committing; the CI gate is `bun run format --check`.
- **Humanizer:** run a humanizer pass on every new or revised passage before committing (use the `humanizer` skill if your harness exposes it; otherwise apply its principles — no em-dash overuse, no rule-of-three filler, no inflated phrasing). Match the existing docs' voice.
- **Conventional Commits:** use the exact commit message each task specifies.
- **Surgical:** every changed line traces to a gap in `docs/superpowers/specs/2026-06-30-docs-sync-audit-design.md`. Do not restyle pages the audit found sound.
- **Redirect mechanism:** Astro `redirects` is a top-level key in `defineConfig` (sibling to `integrations`), static-site compatible: `redirects: { '/old/': '/new/' }`.

---

### Task 1: Split deployment into a first-class "Deploy" group

Retire `guides/deployment.md` and split it by install path into three pages under a new `Deploy` sidebar group, add a redirect from the old URL, and repoint the one inbound internal link. This establishes the stable URL structure every later task links to.

**Files:**

- Create: `docs-site/src/content/docs/deploy/docker.md`
- Create: `docs-site/src/content/docs/deploy/kubernetes.md`
- Create: `docs-site/src/content/docs/deploy/binaries.md`
- Delete: `docs-site/src/content/docs/guides/deployment.md`
- Modify: `docs-site/astro.config.mjs` (add `redirects`, add `Deploy` sidebar group, drop `deployment` from `Guides`)
- Modify: `docs-site/src/content/docs/guides/configuration.md:48` (repoint the inbound link)

**Interfaces:**

- Produces these slugs that later tasks link to: `deploy/docker` (anchors `#health-checks`, `#direct-tls`), `deploy/kubernetes`, `deploy/binaries`.

- [ ] **Step 1: Create `deploy/docker.md`**

````md
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
````

- [ ] **Step 2: Create `deploy/kubernetes.md`**

````md
---
title: Kubernetes & Helm
description: Install the self-hosted Nx remote cache server on Kubernetes with the Helm chart — OCI install, values reference, S3 IRSA, probes, TLS, and graceful rolling updates.
---

A Helm chart is published to GHCR as an OCI artifact on every release. It defaults to filesystem storage with PersistentVolumeClaims for the token database and cache, and points its probes at the unauthenticated [`/health`](/deploy/docker/#health-checks) endpoint.

## Install

Install a released version straight from the registry:

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

## S3 with EKS IRSA

For S3 with EKS IRSA — no static keys, credentials resolved from the pod's IAM role:

```sh
helm install remotecache ./charts/remotecache \
  --set adminToken="change-me" \
  --set storage.strategy=s3 \
  --set s3.bucket=my-cache-bucket \
  --set s3.region=us-east-1 \
  --set serviceAccount.annotations."eks\.amazonaws\.com/role-arn"=arn:aws:iam::123456789012:role/remotecache
```

Leave `s3.accessKeyId` and `s3.secretAccessKey` empty to use the ServiceAccount's IAM role; the server resolves credentials through the AWS provider chain. See [Storage strategies](/guides/storage-strategies/) for the full credential model.

## TLS

Set `tls.enabled=true` and `tls.existingSecret` to a `kubernetes.io/tls` Secret; the chart mounts it and switches the probes to HTTPS. For most deployments, terminating TLS at an ingress is simpler. See [Direct TLS](/deploy/docker/#direct-tls) for the underlying behavior.

## Rolling updates

On `SIGTERM` the server drains in-flight requests before exiting, so rolling updates do not cut off active cache reads or writes — no extra `preStop` hook is needed.

The filesystem strategy stores cache entries on a single `ReadWriteOnce` volume, so keep `replicaCount: 1` unless you switch to S3 or provide a `ReadWriteMany` volume for the cache.

## Key values

| Value                                                        | Purpose                                                                                |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `replicaCount`                                               | Pod count. Keep at `1` with filesystem storage unless using S3 or an RWX cache volume. |
| `image.repository` / `image.tag`                             | Image to run; `tag` defaults to the chart `appVersion`.                                |
| `adminToken` / `existingSecret` / `existingSecretKey`        | Admin token literal, or a reference to an existing Secret.                             |
| `storage.strategy`                                           | `filesystem` (default) or `s3`.                                                        |
| `s3.*`                                                       | Bucket, region, endpoint, and optional static credentials.                             |
| `tls.*`                                                      | Direct-TLS toggle and the `kubernetes.io/tls` Secret.                                  |
| `persistence.*`                                              | PVC sizing for the token DB and cache.                                                 |
| `serviceAccount.annotations`                                 | IRSA and other cloud-identity annotations.                                             |
| `service.type` / `service.port`                              | Service exposure (`ClusterIP` by default).                                             |
| `config.bindAddress`                                         | Listen interface; `::` for IPv6 / dual-stack.                                          |
| `config.maxUploadBytes`                                      | Upload size cap.                                                                       |
| `config.verbose`                                             | Set `true` for verbose logging.                                                        |
| `resources`, `extraEnv`, `extraVolumes`, `extraVolumeMounts` | Standard overrides and escape hatches.                                                 |

See `charts/remotecache/values.yaml` for the full list and defaults.
````

- [ ] **Step 3: Create `deploy/binaries.md`**

````md
---
title: Standalone binaries
description: Download, verify, and run the self-hosted Nx remote cache server as a standalone executable for Linux, macOS, and Windows — no Bun or container runtime required.
---

Each release attaches standalone executables to the GitHub Release for Linux, macOS (x64 and arm64), and Windows (x64), along with a `checksums.txt`. The binary bundles everything it needs, so the host does not need Bun installed.

[Docker](/deploy/docker/) is still the recommended path for production; the binaries are handy for direct host installs and quick trials.

## Download and run

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

The server reads the same [environment variables](/guides/configuration/) as the container; `ADMIN_TOKEN` is the only required one.
````

- [ ] **Step 4: Delete the old page**

Run: `git rm docs-site/src/content/docs/guides/deployment.md`

- [ ] **Step 5: Update `astro.config.mjs` — add the redirect**

Find:

```js
export default defineConfig({
  site: 'https://remotecache.dev',
  integrations: [
```

Replace with:

```js
export default defineConfig({
  site: 'https://remotecache.dev',
  redirects: {
    '/guides/deployment/': '/deploy/docker/',
  },
  integrations: [
```

- [ ] **Step 6: Update `astro.config.mjs` — sidebar (add Deploy group, drop deployment from Guides)**

Find:

```js
        {
          label: 'Getting started',
          items: [{ label: 'Quickstart', slug: 'getting-started/quickstart' }],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Configuration', slug: 'guides/configuration' },
            { label: 'Storage strategies', slug: 'guides/storage-strategies' },
            { label: 'Token & admin API', slug: 'guides/tokens' },
            { label: 'Security model', slug: 'guides/security' },
            { label: 'Migrate from @nx/s3-cache', slug: 'guides/migrate-from-nx-s3-cache' },
            { label: 'Deployment', slug: 'guides/deployment' },
          ],
        },
```

Replace with:

```js
        {
          label: 'Getting started',
          items: [{ label: 'Quickstart', slug: 'getting-started/quickstart' }],
        },
        {
          label: 'Deploy',
          items: [
            { label: 'Docker', slug: 'deploy/docker' },
            { label: 'Kubernetes & Helm', slug: 'deploy/kubernetes' },
            { label: 'Standalone binaries', slug: 'deploy/binaries' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Configuration', slug: 'guides/configuration' },
            { label: 'Storage strategies', slug: 'guides/storage-strategies' },
            { label: 'Token & admin API', slug: 'guides/tokens' },
            { label: 'Security model', slug: 'guides/security' },
            { label: 'Migrate from @nx/s3-cache', slug: 'guides/migrate-from-nx-s3-cache' },
          ],
        },
```

- [ ] **Step 7: Repoint the one inbound link in `configuration.md:48`**

Find:

```
For most deployments, terminate TLS at an ingress or reverse proxy instead. See [Deployment](/guides/deployment/) for the direct-TLS and Helm details.
```

Replace with:

```
For most deployments, terminate TLS at an ingress or reverse proxy instead. See [Docker](/deploy/docker/#direct-tls) for direct TLS and [Kubernetes & Helm](/deploy/kubernetes/) for the chart.
```

- [ ] **Step 8: Confirm no other inbound links break**

Run: `grep -rn "/guides/deployment" docs-site/src`
Expected: no output (the only reference was `configuration.md`, now repointed).

- [ ] **Step 9: Humanize the new prose, then build and format**

Run a humanizer pass over the three new pages' prose. Then:

Run: `cd docs-site && bun run build`
Expected: build succeeds; `starlight-links-validator` reports no broken links; `/deploy/docker/`, `/deploy/kubernetes/`, `/deploy/binaries/`, and `/api/` all build.

Run: `cd /Users/trao/git/remotecache/.agents/worktrees/teardown-fix && bun run format docs-site/src/content/docs/deploy docs-site/astro.config.mjs docs-site/src/content/docs/guides/configuration.md`
Expected: files formatted, no diff on re-run.

- [ ] **Step 10: Commit**

```bash
git add docs-site/src/content/docs/deploy docs-site/astro.config.mjs docs-site/src/content/docs/guides/configuration.md
git add -A docs-site/src/content/docs/guides/deployment.md
git commit -m "docs(deploy): split deployment into docker, kubernetes, and binaries pages"
```

---

### Task 2: Correct the OpenAPI specification

Fix the API contract so the generated API Reference matches the code: the token-list response omits `value`, `POST /v1/admin/tokens` can return `409`, and `Content-Length` is an integer. (500 responses are intentionally left undocumented — standard OpenAPI practice; do not add them.)

**Files:**

- Modify: `nx-cache-server.openapi.json`

- [ ] **Step 1: Fix the `Content-Length` parameter type**

Find:

```json
            "required": true,
            "schema": {
              "type": "number"
            },
            "name": "Content-Length"
```

Replace with:

```json
            "required": true,
            "schema": {
              "type": "integer",
              "minimum": 1
            },
            "name": "Content-Length"
```

- [ ] **Step 2: Add a description to the `GET /v1/cache/{hash}` path parameter**

Find (the GET block's parameters — note no `description`):

```json
        "parameters": [
          {
            "name": "hash",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ]
      }
    },
    "/v1/admin/tokens": {
```

Replace with:

```json
        "parameters": [
          {
            "name": "hash",
            "description": "The task hash corresponding to the cache artifact to download.",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ]
      }
    },
    "/v1/admin/tokens": {
```

- [ ] **Step 3: Fix the `GET /v1/admin/tokens` 200 description**

Find:

```json
          "200": {
            "description": "A list of tokens. Note: token values are masked.",
```

Replace with:

```json
          "200": {
            "description": "A list of tokens. Token values are omitted; they are stored hashed and cannot be recovered.",
```

- [ ] **Step 4: Add `409` to `POST /v1/admin/tokens`**

Find (the POST responses block ending):

```json
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "403": {
            "$ref": "#/components/responses/AccessForbidden"
          }
        }
      }
    },
    "/v1/admin/tokens/{token}": {
```

Replace with:

```json
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "403": {
            "$ref": "#/components/responses/AccessForbidden"
          },
          "409": {
            "$ref": "#/components/responses/Conflict"
          }
        }
      }
    },
    "/v1/admin/tokens/{token}": {
```

- [ ] **Step 5: Fix the `TokenRecord.value` description**

Find:

```json
          "value": {
            "type": "string",
            "description": "The token value. Returned unmasked only when creating a token; listing tokens returns masked values."
          },
```

Replace with:

```json
          "value": {
            "type": "string",
            "description": "The token value. Returned only when creating a token; absent from list responses."
          },
```

- [ ] **Step 6: Add the `TokenSummary` schema**

Find:

```json
      "AddTokenRequest": {
```

Replace with:

```json
      "TokenSummary": {
        "type": "object",
        "required": ["id", "permission"],
        "properties": {
          "id": {
            "type": "string",
            "description": "A human-friendly identifier for the token (e.g. a CI system name)."
          },
          "permission": {
            "$ref": "#/components/schemas/TokenPermission"
          }
        }
      },
      "AddTokenRequest": {
```

- [ ] **Step 7: Point `ListTokensResponse` at `TokenSummary`**

Find:

```json
          "tokens": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/TokenRecord"
            }
          }
```

Replace with:

```json
          "tokens": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/TokenSummary"
            }
          }
```

- [ ] **Step 8: Add the `Conflict` response component**

Find:

```json
      "BadRequest": {
        "description": "Bad request",
        "content": {
          "text/plain": {
            "schema": {
              "$ref": "#/components/schemas/PlainTextError"
            }
          }
        }
      },
```

Replace with:

```json
      "BadRequest": {
        "description": "Bad request",
        "content": {
          "text/plain": {
            "schema": {
              "$ref": "#/components/schemas/PlainTextError"
            }
          }
        }
      },
      "Conflict": {
        "description": "Conflict — the token id or value already exists",
        "content": {
          "text/plain": {
            "schema": {
              "$ref": "#/components/schemas/PlainTextError"
            }
          }
        }
      },
```

- [ ] **Step 9: Validate JSON, rebuild the API Reference, format**

Run: `cd /Users/trao/git/remotecache/.agents/worktrees/teardown-fix && bun -e "JSON.parse(await Bun.file('nx-cache-server.openapi.json').text()); console.log('valid json')"`
Expected: `valid json`

Run: `cd docs-site && bun run build`
Expected: build succeeds; the API Reference regenerates with the new `TokenSummary`, the `409`, and the integer `Content-Length`.

Run: `cd /Users/trao/git/remotecache/.agents/worktrees/teardown-fix && bun run format nx-cache-server.openapi.json`
Expected: formatted, no diff on re-run.

- [ ] **Step 10: Commit**

```bash
git add nx-cache-server.openapi.json
git commit -m "docs(api): correct token list schema, add 409, and fix content-length type"
```

---

### Task 3: Correct the S3 credential story (storage, migration, configuration)

Rewrite the credential framing so only `S3_BUCKET` reads as required, document the AWS provider chain / IRSA, `S3_SESSION_TOKEN`, and the `AWS_REGION` fallback, and note the filesystem atomic write.

**Files:**

- Modify: `docs-site/src/content/docs/guides/storage-strategies.md`
- Modify: `docs-site/src/content/docs/guides/migrate-from-nx-s3-cache.md`
- Modify: `docs-site/src/content/docs/guides/configuration.md`

- [ ] **Step 1: `storage-strategies.md` — note the atomic filesystem write**

Find:

```
In production, mount a persistent volume at `./cache`, or point `CACHE_DIR` at a path that survives restarts. See [Configuration](/guides/configuration/) for all environment variables.
```

Replace with:

```
In production, mount a persistent volume at `./cache`, or point `CACHE_DIR` at a path that survives restarts. See [Configuration](/guides/configuration/) for all environment variables.

Writes are atomic: each upload streams to a `${hash}.tmp` file and is renamed into place only on success, so a partial or failed upload never appears as a readable cache entry.
```

- [ ] **Step 2: `storage-strategies.md` — rewrite the S3 section**

Find (the whole `## S3-compatible storage` section, lines 14–27):

````
## S3-compatible storage

Set `STORAGE_STRATEGY=s3` plus the four required `S3_*` variables. `S3_ENDPOINT` is optional; only needed for MinIO or other S3-compatible providers:

```sh
export STORAGE_STRATEGY=s3
export S3_REGION=us-east-1
export S3_BUCKET=nx-cache
export S3_ACCESS_KEY_ID=...
export S3_SECRET_ACCESS_KEY=...
export S3_ENDPOINT="http://localhost:9000"  # optional (MinIO, etc.)
````

With S3 there is no local cache directory to persist; the bucket handles durability.

```

Replace with:

```

## S3-compatible storage

Set `STORAGE_STRATEGY=s3` and `S3_BUCKET` — the bucket is the only required S3 variable. `S3_REGION` (or the standard `AWS_REGION`) sets the region, and `S3_ENDPOINT` is needed only for MinIO or other S3-compatible providers. Provide credentials one of two ways.

**Static keys.** Set `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` (and `S3_SESSION_TOKEN` for temporary STS credentials). When both keys are set, they take precedence over any ambient credentials.

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

```

- [ ] **Step 3: `migrate-from-nx-s3-cache.md` — fix the credential framing**

Find:

```

Set `STORAGE_STRATEGY=s3` on the server process along with the four required `S3_*` variables:

```sh
export STORAGE_STRATEGY=s3
export S3_REGION=us-east-1          # same region as your existing bucket
export S3_BUCKET=your-nx-cache      # existing bucket name, or a fresh one
export S3_ACCESS_KEY_ID=...         # existing or new IAM credentials
export S3_SECRET_ACCESS_KEY=...
# export S3_ENDPOINT="..."          # only for MinIO or other S3-compatible providers
```

```

Replace with:

```

Set `STORAGE_STRATEGY=s3` and `S3_BUCKET` on the server process. Reuse your existing IAM keys if you have them, or omit the keys on EKS, ECS, or EC2 and let the server use the IRSA / instance role:

```sh
export STORAGE_STRATEGY=s3
export S3_REGION=us-east-1          # same region as your existing bucket (or AWS_REGION)
export S3_BUCKET=your-nx-cache      # existing bucket name, or a fresh one
# export S3_ACCESS_KEY_ID=...       # omit on EKS IRSA / ECS / EC2 instance role
# export S3_SECRET_ACCESS_KEY=...
# export S3_ENDPOINT="..."          # only for MinIO or other S3-compatible providers
```

```

- [ ] **Step 4: `configuration.md` — fix the `S3_REGION` row and add an `AWS_REGION` row**

Find:

```

| `S3_REGION` | for s3 | — | S3 region. |
| `S3_BUCKET` | for s3 | — | S3 bucket. |

```

Replace with:

```

| `S3_REGION` | no | — | S3 region. Falls back to `AWS_REGION`; omit both when the SDK can infer it (IRSA, ECS, EC2). |
| `AWS_REGION` | no | — | Standard AWS region variable; used when `S3_REGION` is unset. |
| `S3_BUCKET` | for s3 | — | S3 bucket. The only required S3 variable. |

```

- [ ] **Step 5: `configuration.md` — `VERBOSE` accepts `true`**

Find:

```

| `VERBOSE` | no | — | Set `1` to print `logger.info`/`logger.log` output; errors always print. |

```

Replace with:

```

| `VERBOSE` | no | — | Set `1` or `true` to print `logger.info`/`logger.log` output; errors always print. |

```

Find:

```

Errors always print. Set `VERBOSE=1` to also see request details and cache hits/misses.

```

Replace with:

```

Errors always print. Set `VERBOSE=1` (or `true`) to also see request details and cache hits/misses.

````

- [ ] **Step 6: Humanize, build, format**

Run a humanizer pass over the rewritten S3 sections. Then:

Run: `cd docs-site && bun run build`
Expected: build succeeds; no broken links (the new `/deploy/kubernetes/` link resolves).

Run: `cd /Users/trao/git/remotecache/.agents/worktrees/teardown-fix && bun run format docs-site/src/content/docs/guides/storage-strategies.md docs-site/src/content/docs/guides/migrate-from-nx-s3-cache.md docs-site/src/content/docs/guides/configuration.md`
Expected: formatted, no diff on re-run.

- [ ] **Step 7: Commit**

```bash
git add docs-site/src/content/docs/guides/storage-strategies.md docs-site/src/content/docs/guides/migrate-from-nx-s3-cache.md docs-site/src/content/docs/guides/configuration.md
git commit -m "docs(storage): document optional static keys and the aws credential chain"
````

---

### Task 4: Correct the security model page

Fix the hash-validation framing (all dots rejected, 128-char cap, the `${hash}.tmp` rationale), the `Content-Length` wording, and replace the hand-maintained status tables with a link to the generated API Reference so they cannot drift.

**Files:**

- Modify: `docs-site/src/content/docs/guides/security.md`

- [ ] **Step 1: Fix the hash-validation paragraph**

Find:

```
Cache hash parameters are validated before any storage access (`src/cache/is-valid-hash.ts`), rejecting path traversal sequences and anything that doesn't match the expected hash format with `400`.

`PUT /v1/cache/:hash` requires a valid `Content-Length` header (a non-negative integer). Requests without one, or with a non-integer value, return `400`.
```

Replace with:

```
Cache hash parameters are validated before any storage access against `[A-Za-z0-9_-]`, 1–128 characters (`src/cache/is-valid-hash.ts`). All dots are rejected — not only `..` — so a hash can never collide with the filesystem strategy's `${hash}.tmp` write path or resolve to the cache directory or its parent. Anything outside that allowlist, or longer than 128 characters, returns `400`.

`PUT /v1/cache/:hash` requires a valid `Content-Length` header (a positive integer). Requests without one, or with a non-integer or non-positive value, return `400`.
```

- [ ] **Step 2: Replace the HTTP status tables with an API Reference link**

Find (the whole `## HTTP status reference` section through the end of the PUT table):

```
## HTTP status reference

### `GET /v1/cache/:hash`

| Status | Meaning                                                    |
| ------ | ---------------------------------------------------------- |
| `200`  | Entry found; body is `application/octet-stream`            |
| `400`  | Hash is invalid (rejects path traversal / malformed input) |
| `403`  | Token lacks read permission                                |
| `404`  | Entry not found                                            |

### `PUT /v1/cache/:hash`

| Status | Meaning                                                 |
| ------ | ------------------------------------------------------- |
| `200`  | Entry written                                           |
| `400`  | `Content-Length` missing or invalid, or hash is invalid |
| `403`  | Token lacks write permission                            |
| `409`  | Entry already exists                                    |
| `413`  | Upload exceeds `MAX_UPLOAD_BYTES`                       |
```

Replace with:

```
## HTTP status reference

The [API Reference](/api/) lists the exact status codes, request, and response shapes for every endpoint, generated from the OpenAPI specification.
```

- [ ] **Step 3: Humanize, build, format**

Run a humanizer pass over the rewritten paragraph. Then:

Run: `cd docs-site && bun run build`
Expected: build succeeds; the `/api/` link is accepted (it is excluded from link validation by design).

Run: `cd /Users/trao/git/remotecache/.agents/worktrees/teardown-fix && bun run format docs-site/src/content/docs/guides/security.md`
Expected: formatted, no diff on re-run.

- [ ] **Step 4: Commit**

```bash
git add docs-site/src/content/docs/guides/security.md
git commit -m "docs(security): correct hash validation framing and link the api reference"
```

---

### Task 5: Correct the releases page

Fix the prerelease publishing description (every `v*` tag publishes Helm + binaries; only stable tags move `latest`) and add the `sha-<short>` tag to the Tag-policy section.

**Files:**

- Modify: `docs-site/src/content/docs/contributing/releases.md`

- [ ] **Step 1: Add `sha-<short>` to the Tag-policy section**

Find:

```
`latest` is reserved for the latest stable release. `edge` is reserved for the latest successful `main` build. Release tags publish `X.Y.Z` and `X.Y` image tags.
```

Replace with:

```
`latest` is reserved for the latest stable release. `edge` is reserved for the latest successful `main` build, alongside a `sha-<short>` tag pinned to the exact commit. Stable release tags publish `X.Y.Z` and `X.Y` image tags.
```

- [ ] **Step 2: Fix the prerelease publishing paragraph**

Find:

```
Main builds publish `edge` and `sha-<short>`. Stable release tags publish `latest`, `X.Y.Z`, and `X.Y`; a prerelease tag (e.g. `v3.0.0-rc.1`) publishes only the exact `X.Y.Z-…` image and never updates `latest`. Release images are pushed for `linux/amd64` and `linux/arm64` with SBOM and provenance. Release tags also publish the Helm chart and the Core 5 binaries (linux/macOS/Windows).
```

Replace with:

```
Main builds publish `edge` and `sha-<short>`. Every version tag (`v*.*.*`, including prereleases) publishes the Helm chart, the Core 5 binaries (linux/macOS/Windows), and the exact `X.Y.Z` image; stable release tags additionally move `latest`, `X.Y.Z`, and `X.Y`, while a prerelease tag (e.g. `v3.0.0-rc.1`) never updates `latest`. Release images are pushed for `linux/amd64` and `linux/arm64` with SBOM and provenance.
```

- [ ] **Step 3: Humanize, build, format**

Run a humanizer pass. Then:

Run: `cd docs-site && bun run build`
Expected: build succeeds.

Run: `cd /Users/trao/git/remotecache/.agents/worktrees/teardown-fix && bun run format docs-site/src/content/docs/contributing/releases.md`
Expected: formatted, no diff on re-run.

- [ ] **Step 4: Commit**

```bash
git add docs-site/src/content/docs/contributing/releases.md
git commit -m "docs(releases): clarify prerelease publishing and the sha tag"
```

---

### Task 6: Surface the Deploy section (homepage, quickstart, compare)

Make the new install paths discoverable from the first-run flow: a homepage Deploy action and card link, a `/health` verify step plus a Deploy entry in the quickstart's Next Steps, and a fix to the stale compare-page sentence.

**Files:**

- Modify: `docs-site/src/content/docs/index.mdx`
- Modify: `docs-site/src/content/docs/getting-started/quickstart.md`
- Modify: `docs-site/src/content/docs/compare/nx-cloud.md`

- [ ] **Step 1: `index.mdx` — add a Deploy hero action**

Find:

```yaml
- text: Why this exists
  link: /why/
  icon: open-book
  variant: minimal
```

Replace with:

```yaml
- text: Deploy
  link: /deploy/docker/
  icon: rocket
  variant: minimal
- text: Why this exists
  link: /why/
  icon: open-book
  variant: minimal
```

- [ ] **Step 2: `index.mdx` — link the container card to Deploy**

Find:

```mdx
<Card title="One small Bun container" icon="seti:typescript">
  `Bun.serve` + `bun:sqlite`, shipped as a non-root image on GHCR.
</Card>
```

Replace with:

```mdx
<Card title="One small Bun container" icon="seti:typescript">
  `Bun.serve` + `bun:sqlite`, shipped as a non-root image on GHCR. [Deploy it →](/deploy/docker/)
</Card>
```

- [ ] **Step 3: `quickstart.md` — add a `/health` verify step**

Find:

```
Starts on `http://localhost:3000` by default. The [Configuration](/guides/configuration/) page covers all the environment variables — port, storage, upload limits, and more.
```

Replace with:

````
Starts on `http://localhost:3000` by default. The [Configuration](/guides/configuration/) page covers all the environment variables — port, storage, upload limits, and more.

Verify it is up with the unauthenticated health check:

```sh
curl -fsS http://localhost:3000/health
````

```

- [ ] **Step 4: `quickstart.md` — add Deploy to Next steps**

Find:

```

## Next steps

- [Why self-host?](/why/) — the case for running your own Nx remote cache instead of Nx Cloud.

```

Replace with:

```

## Next steps

- [Deploy](/deploy/docker/) — run it as a container, on Kubernetes, or as a standalone binary, with health checks and TLS.
- [Why self-host?](/why/) — the case for running your own Nx remote cache instead of Nx Cloud.

```

- [ ] **Step 5: `compare/nx-cloud.md` — fix the stale quickstart sentence**

Find:

```

Setup takes about five minutes. The [quickstart guide](/getting-started/quickstart/) walks through Docker Compose or Kubernetes deployment with token configuration.

```

Replace with:

```

Setup takes about five minutes. The [quickstart guide](/getting-started/quickstart/) starts the server, creates a token, and points Nx at it; the [deployment guide](/deploy/docker/) covers Docker, Kubernetes, and standalone-binary installs.

````

- [ ] **Step 6: Humanize, build, format**

Run a humanizer pass over the changed prose. Then:

Run: `cd docs-site && bun run build`
Expected: build succeeds; the homepage, quickstart, and compare links to `/deploy/...` all resolve.

Run: `cd /Users/trao/git/remotecache/.agents/worktrees/teardown-fix && bun run format docs-site/src/content/docs/index.mdx docs-site/src/content/docs/getting-started/quickstart.md docs-site/src/content/docs/compare/nx-cloud.md`
Expected: formatted, no diff on re-run.

- [ ] **Step 7: Commit**

```bash
git add docs-site/src/content/docs/index.mdx docs-site/src/content/docs/getting-started/quickstart.md docs-site/src/content/docs/compare/nx-cloud.md
git commit -m "docs(site): surface the deploy guide from the homepage and quickstart"
````

---

### Task V: Final verification

Confirm the whole site is green and every documented surface matches the code.

- [ ] **Step 1: Format check (CI gate)**

Run: `cd /Users/trao/git/remotecache/.agents/worktrees/teardown-fix && bun run format --check`
Expected: `All matched files use the correct format.`

- [ ] **Step 2: Full docs build with link validation**

Run: `cd docs-site && bun run build`
Expected: build succeeds; `starlight-links-validator` reports no errors; the API Reference and all `/deploy/*` pages render.

- [ ] **Step 3: Redirect is wired**

Run: `cd /Users/trao/git/remotecache/.agents/worktrees/teardown-fix && grep -n "guides/deployment" docs-site/astro.config.mjs`
Expected: one line — the redirect entry `'/guides/deployment/': '/deploy/docker/'`. No content file references the old slug (already checked in Task 1).

- [ ] **Step 4: Every env var the code reads is in `configuration.md`**

Run:

```bash
cd /Users/trao/git/remotecache/.agents/worktrees/teardown-fix
for v in ADMIN_TOKEN PORT BIND_ADDRESS TOKENS_DB_PATH MAX_UPLOAD_BYTES VERBOSE TLS_CERT_PATH TLS_KEY_PATH STORAGE_STRATEGY CACHE_DIR S3_BUCKET S3_REGION AWS_REGION S3_ENDPOINT S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY S3_SESSION_TOKEN; do
  grep -q "$v" docs-site/src/content/docs/guides/configuration.md || echo "MISSING: $v"
done
echo "env-var check done"
```

Expected: `env-var check done` with no `MISSING:` lines.

- [ ] **Step 5: OpenAPI is valid and reflects the fixes**

Run:

```bash
cd /Users/trao/git/remotecache/.agents/worktrees/teardown-fix
bun -e "const s=JSON.parse(await Bun.file('nx-cache-server.openapi.json').text()); console.log('TokenSummary', !!s.components.schemas.TokenSummary); console.log('Conflict', !!s.components.responses.Conflict); console.log('tokens409', !!s.paths['/v1/admin/tokens'].post.responses['409']);"
```

Expected: all three print `true`.

- [ ] **Step 6: Clean tree**

Run: `git status --short`
Expected: empty (all six task commits made; nothing uncommitted).

---

## Self-Review

**Spec coverage:** Every gap in `2026-06-30-docs-sync-audit-design.md` maps to a task — High gaps 1 (Task 3), 2 + 3 (Task 2), 4 (Tasks 1 + 6); Med gaps 5–7 (Task 3), 8–9 (Task 1, in `deploy/docker.md` + `deploy/kubernetes.md`), 10 (Task 4), 11 (Task 5), 12–13 (Task 6), 14 (Task 2); Low gaps 15 (Task 3), 17 (Task 3), 18 (Task 1), 19 (Task 5), 20 (Task 4). Gap 16 (OpenAPI 500s) is intentionally not implemented (documented decision in Task 2). The IA restructure is Task 1.

**Placeholder scan:** No TBDs. New pages carry full content; edits show exact find/replace. `X.Y.Z` in commands is a deliberate user-substituted placeholder (a real version at runtime), not a plan gap.

**Type/name consistency:** Slugs `deploy/docker`, `deploy/kubernetes`, `deploy/binaries` are used identically in the sidebar (Task 1), cross-links (Tasks 1, 3, 6), and the redirect target. The OpenAPI `TokenSummary` schema name and `Conflict` response name match across Steps 6–8 of Task 2. Anchors `#health-checks` and `#direct-tls` match the `## Health checks` and `## Direct TLS` headings in `deploy/docker.md`.

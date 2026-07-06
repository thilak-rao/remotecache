# remotecache Roadmap — Audit Remediation & Growth

> Master roadmap derived from the 2026-07-05 full-repo audit (code/test debt, CI/CD, security, competitive landscape). Each phase gets its own detailed implementation plan when work starts; only Phase 1 is planned in detail so far.

**Context:** remotecache already has the strongest feature set in the Nx self-hosted cache niche (only tiered-token auth, only Prometheus metrics, only token admin API, best deployment matrix). The niche has no leader (top competitor: 35 stars), Nx lists no third-party servers in its docs, and the May 2026 `@nx/*-cache` deprecation orphaned a large user base. The gap to winning is distribution, not features — but two correctness bugs contradict the project's own security docs and must be fixed before scaling up promotion.

## Phase 1 — Credibility hardening (P0 + P1) — ~1–2 weeks

Detailed plan: [`2026-07-05-phase-1-hardening.md`](./2026-07-05-phase-1-hardening.md)

1. Isolate e2e specs in spawned server processes (kills import-order flakiness, stale-DB cleanup bug)
2. Filesystem atomic first-writer-wins commit (fixes the TOCTOU race that breaks the documented append-only guarantee)
3. Honor `MAX_UPLOAD_BYTES` above Bun's 128 MiB default `maxRequestBodySize`
4. Delete tokens by `id` instead of plaintext value (breaking; makes revocation always possible, keeps secrets out of URLs)
5. Enforce a 16-character minimum on `ADMIN_TOKEN`; purge `change-me` from all docs
6. Helm: `Recreate` strategy (RWO PVC deadlock), guard `replicaCount > 1`, default resource requests/limits
7. Strict TypeScript typecheck gate in CI; fix the two known type lies
8. S3 multipart flush batching (stop flushing per chunk)
9. Static invalid-JSON error message (stop reflecting request bodies)
10. Workflow hygiene: pin Bun, least-privilege permissions, concurrency groups, Dependabot for `docs-site/`

Cut a release when Phase 1 lands (several items are breaking → major version bump via release-please).

## Phase 2 — Test & release infrastructure (P2) — ~2–3 weeks

Detailed plan: [`2026-07-05-phase-2-infrastructure.md`](./2026-07-05-phase-2-infrastructure.md). Items, from the audit:

- MinIO service container in CI + real S3 e2e (exists/getStream/getSize/writeStream, credential-refresh coalescing, multipart abort)
- S3 TOCTOU: resolved — Bun's S3 client has no `If-None-Match` conditional-write support (verified 2026-07-05), so the residual race is documented in the security guide instead
- Concurrency + large-payload e2e (two simultaneous PUTs to one hash over HTTP; Content-Length mismatch over a real socket)
- kind-based `helm install` test + `helm test` connection hook; kubeconform manifest validation
- Cross-platform binary smoke matrix (darwin x64/arm64, linux-arm64 via QEMU, windows-x64)
- De-duplicate `ci.yml` vs `publish-image.yml` preflight into a reusable workflow
- Shutdown drain deadline (`Promise.race` with ~30 s ceiling against slow-loris uploads)
- Consolidated config module: fail loud on unknown `STORAGE_STRATEGY`, validate `CACHE_DIR` writability at startup
- Release polish: cosign signatures (image, chart, checksums), SBOM for binaries, wire `Chart.yaml` version into release-please, PAT → GitHub App token
- Doc drift: OpenAPI 500 responses on GET/PUT; unbounded-growth warning + pruning runbook; multi-replica caveat page
- Helm extras: ServiceMonitor (gated), PodDisruptionBudget, `readOnlyRootFilesystem: true` default, optional Ingress template

## Phase 3 — Category-defining features — ~3–5 weeks

Each feature needs brainstorming (`superpowers:brainstorming`) before its plan:

1. **Cache eviction/GC** — shipped: opt-in `CACHE_MAX_BYTES` LRU cap + `CACHE_TTL_HOURS` sweep
   (spec: [`../specs/2026-07-06-cache-eviction-design.md`](../specs/2026-07-06-cache-eviction-design.md),
   plan: [`2026-07-06-cache-eviction.md`](./2026-07-06-cache-eviction.md)). The S3 lifecycle recipe
   already landed in Phase 2.
2. **GCS + Azure Blob storage strategies** — captures migrating `@nx/gcs-cache` / `@nx/azure-cache` users. Contained additions behind `CacheStorageStrategy`; requires the Phase 2 integration-test harness first.
3. Optional deep `/ready` probe (backend reachability) to pair with the Helm readiness probe.

## Phase 4 — Distribution blitz (run in parallel with Phase 3)

- Post remotecache in the Nx RFC discussion (nrwl/nx#30548); open an nx.dev issue/PR proposing a "community implementations" section on the self-hosted-caching page
- One-click deploy templates: Railway, Render, Fly.io
- List the Helm chart on Artifact Hub; mirror the image to Docker Hub
- SEO: cross-post the `/why/` story to dev.to/Medium targeting "nx self-hosted cache deprecated alternative"; announce in the Nx Discord
- README: state the CREEP answer explicitly ("append-only writes + read-only CI tokens — the mitigations the deprecated plugins lacked")
- OpenSSF Best Practices badge; coverage reporting + badge

## Phase 5 — Differentiators (pick by traction)

- Web UI / stats dashboard (hit rate, cache size, top artifacts) — nothing in either the Nx or Turborepo niche has one
- OIDC/JWKS auth (GitHub Actions OIDC tokens with read/write scopes) — removes long-lived CI secrets
- Zero-infra CI sidecar recipe (standalone binary inside GH Actions/GitLab CI, FS storage persisted via the CI cache)
- Audit logging (`{ts, tokenId, method, hash, status}` for PUTs and admin ops, not VERBOSE-gated)
- Token expiry (`expiresAt` column, checked in `findToken`)
- Artifact integrity metadata (SHA-256 sidecar computed during the counted-stream pass, exposed as `ETag`/`X-Content-SHA256`)
- zstd storage compression (low priority — Nx artifacts are already compressed tarballs)

## Explicit non-goals

Multi-region replication, remote execution, Redis backends, gRPC/REAPI. Thesis: the boring, secure, operable Nx cache server.

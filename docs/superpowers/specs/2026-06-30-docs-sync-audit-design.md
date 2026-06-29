# Design: Documentation Sync + DevRel Pass for the `teardown-fix` Branch

Date: 2026-06-30

## Goal

Make the documentation accurately and discoverably reflect every surface the
`teardown-fix` branch shipped, before the branch lands on `main`. This folds the
roadmap's deferred step 15 ("final docs-site revision") forward: in addition to
correcting factual drift, it restructures the deployment content into a
first-class, discoverable "Deploy" section.

This is a docs-only change. The code on this branch is correct; where docs and
code disagree, the docs are wrong and get fixed to match the code.

## Project Context

The branch is 45 commits ahead of `main`, unmerged. It added: a `/health`
endpoint, direct TLS (`TLS_CERT_PATH`/`TLS_KEY_PATH`), `BIND_ADDRESS` (incl.
IPv6 `::`), graceful SIGTERM/SIGINT request draining, hash hardening (reject
dots, cap length at 128), S3 credential resolution via the AWS provider chain
(static keys now optional; IRSA/ECS/IMDS fallback; `S3_SESSION_TOKEN`), a Helm
chart, Helm OCI publishing, standalone binary releases with provenance
attestation, and release-please.

Each prior plan updated docs as it landed, so the docs are not absent — they are
*drifted*. A six-pass audit (HTTP API/OpenAPI, env vars, storage/S3,
deployment/Helm, release/security, Starlight structure) found the gaps below.
The docs site is live at `https://remotecache.dev`, built with Astro Starlight;
`starlight-links-validator` already fails the build on broken internal links,
and the API Reference is generated from `nx-cache-server.openapi.json` (repo
root) via `starlight-openapi`.

## Gap Inventory (from the audit)

Severity reflects user impact: High = wrong/blocking, Med = incomplete/
misleading, Low = polish.

### High

1. **S3 credentials documented as required; IRSA/provider-chain undocumented.**
   Code requires only `S3_BUCKET`; static keys are optional and fall back to the
   AWS provider chain (env → EKS IRSA → ECS task role → EC2 IMDS)
   (`src/cache/create-cache-storage.ts:30,35,52`). Docs say the opposite:
   `storage-strategies.md:16` ("four required `S3_*` variables") and
   `migrate-from-nx-s3-cache.md:61` (same), and the provider chain is absent
   from both. Blocks every IRSA/ambient-credential user.
2. **OpenAPI `GET /v1/admin/tokens` response schema is wrong.** Code returns
   `{id, permission}` with no `value` (`src/token/list-tokens.ts:13`,
   `token-storage.ts:105-115`); `ListTokensResponse` references `TokenRecord`,
   which marks `value` required and "masked." Clients validating against the
   spec fail on the real response.
3. **OpenAPI missing `409` on `POST /v1/admin/tokens`.** Duplicate id/value
   returns 409 (`src/token/add-token.ts:74-78`); spec lists only 200/400/403.
4. **The deployment guide is effectively orphaned.** All five new surfaces live
   only on `deployment.md`, reachable via the sidebar plus one stray sentence.
   The quickstart's Next Steps never links it.

### Medium

5. `AWS_REGION` is read (`create-cache-storage.ts:30`) but missing from the
   `configuration.md` env-var table (prose-only).
6. `S3_REGION` is marked required "for s3" in `configuration.md:18`; code only
   requires `S3_BUCKET`.
7. `S3_SESSION_TOKEN` is supported (`create-cache-storage.ts:41`) but absent from
   the storage guide.
8. `BIND_ADDRESS` (incl. IPv6 `::`) is undocumented for Docker/binary operators.
9. Graceful shutdown / SIGTERM request draining (`src/main.ts:145-157`) is
   undocumented — operators need it for zero-downtime rolling updates.
10. Hash validation is framed as "path traversal" in `security.md:16,65`; it
    rejects **all** dots and caps length at **128** (`src/cache/is-valid-hash.ts:9`),
    to avoid collision with the filesystem `${hash}.tmp` write path.
11. Prerelease publishing wording in `releases.md:47` implies prerelease tags
    skip Helm/binaries; both jobs fire for every `v*` tag
    (`publish-image.yml:150,195`). Only *stable* tags move `latest`/`X.Y`/`X.Y.Z`.
12. `compare/nx-cloud.md:59` claims the quickstart "walks through Docker Compose
    or Kubernetes deployment" — it does not.
13. The new-user flow (`quickstart.md`) never shows the `/health` check the
    branch added.
14. OpenAPI `Content-Length` header is typed `number` (allows floats/sci-notation
    the server rejects at `write-cache.ts:17`); should be `integer, minimum 1`.

### Low

15. `VERBOSE` also accepts `true` (`src/logger.ts:1`); docs say only `1`.
16. OpenAPI omits `500` across all endpoints and the `GET /v1/cache/{hash}`
    `:hash` parameter has no description.
17. Filesystem atomic `${hash}.tmp` temp-then-rename write is undocumented.
18. `deployment.md` "Key values" list omits `config.verbose`, `service.type`,
    and `replicaCount` (+ the filesystem `replicaCount: 1` / RWX caveat).
19. `releases.md` Tag-policy section omits the `sha-<short>` tag.
20. `security.md` hand-maintains HTTP-status tables that duplicate — and will
    drift from — the generated API Reference.

**Verified sound (no change):** Starlight wiring (no orphaned pages, no broken
links, OpenAPI plugin correct, `/health` in the generated API ref), the
release/distribution facts (OCI path, checksums, attestation, `latest` prerelease
guard), token hashing + `timingSafeEqual`, and PORT/BIND_ADDRESS documented as
orthogonal.

## Design

### 1. Information architecture: a first-class "Deploy" group

Retire the `guides/deployment.md` monolith and split it by install path into a
new top-level sidebar group, placed between "Getting started" and "Guides":

| New page | Content |
| --- | --- |
| `deploy/docker.md` | Container image + the tag table, `docker run` (filesystem and S3), health checks, direct TLS (Docker), monitoring/metrics, and a `BIND_ADDRESS` note. This is the redirect target and the default deployment path. |
| `deploy/kubernetes.md` | Helm OCI install (`oci://ghcr.io/thilak-rao/charts/remotecache`) and local-chart install, the values reference (including `config.verbose`, `service.type`, `replicaCount` + the filesystem `replicaCount: 1` / RWX caveat), `existingSecret` flow, S3 IRSA via `serviceAccount.annotations`, the TLS secret, probes on `/health`, and graceful shutdown for rolling updates. |
| `deploy/binaries.md` | Download from the Releases page, verify with `checksums.txt` and `gh attestation verify`, run, and when to choose a binary over Docker (Docker stays the recommended production path). |

`astro.config.mjs` gains a `Deploy` sidebar group with these three entries and an
Astro `redirects` entry mapping `/guides/deployment/` → `/deploy/docker/` so the
live URL and its inbound links/SEO survive. The `Guides` group keeps
Configuration, Storage strategies, Token & admin API, Security model, and Migrate.

Cross-cutting concerns (TLS, health) are documented on the path where they apply
and cross-reference each other rather than being duplicated verbatim: the TLS
concept and the env-var contract live in `deploy/docker.md`; `deploy/kubernetes.md`
covers the chart's TLS secret and links back for the underlying behavior.

### 2. Accuracy corrections

Applied to the pages that own each surface:

- **`storage-strategies.md` + `migrate-from-nx-s3-cache.md`:** rewrite the S3
  credential story — `S3_BUCKET` is the only required variable; static
  `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` are optional and take precedence when
  both are set. Add an **Ambient / IAM-role credentials** subsection documenting
  the provider chain (env → IRSA → ECS task role → EC2 IMDS). Add
  `S3_SESSION_TOKEN` and the `AWS_REGION` fallback. Comment out the static keys
  in the migration snippet and note IRSA users omit them. (Gaps 1, 3, 5, 7)
- **`configuration.md`:** add an `AWS_REGION` row; change `S3_REGION` required
  from "for s3" to "no" with a fallback note; note `VERBOSE` accepts `1` or
  `true`. (Gaps 5, 6, 15)
- **`nx-cache-server.openapi.json`:** add a `TokenSummary` schema (`id` +
  `permission`) and point `ListTokensResponse.items` at it; add `409` to
  `POST /v1/admin/tokens`; change the `Content-Length` parameter to
  `integer, minimum 1`; add a shared `InternalServerError` response component
  wired to the paths that emit 500 and a description to the GET `:hash`
  parameter. (Gaps 2, 3, 14, 16)
- **`deploy/docker.md` + `deploy/kubernetes.md`:** document `BIND_ADDRESS`
  (incl. `::`), graceful SIGTERM/SIGINT draining, and the missing chart values
  with the `replicaCount` caveat. (Gaps 8, 9, 18)
- **`security.md`:** correct the hash-validation framing (all dots rejected,
  128-char cap, `${hash}.tmp` rationale); replace the two hand-written
  status-code tables with a link to the generated API Reference. (Gaps 10, 20)
- **`releases.md`:** correct the prerelease wording (all `v*` tags publish Helm +
  binaries; only stable tags move `latest`/`X.Y`/`X.Y.Z`); add `sha-<short>` to
  the Tag-policy section. (Gaps 11, 19)
- **`storage-strategies.md`:** one sentence on the filesystem atomic
  temp-then-rename write. (Gap 17)

### 3. Discoverability + cross-linking

- **Homepage (`index.mdx`):** add a `Deploy` hero action and link the "One small
  Bun container" card to `/deploy/docker/`.
- **Quickstart:** add a `curl -fsS http://localhost:3000/health` verify step and
  a real "Next Steps" list linking Deploy, Configuration, and Security.
- **`compare/nx-cloud.md`:** rewrite the stale sentence to describe the actual
  quickstart and link `/deploy/docker/` for container/Helm paths.
- Weave supporting cross-links: `storage-strategies.md` → `deploy/kubernetes.md`
  for IRSA; `why.md` → Deploy.

## Out of Scope

- Any source-code change. The code is correct; only docs and the OpenAPI spec
  (a docs artifact) change.
- New documentation features (search tuning, versioned docs, i18n, new
  components).
- The remaining roadmap work (S3 robustness + MinIO, real Nx e2e, CI DRY). Those
  resume after this lands on `main`.
- Restyling or rewriting pages the audit found sound, beyond the cross-links
  named above.

## Verification Strategy

- `cd docs-site && bun run build` — Astro build plus `starlight-links-validator`;
  fails on any broken internal link or dangling redirect target.
- `bun run format` on every changed Markdown/JSON file; the CI gate is
  `bun run format --check`.
- A **humanizer pass** on every rewritten or newly written passage before commit
  (per the project's human-facing-content rule).
- A grep proving every env var the code reads (`ADMIN_TOKEN`, `PORT`,
  `BIND_ADDRESS`, `TOKENS_DB_PATH`, `MAX_UPLOAD_BYTES`, `VERBOSE`,
  `TLS_CERT_PATH`, `TLS_KEY_PATH`, `STORAGE_STRATEGY`, `CACHE_DIR`, `S3_BUCKET`,
  `S3_REGION`, `AWS_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`,
  `S3_SECRET_ACCESS_KEY`, `S3_SESSION_TOKEN`) appears in `configuration.md`.
- Manual check: the redirect resolves and the three Deploy pages render with the
  new sidebar group.
- OpenAPI remains valid JSON and the generated API Reference still builds.

## Spec Self-Review

- **Placeholders:** none — every fix names its file and the correct content.
- **Consistency:** the IA section (3-page Deploy group + redirect) matches the
  accuracy section's page targets; the gap inventory maps 1:1 to fixes.
- **Scope:** focused on one branch's surfaces; the deployment split is the only
  structural change and is bounded to three pages + one redirect.
- **Ambiguity:** the credential rewrite is stated as "only `S3_BUCKET` required,
  static keys optional and take precedence" — one interpretation, matching the
  code.

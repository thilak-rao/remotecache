# Design: Release, CI/CD, Distribution, Security, and DX Hardening

Date: 2026-06-29

## Goal

Bring `remotecache` to a proper release and operations baseline:

- automated changelog and release management
- Docker images published from CI/CD after the right checks pass
- better audit and security gates
- Docker, Kubernetes, and release docs users can follow without reading source
- useful features borrowed from `IKatsuba/nx-cache-server`, adapted to this Bun
  codebase
- developer workflow improvements that save time without adding ceremony

This is one roadmap, implemented in phases. Each phase should land as a focused
PR or small group of related PRs.

## Project Context

Local checks found:

- Root `bun audit` is clean.
- `docs-site/bun audit` reports one high advisory:
  `starlight-openapi -> httpsnippet -> form-data@4.0.4`
  (`GHSA-hmw2-7cc7-3qxx`).
- `bun test` is not currently slow locally: 56 tests completed in about three
  seconds wall time on this machine.
- Docker publishing already exists, but release management is incomplete:
  there is no automated changelog, release PR, version manifest, or GitHub
  Release flow.
- Docs mention Docker, but they need production-level examples and clearer tag,
  persistence, upgrade, and healthcheck guidance.

The referenced repo, `IKatsuba/nx-cache-server`, is Deno/Hono-based and
S3-first. We should borrow its product features and workflow ideas, not its
runtime architecture.

## Grounded Tooling Decisions

### Release Management

Use `release-please-action@v5`.

Why:

- `googleapis/release-please-action` is active. Latest release checked during
  planning: `v5.0.0`, published 2026-04-22.
- `googleapis/release-please` is active. Latest release checked during
  planning: `v17.10.0`, published 2026-06-22.
- Release Please matches this repo's existing Conventional Commit rule.
- It creates a reviewable release PR before tagging and publishing. That is a
  better fit than direct publish-on-merge because releases will trigger Docker
  and Helm distribution.

Use a dedicated automation token, not the default `GITHUB_TOKEN`. The default
token suppresses follow-on workflow runs for events it creates. We want
release-please-created PRs, releases, and tags to trigger the normal CI and
publish workflows.

Implementation should use a least-privilege fine-grained PAT or GitHub App
token stored as a repository secret, for example `RELEASE_PLEASE_TOKEN`.

### Docker Publishing

Use the current Docker action stack:

- `docker/metadata-action@v6`
- `docker/setup-buildx-action@v4`
- `docker/setup-qemu-action@v3` for multi-platform builds
- `docker/build-push-action@v7`

Enable multi-platform images for:

- `linux/amd64`
- `linux/arm64`

Enable BuildKit SBOM and provenance output for release images.

### Image Tags

Use stable and edge tags deliberately:

- `latest` means the latest stable release.
- `edge` means the latest successful `main` build.
- `sha-<short>` is published for `main` builds.
- `X.Y.Z` and `X.Y` are published for release tags such as `v1.2.3`.

This changes the current meaning of `latest` if it is still published from
every `main` push at implementation time. The docs must call this out.

### Helm Publishing

Use Helm OCI publishing to GHCR:

- `helm package charts/remotecache --version <X.Y.Z> --app-version <X.Y.Z>`
- `helm registry login ghcr.io ...`
- `helm push remotecache-<X.Y.Z>.tgz oci://ghcr.io/<owner>/charts`

The chart version and app version should match the release-please version.

### Security Scanning

Use `aquasecurity/trivy-action@v0.36.0` for filesystem and image scans.

Keep the existing CodeQL, Scorecard, pinned Actions, and Dependabot setup.

## Scope

In scope:

- release-please workflow and config
- changelog and release manifest
- CI gate changes
- Docker publishing changes
- Helm chart and chart publishing
- `/health`
- optional direct TLS
- S3 integration test path
- real Nx cache-hit e2e path
- docs-site audit fix
- Docker, Helm, release, and DX docs
- useful package scripts

Out of scope:

- changing the Nx remote-cache API contract beyond adding `/health`
- replacing Bun with Node, Deno, Express, Hono, or another runtime
- adopting IKatsuba's S3-only model
- publishing an npm package
- broad refactors unrelated to the release, distribution, security, or DX work

## Phase 1: Release Management

Add:

- `.github/workflows/release.yml`
- `release-please-config.json`
- `.release-please-manifest.json`
- `CHANGELOG.md`

Recommended release-please behavior:

- trigger on push to `main`
- use `release-type: simple` or a manifest config with root package path `.`
- create release PRs using `RELEASE_PLEASE_TOKEN`
- create GitHub Releases and SemVer tags when the release PR merges
- use Conventional Commits for version calculation

Workflow permissions should remain explicit:

- `contents: write`
- `pull-requests: write`
- `issues: write`

Repository setup:

- add `RELEASE_PLEASE_TOKEN`
- ensure GitHub Actions can create pull requests
- document the token requirements in maintainer docs

Verification:

- a non-release commit on `main` opens or updates a release PR
- the release PR updates `CHANGELOG.md` and the manifest
- merging the release PR creates a GitHub Release and `vX.Y.Z` tag
- the tag triggers distribution workflows

## Phase 2: CI/CD Hardening

Keep `ci.yml` as the central PR quality gate.

Required PR checks should include:

- `bun run format --check`
- `bun run lint`
- `bun test`
- root `bun audit`
- `docs-site` audit
- docs build
- Docker build smoke test without publishing
- Trivy filesystem scan
- Helm lint/template once the chart exists

Docs build should install dependencies inside `docs-site` and run
`bun run build`.

Docker smoke should build the image locally and run a minimal container check.
Once `/health` exists, the smoke check should start the container with a test
`ADMIN_TOKEN` and call `/health`.

Publishing should not run on ordinary PRs.

For pushes to `main`:

- run the same gates
- publish `edge` and `sha-<short>` only after gates pass
- do not publish `latest`

For release tags:

- run or depend on the same gates
- publish stable image tags
- publish Helm chart

Implementation can either:

- keep publish workflows separate but trigger them only after successful CI, or
- repeat the minimal required checks inside the publish workflow.

The first option is cleaner, but GitHub `workflow_run` behavior and tag events
must be tested carefully. If it adds ambiguity, repeat the required checks in
the publish workflow.

## Phase 3: Distribution

### Docker

Revise `.github/workflows/publish-image.yml` or replace it with a distribution
workflow.

Main builds publish:

- `ghcr.io/thilak-rao/remotecache:edge`
- `ghcr.io/thilak-rao/remotecache:sha-<short>`

Release tags publish:

- `ghcr.io/thilak-rao/remotecache:X.Y.Z`
- `ghcr.io/thilak-rao/remotecache:X.Y`
- `ghcr.io/thilak-rao/remotecache:latest`

Use Docker metadata labels. Include SBOM and provenance for pushed release
images.

### Helm

Add `charts/remotecache/`, adapted from `IKatsuba/nx-cache-server`.

The chart should support:

- image repository, tag, pull policy
- `ADMIN_TOKEN` from an existing Secret or chart-created Secret
- filesystem persistence for `TOKENS_DB_PATH` and `CACHE_DIR`
- optional S3 configuration and S3 credentials
- `MAX_UPLOAD_BYTES`
- service account annotations for cloud identity use cases
- liveness/readiness probes using `/health`
- optional TLS secret mount for direct TLS
- extra env vars
- resources, node selectors, tolerations, affinity, pod labels, annotations,
  and security contexts

CI should run:

- `helm lint charts/remotecache`
- `helm template` with filesystem values
- `helm template` with S3 values
- `helm template` with TLS enabled

Release publishing should package the chart with the release version and push
it to GHCR as an OCI artifact.

## Phase 4: Borrowed Server Features

### Health Endpoint

Add unauthenticated:

- `GET /health`
- status `200`
- plain text body `OK`

This endpoint is for container healthchecks, Kubernetes probes, and basic
operator checks. Add it to OpenAPI because users and charts will depend on it.

### Optional Direct TLS

Add env vars:

- `TLS_CERT_PATH`
- `TLS_KEY_PATH`

Behavior:

- neither set: serve HTTP as today
- both set: read cert and key at startup, then serve HTTPS through `Bun.serve`
- only one set: log a configuration error and exit
- file read failure: log a configuration error and exit

Docs should say reverse proxy or ingress TLS is preferred for most deployments.
Direct TLS is for direct exposure, local testing, or environments where the
container terminates TLS itself.

Tests:

- config validation for neither/both/one env var
- HTTPS round-trip using fixture cert/key
- unauthenticated `/health` over HTTPS

### S3 Integration Path

Add a real S3-compatible integration test path.

Preferred path:

- evaluate a lightweight emulator compatible with Bun
- if it is reliable, use it for S3 integration tests

Fallback:

- use MinIO as a service container in CI
- keep it outside the default fast local `bun test` loop

The goal is to test this server's S3 storage strategy against a real endpoint,
not to mock Bun's S3 client forever.

### Real Nx E2E

Add a separate heavy e2e command that:

- creates a small Nx workspace
- starts `remotecache`
- configures `NX_SELF_HOSTED_REMOTE_CACHE_SERVER`
- configures `NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN`
- runs the same target twice
- asserts the second run reads from remote cache

Start this as a separate command, for example `bun test:e2e:nx`.

Do not put it in the default local `bun test` path unless it stays fast and
reliable. It can run in scheduled CI or manual CI first, then become required
once the runtime is acceptable.

## Phase 5: Security and Audit

Fix the docs-site advisory first.

Expected paths:

- update the docs-site lockfile if a compatible transitive fix exists
- add a targeted override only if the upstream chain does not resolve cleanly
- avoid removing `starlight-openapi` unless it blocks a clean fix

Add audit gates:

- root `bun audit`
- `cd docs-site && bun audit`

Add Trivy scans:

- filesystem scan on PRs
- image scan after Docker build
- SARIF upload where appropriate
- fail on high/critical issues unless a short documented allowlist is needed

Keep:

- CodeQL
- Scorecard
- pinned GitHub Actions
- Dependabot for Bun, Docker, and GitHub Actions

## Phase 6: Docs and Developer Experience

### Docs

Expand Docker docs with:

- image names and tag meanings
- `docker run` with filesystem storage
- `docker compose` example
- S3 example
- persistence for token DB and cache data
- upgrades and tag pinning
- healthcheck example
- reverse proxy and metrics exposure notes

Add Kubernetes/Helm docs with:

- install command
- values reference
- existing Secret flow
- filesystem persistence
- S3 configuration
- TLS secret mount
- probes
- upgrade flow

Add maintainer release docs with:

- Conventional Commit expectations
- release-please PR flow
- how `latest`, `edge`, `sha-*`, `X.Y.Z`, and `X.Y` are produced
- chart publishing
- what to check if a release does not publish

Update configuration docs for:

- `/health`
- `TLS_CERT_PATH`
- `TLS_KEY_PATH`

Update OpenAPI for `/health`.

Run human-facing docs through the humanizer guidance before shipping.

### Developer Experience

Add scripts where they reduce friction:

- `test:fast`
- `test:integration:s3`
- `test:e2e:nx`
- `audit`
- `audit:docs`
- possibly `docker:build` or `docker:smoke`

Add `.env.example` for local source runs.

Add Docker Compose examples under docs or `examples/`, not as a root runtime
requirement.

Update `CONTRIBUTING.md` with the new commands and release workflow.

Update PR checklist items for:

- audits
- docs build
- Docker smoke check when relevant
- release-impact notes

## Testing Strategy

Keep the fast loop fast.

Default local command:

- `bun test`

Integration commands:

- `bun test:integration:s3`
- `bun test:e2e:nx`

CI:

- PRs run fast tests, audits, docs build, Docker smoke, Trivy filesystem scan,
  and Helm checks.
- S3 integration and real Nx e2e can start as scheduled/manual if runtime is
  high, then move into required PR CI once stable.

Tests should prove intent:

- release workflows generate the expected artifacts
- health and TLS behavior match the documented contract
- Docker and Helm examples are deployable
- S3 storage works against a real compatible endpoint
- Nx can read a real cache hit from this server

No coverage target is added for its own sake.

## Implementation Order

1. Release-please config and changelog bootstrap.
2. CI audit/docs/Docker smoke gates.
3. Docker tag strategy and multi-platform publishing.
4. `/health` endpoint and docs/OpenAPI update.
5. Helm chart with lint/template checks.
6. Helm OCI publishing on release tags.
7. TLS support and tests.
8. S3 integration test path.
9. Real Nx e2e path.
10. Docs and DX cleanup.

This order gives us a working release spine before adding heavier deployment
features.

## Verification

Release:

- release-please opens or updates a release PR on `main`
- release PR updates `CHANGELOG.md` and manifest
- merging the release PR creates `vX.Y.Z`
- release tag triggers Docker and Helm publishing

CI:

- PRs run all required gates
- audits fail on the current docs-site vulnerability until fixed
- docs build runs in CI
- Docker smoke proves the image starts
- Trivy produces results and fails on configured severities

Docker:

- `edge` and `sha-<short>` publish from `main`
- `latest`, `X.Y.Z`, and `X.Y` publish from release tags
- image supports `linux/amd64` and `linux/arm64`
- release images include SBOM/provenance

Helm:

- `helm lint` passes
- template smoke tests cover filesystem, S3, and TLS values
- release chart installs with probes pointed at `/health`
- OCI chart exists in GHCR for the release version

Server:

- `/health` returns `200 OK`
- TLS starts only when both cert and key are valid
- partial TLS config exits loudly
- S3 integration writes and reads through a real S3-compatible endpoint
- real Nx e2e observes a remote cache hit on the second run

Docs:

- Docker run and compose examples match the final env vars
- Helm docs match chart values
- release docs match actual workflows
- configuration docs include TLS and health
- OpenAPI includes `/health`

## Research Sources

Checked during brainstorming:

- Release Please Action:
  https://github.com/googleapis/release-please-action
- Release Please Action `v5.0.0`:
  https://github.com/googleapis/release-please-action/releases/tag/v5.0.0
- Release Please manifest docs:
  https://github.com/googleapis/release-please/blob/main/docs/manifest-releaser.md
- Docker Build Push Action `v7.2.0`:
  https://github.com/docker/build-push-action/releases/tag/v7.2.0
- Docker Metadata Action `v6.1.0`:
  https://github.com/docker/metadata-action/releases/tag/v6.1.0
- Helm OCI registry docs:
  https://helm.sh/docs/topics/registries/
- Trivy Action `v0.36.0`:
  https://github.com/aquasecurity/trivy-action/releases/tag/v0.36.0
- `IKatsuba/nx-cache-server`:
  https://github.com/IKatsuba/nx-cache-server

Context7 was used for release-please, semantic-release, Changesets, Docker
Build Push Action, Docker Metadata Action, Trivy, and Helm docs. `ctx7` was not
installed directly in this shell, so the documented `npx ctx7@latest` path was
used without adding a project dependency.

## Spec Self-Review

- No placeholders remain.
- The scope is intentionally broad, but phased. Each phase can become a
  separate implementation plan or PR.
- The release tag strategy is explicit: `latest` is stable, `edge` is `main`.
- The IKatsuba features are adopted at the behavior level and adapted to Bun.
- The known audit issue is named and assigned to the security phase.
- Slow tests are split from the default local loop until proven fast enough.

# Design: Release Distribution (Helm OCI chart + standalone binaries)

Date: 2026-06-29

## Goal

Complete the release-tag distribution story. On every release tag the workflow
should:

- publish the Helm chart as an OCI artifact to GHCR, and
- attach standalone cross-platform binaries to the GitHub Release,

with both gated behind the existing quality preflight, both covered by a
`checksums.txt`, and both provenance-attested.

This implements roadmap steps 6 (Helm OCI publishing) and 11 (binary
distribution channel) from
`docs/superpowers/specs/2026-06-29-release-ci-distribution-hardening-design.md`.
It assumes Plan 5 is merged: the `charts/remotecache/` chart, direct TLS,
`BIND_ADDRESS`, graceful shutdown, IRSA via `@aws-sdk/credential-providers`,
and hash hardening all already exist.

## Project Context

Confirmed by reading the repo at the time of writing:

- `.github/workflows/publish-image.yml` triggers on push to `main` and on tags
  `v*.*.*`. It has a `preflight` job (format, lint, root audit, test, docs
  audit, docs build, Docker smoke against `/health`, Trivy image scan) and a
  `publish` job (`needs: preflight`) that builds and pushes multi-arch Docker
  images with SLSA provenance and SBOM. Top-level permissions:
  `contents: read`, `packages: write`, `security-events: write`.
- `.github/workflows/release.yml` runs `googleapis/release-please-action@v5`
  on push to `main`. Config: `release-type: simple`, `include-v-in-tag: true`,
  `changelog-path: CHANGELOG.md`, `version-file: version.txt`. Current released
  version is `2.0.0`. release-please uses `RELEASE_PLEASE_TOKEN` (a PAT), so the
  tags and releases it creates DO trigger downstream tag-triggered workflows.
  This is the mechanism the existing Docker publish already relies on.
- `charts/remotecache/Chart.yaml` carries placeholder `version: 0.1.0` and
  `appVersion: '0.0.0'`, with a comment noting the real values are wired at
  release time.
- `charts/remotecache/` is `helm lint`ed and `helm template`d in `ci.yml` via a
  SHA-pinned `azure/setup-helm` (added in Plan 5).
- The one runtime dependency is `@aws-sdk/credential-providers@3.1075.0`;
  `bun:sqlite` is embedded in the Bun runtime. No native add-ons.

## Grounded Tooling Decisions

### Bun standalone executables

`bun build --compile` cross-compiles from a single Linux host to every target.
Verified target triples (Bun docs, `Bun.Build.Target`):

- `bun-linux-x64`, `bun-linux-arm64`
- `bun-darwin-x64`, `bun-darwin-arm64`
- `bun-windows-x64` (Bun appends `.exe` automatically)

`--compile` bundles all imports, including the `@aws-sdk/credential-providers`
dependency from `node_modules`; `bun:sqlite` is part of the runtime. Because the
SDK is bundled rather than installed at runtime, a CI smoke test that boots a
compiled binary is required to prove the bundle is complete.

### Platform matrix (decision)

Ship the **Core 5**: `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`,
`windows-x64`. This covers the realistic self-hosted install base. `musl`
(Alpine) is served by Docker, the recommended production path; `windows-arm64`
is niche for a server. Fewer artifacts to checksum, attest, and document.

Friendly artifact names (the workflow maps Bun triples to these):

| Bun target         | Artifact name                           |
| ------------------ | --------------------------------------- |
| `bun-linux-x64`    | `remotecache-<version>-linux-x64`       |
| `bun-linux-arm64`  | `remotecache-<version>-linux-arm64`     |
| `bun-darwin-x64`   | `remotecache-<version>-darwin-x64`      |
| `bun-darwin-arm64` | `remotecache-<version>-darwin-arm64`    |
| `bun-windows-x64`  | `remotecache-<version>-windows-x64.exe` |

`<version>` is the tag without the leading `v` (e.g. `v2.1.0` -> `2.1.0`).

### Helm OCI publishing

Verified Helm commands:

- `echo "$GITHUB_TOKEN" | helm registry login ghcr.io -u "$GITHUB_ACTOR" --password-stdin`
- `helm package charts/remotecache --version "$VERSION" --app-version "$VERSION"`
- `helm push remotecache-$VERSION.tgz oci://ghcr.io/<owner>/charts`

The chart lands at `ghcr.io/<owner>/charts/remotecache:$VERSION`. `helm push`
prints a `Digest: sha256:...` line that is captured for attestation. The in-repo
`Chart.yaml` `version`/`appVersion` stay as fixed placeholders for `helm
lint`/`template`; the published values come from the tag via the `--version` and
`--app-version` flags. No release-please `extra-files` wiring is needed.

### Provenance attestation

`actions/attest-build-provenance@v4` (latest `v4.1.1`, 2026-06-26; pin by SHA at
implementation). Keyless via OIDC, so no secrets to manage. It accepts:

- `subject-path` for loose files (the binaries and `checksums.txt`), and
- `subject-name` + `subject-digest` + `push-to-registry: true` for an OCI
  artifact (the chart).

Verification by consumers: `gh attestation verify <file> --repo <owner>/<repo>`.
This matches the SLSA provenance already produced for the Docker image and the
repo's OpenSSF Scorecard posture. Requires `id-token: write` and
`attestations: write` on the jobs that attest.

## Architecture

Extend `.github/workflows/publish-image.yml` with two new jobs. No new
workflow file; release-tag artifact publishing stays in one place and reuses the
proven preflight gate. Phase 13 (CI DRY) later extracts the shared preflight
into a composite action.

Both new jobs:

- `needs: preflight`
- `if: startsWith(github.ref, 'refs/tags/v')`

So on a tag push the graph is `preflight -> {publish (Docker), publish-helm,
publish-binaries}` in parallel; on a `main` push the two new jobs are skipped by
the `if`. Permissions are set per-job (least privilege); the existing top-level
grant continues to cover `preflight` and `publish`.

### Component: `publish-helm` job

Permissions: `contents: read`, `packages: write`, `id-token: write`,
`attestations: write`.

1. Checkout (SHA-pinned `actions/checkout`).
2. `azure/setup-helm` (reuse the SHA pin from the `ci.yml` helm job).
3. `VERSION=${GITHUB_REF_NAME#v}`.
4. `helm package charts/remotecache --version "$VERSION" --app-version "$VERSION"`.
5. `helm registry login ghcr.io` with `GITHUB_TOKEN` via `--password-stdin`.
6. `helm push remotecache-$VERSION.tgz oci://ghcr.io/${{ github.repository_owner }}/charts`,
   capturing the digest from stdout.
7. `actions/attest-build-provenance` with
   `subject-name: ghcr.io/<owner>/charts/remotecache`, the captured
   `subject-digest`, and `push-to-registry: true`.

OCI charts are version-addressed only — there is no floating chart tag to
clobber — so prereleases need no special handling here. `3.0.0-rc.1` is valid
semver and publishes as that version.

### Component: `publish-binaries` job

Permissions: `contents: write`, `id-token: write`, `attestations: write`.

Single `ubuntu-latest` job (Bun cross-compiles every target from Linux, so no
macOS/Windows runners are needed; one job keeps checksum generation and a single
attestation trivial):

1. Checkout (SHA-pinned).
2. `oven-sh/setup-bun` (SHA-pinned, matching the version used elsewhere).
3. `bun install --frozen-lockfile` (needed so `@aws-sdk/credential-providers`
   is present to bundle).
4. `scripts/build-binaries.sh "$VERSION"` builds the Core 5 with
   `bun build --compile --minify --target=<triple> src/main.ts --outfile
dist/<friendly-name>` and writes `dist/checksums.txt`
   (`sha256sum remotecache-* > checksums.txt`). The logic lives in a script, not
   inline YAML, so it is runnable and testable locally and the workflow stays
   thin.
5. Smoke test: run the native `dist/remotecache-$VERSION-linux-x64` with a test
   `ADMIN_TOKEN`, poll `GET /health`, assert `200`. This proves `--compile`
   produced a working server with the AWS SDK bundled and `bun:sqlite` embedded.
6. Ensure the GitHub Release exists, then upload assets:
   - `gh release view "$TAG"` || `gh release create "$TAG" --title "$TAG"
--generate-notes ${PRERELEASE:+--prerelease}`
   - `gh release upload "$TAG" dist/* --clobber`
     For the normal stable flow the release already exists (release-please created
     it), so only assets are added and its notes are never overwritten. The create
     branch only fires for a manually-cut prerelease tag that release-please did
     not produce.
7. `actions/attest-build-provenance` with `subject-path: 'dist/remotecache-*'`
   (and `checksums.txt`).

### Component: `scripts/build-binaries.sh`

Single argument: `<version>`. Loops the five Bun targets, maps each to its
friendly artifact name (appending `.exe` for Windows), runs `bun build
--compile --minify`, then generates `checksums.txt`. Used by both the workflow
and local developers. Pure Bash + Bun, no extra dependencies.

### Cross-cutting: prerelease guard

`PRERELEASE` is true when `VERSION` contains a `-` (semver prerelease
identifier). Effects:

- **Docker `publish` job:** gate the `latest` and `X.Y` tags to stable releases
  so a prerelease such as `v3.0.0-rc.1` publishes only the exact
  `3.0.0-rc.1` image and never clobbers `latest`. This corrects an existing
  latent bug where `latest` is pushed for any `v*` tag. (`docker/metadata-action`
  already omits `{{major}}.{{minor}}` for prereleases; the `type=raw` `latest`
  enable expression is tightened to exclude prereleases.)
- **GitHub Release:** marked prerelease when applicable. release-please handles
  this for stable releases; the `publish-binaries` create-if-missing branch sets
  `--prerelease` for a manual prerelease tag.

## Documentation

Docs travel with the code (project rule). Updates:

- **Deployment guide (`docs-site`):** "Install via Helm from OCI"
  (`helm install remotecache oci://ghcr.io/<owner>/charts/remotecache --version
<X.Y.Z>`) and "Standalone binaries" (download from Releases, verify with
  `sha256sum -c checksums.txt` and `gh attestation verify`, run with
  `ADMIN_TOKEN`). Note Docker remains the recommended production path.
- **README:** add binaries and Helm OCI under install options with links.
- **Maintainer release docs:** record that release tags now also publish the
  chart and binaries, the prerelease behavior, and how to verify a release
  published correctly.
- **No OpenAPI or configuration changes:** no new HTTP surface, no new env vars
  (binaries use the same environment as the server).

Run human-facing docs through the humanizer guidance before shipping.

## Testing Strategy

- **In-CI smoke (required):** the binary job boots the compiled linux-x64 server
  and asserts `GET /health` returns `200`. This is the single most important
  check — it catches a broken `--compile` bundle (notably the AWS SDK) before a
  release ships.
- **Local dry-run:** `scripts/build-binaries.sh` and `helm package` run on a dev
  machine to validate artifact names, checksums, and packaging.
- **Static workflow validation:** lint the workflow YAML (e.g. `actionlint` if
  available) since the live publish path cannot be exercised until the branch
  merges and a real tag is cut.
- `helm lint`/`helm template` already run in `ci.yml` (Plan 5); no change there.

Tests prove intent: a release tag yields an installable OCI chart and runnable,
verifiable binaries, and a prerelease never promotes to a stable pointer.

## Verification

- `publish-helm` pushes `ghcr.io/<owner>/charts/remotecache:<version>` and an
  attestation; `helm install oci://...` works against it.
- `publish-binaries` attaches the Core 5 binaries plus `checksums.txt` to the
  release; `gh attestation verify` passes for each.
- A stable tag updates Docker `latest` and `X.Y`; a prerelease tag does not.
- The compiled linux-x64 binary serves `/health` in CI.

## Out of Scope (deferred)

- release-please managing `Chart.yaml`/`version.txt` for the chart version
  (publish-time `--version`/`--app-version` is sufficient).
- A full prerelease _channel_ / rc cadence — only the guard is in scope, not a
  release-please prerelease flow.
- CI DRY of the shared preflight steps — roadmap Phase 13.
- `musl` and `windows-arm64` binaries — revisit only on demand.

## Spec Self-Review

- No placeholders remain. Tooling versions, target triples, and exact commands
  are named.
- Internally consistent: the prerelease guard, the create-if-missing release
  logic, and the "release already exists for stable tags" assumption line up.
- Scope is one focused implementation plan: extend one workflow, add one script,
  update docs.
- Ambiguity resolved: single binary job (not a matrix); binaries attach to the
  release release-please created; the chart has no floating tag.

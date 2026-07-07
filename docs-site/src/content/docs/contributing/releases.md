---
title: Releases
description: 'How maintainers release remotecache with Release Please, SemVer tags, GitHub Releases, and published images.'
---

Releases are managed by Release Please. It reads Conventional Commits on `main`, opens a release PR, and updates:

- `CHANGELOG.md`
- `version.txt`
- `.release-please-manifest.json`
- `charts/remotecache/Chart.yaml` (chart version)

Merging the release PR creates the GitHub Release and a SemVer tag such as `v2.1.0`.

## Maintainer setup

The release workflow authenticates as a GitHub App (`remotecache-release`) via
`actions/create-github-app-token`, using the `RELEASE_PLEASE_APP_ID` and
`RELEASE_PLEASE_APP_PRIVATE_KEY` repository secrets. The app needs Contents,
Pull requests, and Issues read/write on this repository only.

Do not use the default `GITHUB_TOKEN` for Release Please. GitHub suppresses follow-on workflow runs
for events created by `GITHUB_TOKEN`, which means release PRs and tags may not trigger the normal
CI and publishing workflows.

The repository must also allow GitHub Actions to create pull requests.

## Release flow

1. Merge normal feature and fix PRs into `main` using Conventional Commits.
2. Release Please opens or updates a release PR.
3. Review the release PR. Check the changelog and version bump.
4. Merge the release PR when you want to cut a release.
5. Confirm the GitHub Release and `vX.Y.Z` tag were created.
6. Confirm the publishing workflow created the expected Docker image tags, pushed the Helm chart to GHCR, and attached the binaries and `checksums.txt` to the Release.

## Tag policy

`latest` is reserved for the latest stable release. `edge` is reserved for the latest successful `main` build, alongside a `sha-<short>` tag pinned to the exact commit. Stable release tags publish `X.Y.Z` and `X.Y` image tags.

## Publishing

PR CI runs `helm lint`, `helm template` (filesystem, S3, GCS, TLS, and extras value sets), kubeconform schema validation, and a full `helm install` + `helm test` against a kind cluster for the chart in `charts/remotecache/`. On release tags the workflow also publishes the chart as an OCI artifact to `oci://ghcr.io/thilak-rao/charts/remotecache` and attaches standalone binaries plus a `checksums.txt` to the Release. Each release also carries a source SBOM (sbom.spdx.json, SPDX format), listed in checksums.txt. The chart, image, and binaries each carry a provenance attestation; consumers verify with `gh attestation verify`. Before upload, every binary is smoke-tested against `/health` on a native runner for its platform (linux x64/arm64, macOS x64/arm64, Windows x64).

The Docker publishing workflow runs its own preflight gate before pushing images. It repeats the root checks, docs checks, Docker smoke test against `/health`, and Trivy image scan so image publishing cannot race ahead of CI.

Main builds publish `edge` and `sha-<short>`. Every version tag (`v*.*.*`, including prereleases) publishes the Helm chart, the Core 5 binaries (linux/macOS/Windows), and the exact `X.Y.Z` image; stable release tags additionally move `latest`, `X.Y.Z`, and `X.Y`, while a prerelease tag (e.g. `v3.0.0-rc.1`) never updates `latest`. Release images are pushed for `linux/amd64` and `linux/arm64` with SBOM and provenance.

## If a release does not appear

Check these in order:

1. The merged commits use Conventional Commit types such as `fix:` or `feat:`.
2. `.github/workflows/release.yml` ran on the latest push to `main`.
3. `RELEASE_PLEASE_APP_ID` and `RELEASE_PLEASE_APP_PRIVATE_KEY` exist and the app has write access.
4. GitHub Actions is allowed to create pull requests.
5. The release PR was merged, not just opened.

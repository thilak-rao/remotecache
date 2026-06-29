---
title: Releases
description: 'How maintainers release remotecache with Release Please, SemVer tags, GitHub Releases, and published images.'
---

Releases are managed by Release Please. It reads Conventional Commits on `main`, opens a release PR, and updates:

- `CHANGELOG.md`
- `version.txt`
- `.release-please-manifest.json`

Merging the release PR creates the GitHub Release and a SemVer tag such as `v2.1.0`.

## Maintainer setup

The release workflow uses a repository secret named `RELEASE_PLEASE_TOKEN`.

Use a least-privilege fine-grained PAT or GitHub App token that can:

- read and write repository contents
- create pull requests
- create issues or comments

Do not use the default `GITHUB_TOKEN` for Release Please. GitHub suppresses follow-on workflow runs for events created by `GITHUB_TOKEN`, which means release PRs and tags may not trigger the normal CI and publishing workflows.

The repository must also allow GitHub Actions to create pull requests.

## Release flow

1. Merge normal feature and fix PRs into `main` using Conventional Commits.
2. Release Please opens or updates a release PR.
3. Review the release PR. Check the changelog and version bump.
4. Merge the release PR when you want to cut a release.
5. Confirm the GitHub Release and `vX.Y.Z` tag were created.
6. Confirm the publishing workflow created the expected Docker image tags, pushed the Helm chart to GHCR, and attached the binaries and `checksums.txt` to the Release.

## Tag policy

`latest` is reserved for the latest stable release. `edge` is reserved for the latest successful `main` build. Release tags publish `X.Y.Z` and `X.Y` image tags.

## Publishing

PR CI runs `helm lint` and `helm template` against the chart in `charts/remotecache/` (filesystem, S3, and TLS value sets). On release tags the workflow also publishes the chart as an OCI artifact to `oci://ghcr.io/thilak-rao/charts/remotecache` and attaches standalone binaries plus a `checksums.txt` to the Release. The chart, image, and binaries each carry a provenance attestation; consumers verify with `gh attestation verify`.

The Docker publishing workflow runs its own preflight gate before pushing images. It repeats the root checks, docs checks, Docker smoke test against `/health`, and Trivy image scan so image publishing cannot race ahead of CI.

Main builds publish `edge` and `sha-<short>`. Stable release tags publish `latest`, `X.Y.Z`, and `X.Y`; a prerelease tag (e.g. `v3.0.0-rc.1`) publishes only the exact `X.Y.Z-…` image and never updates `latest`. Release images are pushed for `linux/amd64` and `linux/arm64` with SBOM and provenance. Release tags also publish the Helm chart and the Core 5 binaries (linux/macOS/Windows).

## If a release does not appear

Check these in order:

1. The merged commits use Conventional Commit types such as `fix:` or `feat:`.
2. `.github/workflows/release.yml` ran on the latest push to `main`.
3. `RELEASE_PLEASE_TOKEN` exists and has write access.
4. GitHub Actions is allowed to create pull requests.
5. The release PR was merged, not just opened.

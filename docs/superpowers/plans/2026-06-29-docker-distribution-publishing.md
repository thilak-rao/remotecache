# Docker distribution publishing implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish Docker images from CI with the approved tag policy, multi-platform manifests, pre-publish checks, image scanning, SBOM, and provenance.

**Architecture:** Keep `.github/workflows/publish-image.yml` as the distribution workflow, but make it self-gating: run the same quality checks before pushing, scan the local image before publish, then push only after the gate passes. Update docs so users see `edge` for `main` builds and `latest` only for stable releases.

**Tech Stack:** GitHub Actions, GHCR, Docker Buildx, Docker Metadata Action v6.1.0, Docker Build Push Action v7.2.0, Docker Setup QEMU Action v4.1.0, Trivy Action v0.36.0, Bun.

---

## Scope

Implement only Docker distribution publishing.

In scope:

- Stop publishing `latest` from `main`.
- Publish `edge` and `sha-<short>` from successful `main` builds.
- Publish `latest`, `X.Y.Z`, and `X.Y` from release tags such as `v2.1.0`.
- Build and push `linux/amd64` and `linux/arm64` images.
- Add BuildKit SBOM and provenance attestations to pushed images.
- Add a pre-publish gate inside the publishing workflow so publishing cannot race ahead of CI.
- Add Trivy image scanning before push.
- Update Docker and release docs to match the implemented tag policy.

Out of scope:

- Helm chart creation or Helm OCI publishing.
- `/health` endpoint or Docker healthcheck changes.
- TLS support.
- S3 integration tests.
- Nx e2e tests.
- Changing the Dockerfile base image.
- Signing images with Cosign. SBOM/provenance is enough for this phase.

## Current baseline

Plan 2 made the PR gate stronger, but `.github/workflows/publish-image.yml` still publishes:

- `latest` from `main`
- `sha-<short>` from `main`
- `X.Y.Z` and `X.Y` from release tags

That conflicts with the approved tag policy and the release docs. This plan changes `latest` to a stable-release tag only and adds `edge` for `main`.

## Source checks

- Context7 `/docker/build-push-action`: multi-platform builds use `platforms: linux/amd64,linux/arm64`, `docker/setup-qemu-action` should run before a multi-platform build, and build-push supports `provenance`, `sbom`, `cache-from`, and `cache-to`.
- Context7 `/docker/metadata-action`: `type=edge`, `type=sha`, and `type=semver` are the supported tag generators for this workflow.
- `aquasecurity/trivy-action@v0.36.0` `action.yaml`: image scans use `scan-type: image` with `image-ref`; SARIF output uses `format: sarif` and `output`.
- Git tag checks:
  - `docker/setup-qemu-action@v4.1.0` -> `06116385d9baf250c9f4dcb4858b16962ea869c3`
  - `docker/setup-buildx-action@v4.1.0` -> `d7f5e7f509e45cec5c76c4d5afdd7de93d0b3df5`
  - `docker/build-push-action@v7.2.0` -> `f9f3042f7e2789586610d6e8b85c8f03e5195baf`
  - `docker/metadata-action@v6.1.0` -> `80c7e94dd9b9319bd5eb7a0e0fe9291e23a2a2e9`
  - `docker/login-action@v4.2.0` -> `650006c6eb7dba73a995cc03b0b2d7f5ca915bee`
- Production usage cross-check: public composite workflows using Docker Build Push Action v7 commonly run QEMU before Buildx for multi-architecture builds and pass `platforms` through to `docker/build-push-action`. One example is `aboutbits/github-actions-docker/build-push/action.yml`; another is `senzing-factory/github-action-docker-buildx-build/action.yaml`.

## File map

- Modify `.github/workflows/publish-image.yml`: pre-publish gate, image scan, tag policy, multi-platform push, SBOM/provenance.
- Modify `docs-site/src/content/docs/guides/deployment.md`: update image tag table and release image details.
- Modify `docs-site/src/content/docs/contributing/releases.md`: align maintainer release checklist with Docker-only publishing for this phase.
- Modify `README.md`: clarify that `latest` is stable and `edge` is for unreleased main builds.

Do not modify `.github/workflows/ci.yml` in this plan unless a workflow syntax issue in `publish-image.yml` forces a matching doc or check update.

## Task 1: Replace the Docker publishing workflow

**Files:**

- Modify: `.github/workflows/publish-image.yml`

- [ ] **Step 1: Replace `.github/workflows/publish-image.yml`**

Replace `.github/workflows/publish-image.yml` with this exact content:

```yaml
name: Publish Image

on:
  push:
    branches: ['main']
    tags: ['v*.*.*']

permissions:
  contents: read
  packages: write
  security-events: write

concurrency:
  group: publish-image-${{ github.ref }}
  cancel-in-progress: false

env:
  IMAGE_NAME: ghcr.io/${{ github.repository_owner }}/remotecache
  CACHE_IMAGE: ghcr.io/${{ github.repository_owner }}/remotecache:buildcache

jobs:
  preflight:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0

      - name: Set up Bun
        uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Format check
        run: bun run format --check

      - name: Lint
        run: bun run lint

      - name: Root audit
        run: bun audit

      - name: Test
        run: bun test

      - name: Install docs dependencies
        run: bun install --frozen-lockfile
        working-directory: docs-site

      - name: Docs audit
        run: bun audit
        working-directory: docs-site

      - name: Docs build
        run: bun run build
        working-directory: docs-site

      - name: Build local Docker image
        run: docker build -t remotecache:publish-check .

      - name: Start Docker container
        run: docker run -d --name remotecache-publish-check -e ADMIN_TOKEN=test-token -p 3000:3000 remotecache:publish-check

      - name: Wait for server
        run: |
          for attempt in {1..30}; do
            if curl -fsS http://127.0.0.1:3000/metrics > /tmp/remotecache-metrics.txt; then
              cat /tmp/remotecache-metrics.txt
              exit 0
            fi
            sleep 1
          done

          docker logs remotecache-publish-check
          exit 1

      - name: Stop Docker container
        if: always()
        run: docker rm -f remotecache-publish-check || true

      - name: Scan local Docker image
        uses: aquasecurity/trivy-action@a9c7b0f06e461e9d4b4d1711f154ee024b8d7ab8 # v0.36.0
        with:
          scan-type: image
          image-ref: remotecache:publish-check
          format: sarif
          output: trivy-image.sarif
          severity: HIGH,CRITICAL
          ignore-unfixed: true
          exit-code: '1'
          limit-severities-for-sarif: true

      - name: Upload Trivy image SARIF
        if: ${{ always() && hashFiles('trivy-image.sarif') != '' }}
        uses: github/codeql-action/upload-sarif@c35d1b164463ee62a100735382aaaa525c5d3496 # codeql-bundle-v2.25.6
        with:
          sarif_file: trivy-image.sarif

  publish:
    runs-on: ubuntu-latest
    needs: preflight
    steps:
      - name: Checkout
        uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0

      - name: Set up QEMU
        uses: docker/setup-qemu-action@06116385d9baf250c9f4dcb4858b16962ea869c3 # v4.1.0

      - name: Set up Buildx
        uses: docker/setup-buildx-action@d7f5e7f509e45cec5c76c4d5afdd7de93d0b3df5 # v4.1.0

      - name: Log in to GHCR
        uses: docker/login-action@650006c6eb7dba73a995cc03b0b2d7f5ca915bee # v4.2.0
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Docker metadata
        id: meta
        uses: docker/metadata-action@80c7e94dd9b9319bd5eb7a0e0fe9291e23a2a2e9 # v6.1.0
        with:
          images: ${{ env.IMAGE_NAME }}
          tags: |
            type=edge,branch=main
            type=sha,prefix=sha-,format=short,enable={{is_default_branch}}
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=raw,value=latest,enable=${{ startsWith(github.ref, 'refs/tags/v') }}

      - name: Build and push
        uses: docker/build-push-action@f9f3042f7e2789586610d6e8b85c8f03e5195baf # v7.2.0
        with:
          context: .
          file: ./Dockerfile
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=registry,ref=${{ env.CACHE_IMAGE }}
          cache-to: type=registry,ref=${{ env.CACHE_IMAGE }},mode=max
          provenance: mode=max
          sbom: true
```

- [ ] **Step 2: Verify the workflow has the approved tag rules**

Run:

```bash
rg -n 'type=edge|type=sha|type=semver|type=raw,value=latest|latest,enable=\\{\\{is_default_branch\\}\\}' .github/workflows/publish-image.yml
```

Expected:

- output includes `type=edge,branch=main`
- output includes `type=sha,prefix=sha-,format=short,enable={{is_default_branch}}`
- output includes both semver patterns
- output includes `type=raw,value=latest,enable=${{ startsWith(github.ref, 'refs/tags/v') }}`
- output does not include `latest,enable={{is_default_branch}}`

- [ ] **Step 3: Verify action pins are commit SHAs**

Run:

```bash
rg -n 'uses: .*@[A-Za-z0-9_.-]+' .github/workflows/publish-image.yml
```

Expected: every `uses:` line has a 40-character SHA and a trailing version comment.

- [ ] **Step 4: Commit**

Run:

```bash
git add .github/workflows/publish-image.yml
git commit -m "ci(docker): publish edge stable and multiarch images"
```

## Task 2: Update Docker distribution docs

**Files:**

- Modify: `docs-site/src/content/docs/guides/deployment.md`
- Modify: `README.md`

- [ ] **Step 1: Update the deployment tag table**

In `docs-site/src/content/docs/guides/deployment.md`, replace the current tag table under `## Container image` with this exact table and follow-up paragraphs:

```markdown
| Tag            | Published when              | Use                                    |
| -------------- | --------------------------- | -------------------------------------- |
| `:edge`        | Successful push to `main`   | Testing unreleased changes from `main` |
| `:sha-<short>` | Successful push to `main`   | Pinning an exact unreleased build      |
| `:latest`      | Version tag (e.g. `v1.2.3`) | Latest stable release                  |
| `:X.Y.Z`       | Version tag                 | Pinning an exact stable release        |
| `:X.Y`         | Version tag                 | Tracking patch releases within a minor |

The old main-branch `latest` behavior is intentionally retired. For production, pin `:X.Y.Z` or `:X.Y`; use `:latest` only when you deliberately want the newest stable release.

Images are published for `linux/amd64` and `linux/arm64`. Release builds include BuildKit SBOM and provenance attestations.
```

- [ ] **Step 2: Update the README Docker note**

In `README.md`, replace this sentence:

```markdown
See the [Deployment guide](https://remotecache.dev/guides/deployment/) for S3 storage and production setup.
```

with:

```markdown
`latest` points at the newest stable release. Use `edge` only for unreleased builds from `main`.

See the [Deployment guide](https://remotecache.dev/guides/deployment/) for S3 storage and production setup.
```

- [ ] **Step 3: Human-facing text pass**

Read the changed docs. Remove filler, hype, generic conclusions, and chatbot phrasing. Keep the release/tag language direct.

- [ ] **Step 4: Commit**

Run:

```bash
git add docs-site/src/content/docs/guides/deployment.md README.md
git commit -m "docs(docker): document stable and edge image tags"
```

## Task 3: Align maintainer release docs with Docker-only distribution

**Files:**

- Modify: `docs-site/src/content/docs/contributing/releases.md`

- [ ] **Step 1: Replace the release checklist artifact sentence**

In `docs-site/src/content/docs/contributing/releases.md`, replace this line:

```markdown
6. Confirm distribution workflows published the expected Docker image and Helm chart artifacts.
```

with:

```markdown
6. Confirm the Docker publishing workflow created the expected image tags. Helm chart publishing is planned for a later phase.
```

- [ ] **Step 2: Add a Docker publishing section**

After the `## Tag policy` paragraph, add this section:

```markdown
## Docker publishing

The Docker publishing workflow runs its own preflight gate before pushing images. It repeats the root checks, docs checks, Docker smoke test, and Trivy image scan so image publishing cannot race ahead of CI.

Main builds publish `edge` and `sha-<short>`. Release tags publish `latest`, `X.Y.Z`, and `X.Y`. Release images are pushed for `linux/amd64` and `linux/arm64` with SBOM and provenance attestations.
```

- [ ] **Step 3: Human-facing text pass**

Read the updated release guide. Keep the wording factual and remove any future-tense claims that imply Helm is implemented in this phase.

- [ ] **Step 4: Commit**

Run:

```bash
git add docs-site/src/content/docs/contributing/releases.md
git commit -m "docs(release): describe docker publishing flow"
```

## Task 4: Verify Docker publishing changes

**Files:**

- Validate: `.github/workflows/publish-image.yml`
- Validate: `docs-site/src/content/docs/guides/deployment.md`
- Validate: `docs-site/src/content/docs/contributing/releases.md`
- Validate: `README.md`

- [ ] **Step 1: Run root checks**

Run:

```bash
bun install --frozen-lockfile
bun run format --check
bun run lint
bun audit
bun test
```

Expected:

- install exits `0` with no lockfile changes
- format check exits `0`
- lint exits `0`
- audit prints `No vulnerabilities found`
- tests exit `0`

- [ ] **Step 2: Run docs checks**

Run:

```bash
cd docs-site
bun install --frozen-lockfile
bun audit
bun run build
```

Expected:

- install exits `0` with no lockfile changes
- audit prints `No vulnerabilities found`
- build exits `0`
- internal link validation passes

- [ ] **Step 3: Run local Docker smoke**

Run:

```bash
docker rm -f remotecache-publish-check >/dev/null 2>&1 || true
docker build -t remotecache:publish-check .
docker run -d --name remotecache-publish-check -e ADMIN_TOKEN=test-token -p 3000:3000 remotecache:publish-check
for attempt in {1..30}; do
  if curl -fsS http://127.0.0.1:3000/metrics > /tmp/remotecache-metrics.txt; then
    cat /tmp/remotecache-metrics.txt
    docker rm -f remotecache-publish-check
    exit 0
  fi
  sleep 1
done
docker logs remotecache-publish-check
docker rm -f remotecache-publish-check
exit 1
```

Expected: metrics output is printed and the script exits `0`.

- [ ] **Step 4: Verify workflow static contract**

Run:

```bash
rg -n 'type=edge,branch=main' .github/workflows/publish-image.yml
rg -n 'type=sha,prefix=sha-,format=short,enable=\\{\\{is_default_branch\\}\\}' .github/workflows/publish-image.yml
rg -n 'type=semver,pattern=\\{\\{version\\}\\}' .github/workflows/publish-image.yml
rg -n 'type=semver,pattern=\\{\\{major\\}\\}\\.\\{\\{minor\\}\\}' .github/workflows/publish-image.yml
rg -n 'type=raw,value=latest' .github/workflows/publish-image.yml
rg -n 'platforms: linux/amd64,linux/arm64' .github/workflows/publish-image.yml
rg -n 'provenance: mode=max' .github/workflows/publish-image.yml
rg -n 'sbom: true' .github/workflows/publish-image.yml
rg -n 'scan-type: image' .github/workflows/publish-image.yml
rg -n 'image-ref: remotecache:publish-check' .github/workflows/publish-image.yml
```

Expected: every pattern is present.

Run:

```bash
if rg -n 'latest,enable=\\{\\{is_default_branch\\}\\}' .github/workflows/publish-image.yml; then
  exit 1
fi
```

Expected: command exits `0` with no output.

- [ ] **Step 5: Verify planned file scope**

Run:

```bash
git diff --name-only HEAD~3..HEAD
```

Expected paths should be limited to:

```text
.github/workflows/publish-image.yml
README.md
docs-site/src/content/docs/guides/deployment.md
docs-site/src/content/docs/contributing/releases.md
```

If another path appears, inspect it and keep it only if it directly supports this plan.

- [ ] **Step 6: Final commit if verification changed files**

If verification or formatting changed tracked files, commit them:

```bash
git add .github/workflows/publish-image.yml README.md docs-site/src/content/docs/guides/deployment.md docs-site/src/content/docs/contributing/releases.md
git commit -m "chore(docker): verify publishing workflow"
```

# Release Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Release Please based changelog, version, tag, and GitHub Release automation for `remotecache`.

**Architecture:** Release Please runs from a dedicated GitHub Actions workflow on pushes to `main`. It uses source-controlled manifest config, updates `CHANGELOG.md` and `version.txt`, and creates a release PR that becomes the human approval gate before tags and GitHub Releases exist.

**Tech Stack:** Bun, GitHub Actions, Release Please Action v5, Conventional Commits.

---

## Scope

Implement only release management. Do not change Docker publishing, Helm publishing, health checks, TLS, audits, or tests beyond the validation commands named here.

This plan assumes the repository already has tags `v1.0.0` and `v2.0.0`. Bootstrap Release Please from `2.0.0` so the next automated release is calculated from later Conventional Commits.

## File map

- Create `.github/workflows/release.yml`: Release Please workflow.
- Create `release-please-config.json`: Release Please manifest config for the root package.
- Create `.release-please-manifest.json`: current version tracking for the root package.
- Create `version.txt`: version file updated by the Release Please `simple` strategy.
- Create `CHANGELOG.md`: changelog file updated by release PRs.
- Create `docs-site/src/content/docs/contributing/releases.md`: maintainer release guide.
- Modify `docs-site/astro.config.mjs`: add the release guide to the Starlight sidebar.
- Modify `CONTRIBUTING.md`: add a short release workflow note for contributors.

## Task 1: Add Release Please config files

**Files:**

- Create: `release-please-config.json`
- Create: `.release-please-manifest.json`
- Create: `version.txt`
- Create: `CHANGELOG.md`

- [ ] **Step 1: Create `release-please-config.json`**

Create `release-please-config.json` with this exact content:

```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "packages": {
    ".": {
      "release-type": "simple",
      "changelog-path": "CHANGELOG.md",
      "version-file": "version.txt",
      "include-component-in-tag": false,
      "include-v-in-tag": true
    }
  }
}
```

- [ ] **Step 2: Create `.release-please-manifest.json`**

Create `.release-please-manifest.json` with this exact content:

```json
{
  ".": "2.0.0"
}
```

- [ ] **Step 3: Create `version.txt`**

Create `version.txt` with this exact content:

```text
2.0.0
```

Release Please's `simple` strategy updates `version.txt`, but does not create it. This file must exist before the first automated release PR.

- [ ] **Step 4: Create `CHANGELOG.md`**

Create `CHANGELOG.md` with this exact content:

```markdown
# Changelog

## 2.0.0

- Baseline version for automated releases. Earlier release history predates Release Please.
```

- [ ] **Step 5: Validate JSON files**

Run:

```bash
bun -e "JSON.parse(await Bun.file('release-please-config.json').text()); JSON.parse(await Bun.file('.release-please-manifest.json').text()); console.log('release config json ok')"
```

Expected output:

```text
release config json ok
```

- [ ] **Step 6: Commit**

Run:

```bash
git add release-please-config.json .release-please-manifest.json version.txt CHANGELOG.md
git commit -m "chore(release): bootstrap release-please config"
```

## Task 2: Add the Release Please workflow

**Files:**

- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create `.github/workflows/release.yml`**

Create `.github/workflows/release.yml` with this exact content:

```yaml
name: Release

on:
  push:
    branches: ['main']
  workflow_dispatch:

permissions:
  contents: write
  issues: write
  pull-requests: write

concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false

jobs:
  release-please:
    runs-on: ubuntu-latest
    steps:
      - name: Run Release Please
        id: release
        uses: googleapis/release-please-action@45996ed1f6d02564a971a2fa1b5860e934307cf7 # v5.0.0
        with:
          token: ${{ secrets.RELEASE_PLEASE_TOKEN }}
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json
```

- [ ] **Step 2: Check that the workflow uses the automation secret**

Run:

```bash
rg -n "RELEASE_PLEASE_TOKEN|GITHUB_TOKEN|release-please-action" .github/workflows/release.yml
```

Expected output must include:

```text
.github/workflows/release.yml:22:        uses: googleapis/release-please-action@45996ed1f6d02564a971a2fa1b5860e934307cf7 # v5.0.0
.github/workflows/release.yml:24:          token: ${{ secrets.RELEASE_PLEASE_TOKEN }}
```

Expected output must not include `GITHUB_TOKEN`.

- [ ] **Step 3: Check whitespace**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 4: Commit**

Run:

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): add release-please workflow"
```

## Task 3: Document the release flow

**Files:**

- Create: `docs-site/src/content/docs/contributing/releases.md`
- Modify: `docs-site/astro.config.mjs`
- Modify: `CONTRIBUTING.md`

- [ ] **Step 1: Create `docs-site/src/content/docs/contributing/releases.md`**

Create the file with this exact content:

```markdown
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
6. Confirm distribution workflows published the expected Docker image and Helm chart artifacts.

## Tag policy

`latest` is reserved for the latest stable release. `edge` is reserved for the latest successful `main` build. Release tags publish `X.Y.Z` and `X.Y` image tags.

## If a release does not appear

Check these in order:

1. The merged commits use Conventional Commit types such as `fix:` or `feat:`.
2. `.github/workflows/release.yml` ran on the latest push to `main`.
3. `RELEASE_PLEASE_TOKEN` exists and has write access.
4. GitHub Actions is allowed to create pull requests.
5. The release PR was merged, not just opened.
```

- [ ] **Step 2: Update the Starlight sidebar**

In `docs-site/astro.config.mjs`, replace the current Contributing sidebar group:

```js
{
  label: 'Contributing',
  items: [{ label: 'Architecture', slug: 'contributing/architecture' }],
},
```

with:

```js
{
  label: 'Contributing',
  items: [
    { label: 'Architecture', slug: 'contributing/architecture' },
    { label: 'Releases', slug: 'contributing/releases' },
  ],
},
```

- [ ] **Step 3: Update `CONTRIBUTING.md`**

In `CONTRIBUTING.md`, add this section between `## Conventions` and `## Pull requests`:

```markdown
## Releases

Release Please manages changelogs, version bumps, GitHub Releases, and SemVer tags.

Normal contributor PRs should use Conventional Commits. After changes land on `main`, Release Please opens or updates a release PR. A maintainer reviews and merges that release PR when it is time to publish.

The release workflow needs a `RELEASE_PLEASE_TOKEN` repository secret. See the release guide in the docs site for token permissions and troubleshooting.
```

- [ ] **Step 4: Run the human-facing docs check**

Read the new release guide and `CONTRIBUTING.md` changes aloud or with a text review pass. Remove filler phrases, hype, generic conclusions, and any chatbot-style phrasing. Keep the writing direct and maintainer-focused.

- [ ] **Step 5: Commit**

Run:

```bash
git add docs-site/src/content/docs/contributing/releases.md docs-site/astro.config.mjs CONTRIBUTING.md
git commit -m "docs(release): document release workflow"
```

## Task 4: Verify the release-management change

**Files:**

- Validate: `release-please-config.json`
- Validate: `.release-please-manifest.json`
- Validate: `.github/workflows/release.yml`
- Validate: `docs-site/src/content/docs/contributing/releases.md`
- Validate: `CONTRIBUTING.md`

- [ ] **Step 1: Validate JSON**

Run:

```bash
bun -e "JSON.parse(await Bun.file('release-please-config.json').text()); JSON.parse(await Bun.file('.release-please-manifest.json').text()); console.log('json ok')"
```

Expected output:

```text
json ok
```

- [ ] **Step 2: Run repository checks**

Run:

```bash
bun run format --check
bun run lint
bun test
```

Expected:

- format check exits `0`
- lint exits `0`
- tests exit `0`

- [ ] **Step 3: Build docs**

Run:

```bash
cd docs-site
bun install --frozen-lockfile
bun run build
```

Expected: Astro build exits `0`.

If `bun install --frozen-lockfile` fails because the existing lockfile is already stale, stop and report the lockfile failure. Do not silently rewrite docs dependencies in this release-management task.

- [ ] **Step 4: Check for accidental later-phase work**

Run:

```bash
git diff --name-only HEAD~3..HEAD
```

Expected paths should be limited to:

```text
release-please-config.json
.release-please-manifest.json
version.txt
CHANGELOG.md
.github/workflows/release.yml
docs-site/src/content/docs/contributing/releases.md
docs-site/astro.config.mjs
CONTRIBUTING.md
```

If other files appear, inspect them. Keep only files directly needed for release management.

- [ ] **Step 5: Final commit if verification changed files**

If verification or formatting changed files, commit them:

```bash
git add release-please-config.json .release-please-manifest.json version.txt CHANGELOG.md .github/workflows/release.yml docs-site/src/content/docs/contributing/releases.md docs-site/astro.config.mjs CONTRIBUTING.md
git commit -m "chore(release): verify release management setup"
```

Skip this commit if there are no changes.

## Task 5: Repository setup after merge

**Files:**

- No repository files.

These steps happen after the PR merges, because they require repository settings and secrets.

- [ ] **Step 1: Create the automation token**

Create a least-privilege fine-grained PAT or GitHub App token with access to `thilak-rao/remotecache`.

Required repository permissions:

- Contents: read and write
- Pull requests: read and write
- Issues: read and write

- [ ] **Step 2: Store the secret**

Run this from the repository root:

```bash
gh secret set RELEASE_PLEASE_TOKEN
```

Paste the token when prompted.

Expected output:

```text
✓ Set Actions secret RELEASE_PLEASE_TOKEN for thilak-rao/remotecache
```

- [ ] **Step 3: Confirm GitHub Actions can create PRs**

Open repository settings:

```bash
gh repo view --web
```

In GitHub, go to Settings -> Actions -> General. Confirm "Allow GitHub Actions to create and approve pull requests" is enabled.

- [ ] **Step 4: Smoke test the workflow**

After the setup PR merges into `main`, run:

```bash
gh run list --workflow release.yml --branch main --limit 5
```

Expected: a recent `Release` workflow run exists for `main`.

Then inspect it:

```bash
gh run view --workflow release.yml --log-failed
```

Expected: no failed release job.

If Release Please creates a release PR, inspect it:

```bash
gh pr list --search "Release Please" --state open --limit 5
```

Expected: an open release PR if unreleased Conventional Commits exist after `v2.0.0`.

## Handoff prompt for a new agent

Use this prompt to hand Plan 1 to a fresh implementation agent:

```text
<instructions>
Implement Plan 1 only: Release Management.

MUST read AGENTS.md first and follow the Bun/runtime/docs rules.
MUST read docs/superpowers/specs/2026-06-29-release-ci-distribution-hardening-design.md and docs/superpowers/plans/2026-06-29-release-management.md before editing.
MUST use current official Release Please docs through Context7 before changing release-please config or workflow syntax.
MUST keep GitHub Actions pinned to commit SHAs with a trailing version comment.
MUST not implement Docker tag changes, Helm publishing, /health, TLS, S3 integration tests, Nx e2e, Trivy, or audit gates in this task.
</instructions>

<context>
The repo is remotecache, a Bun-based self-hosted Nx remote cache server. It already has CI, docs, Docker publishing, CodeQL, Scorecard, and Dependabot. The missing piece for this task is automated release management: changelog, version tracking, release PRs, SemVer tags, and GitHub Releases.

Existing latest tags are v1.0.0 and v2.0.0. Bootstrap Release Please from 2.0.0.
</context>

<source_files>
- AGENTS.md
- docs/superpowers/specs/2026-06-29-release-ci-distribution-hardening-design.md
- docs/superpowers/plans/2026-06-29-release-management.md
- .github/workflows/ci.yml
- .github/workflows/publish-image.yml
- CONTRIBUTING.md
- docs-site/astro.config.mjs
</source_files>

<output_format>
Work task by task from the plan. After each task, report:
- files changed
- commands run
- whether each command passed
- commit SHA for that task
- any blocker or deviation from the plan

At the end, report the final verification status and the exact repository setup steps still needed for RELEASE_PLEASE_TOKEN.
</output_format>
```

## Plan self-review

- Spec coverage: covers Phase 1 release management from the approved design.
- Placeholder scan: no incomplete-work markers remain.
- Scope check: Docker, Helm, health, TLS, audits, and e2e work are explicitly excluded from this plan.
- Type and file consistency: Release Please uses `simple`, `version.txt`, `CHANGELOG.md`, and `.release-please-manifest.json` consistently.

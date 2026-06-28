# Repo Hardening + Starlight Docs Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the GitHub repo with solo-appropriate guardrails and supply-chain protections, and publish a comprehensive Starlight documentation site to GitHub Pages.

**Architecture:** In-repo files (security workflows, governance docs, a `docs-site/` Starlight app) are committed on branch `feat/harden-repo-and-docs-site`, merged to `main` via one PR. A `docs.yml` workflow builds the site on PRs and deploys it to Pages on `main`. GitHub-side settings (ruleset, Dependabot, merge settings, Pages) are applied via `gh` after the workflows land on `main`.

**Tech Stack:** Bun, Astro 7 + `@astrojs/starlight` 0.41, `starlight-openapi`, `starlight-links-validator`, GitHub Actions (CodeQL, OpenSSF Scorecard, Pages), `gh` CLI.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-28-repo-hardening-and-docs-site-design.md`.
- **Runtime:** Bun only. Build the site with Bun (`bun install`, `bun run build`); never introduce npm/pnpm/yarn or a Node-only toolchain. CI lockfile flag is `--frozen-lockfile`.
- **Branch:** all commits go on `feat/harden-repo-and-docs-site` (already exists; the AGENTS.md docs-sync rule is already committed there). Conventional Commits for every commit.
- **Pin Actions to SHA:** every `uses:` references a full commit SHA with a trailing `# vX.Y.Z` comment. Verified SHAs (use verbatim):
  - `actions/checkout` → `9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0` # v7.0.0
  - `oven-sh/setup-bun` → `0c5077e51419868618aeaa5fe8019c62421857d6` # v2.2.0
  - `docker/setup-buildx-action` → `d7f5e7f509e45cec5c76c4d5afdd7de93d0b3df5` # v4.1.0
  - `docker/login-action` → `650006c6eb7dba73a995cc03b0b2d7f5ca915bee` # v4.2.0
  - `docker/metadata-action` → `80c7e94dd9b9319bd5eb7a0e0fe9291e23a2a2e9` # v6.1.0
  - `docker/build-push-action` → `f9f3042f7e2789586610d6e8b85c8f03e5195baf` # v7.2.0
  - `actions/configure-pages` → `45bfe0192ca1faeb007ade9deae92b16b8254a0d` # v6.0.0
  - `actions/upload-pages-artifact` → `fc324d3547104276b827a68afc52ff2a11cc49c9` # v5.0.0
  - `actions/deploy-pages` → `cd2ce8fcbc39b97be8ca5fce6e763baed58fa128` # v5.0.0
  - `github/codeql-action` → `c35d1b164463ee62a100735382aaaa525c5d3496` # codeql-bundle-v2.25.6
  - `ossf/scorecard-action` → `4eaacf0543bb3f2c246792bd56e8cdeffafb205a` # v2.4.3
  - `actions/upload-artifact` → `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` # v7.0.1
- **Pages URL:** `https://thilak-rao.github.io/nx-cache-server-bun/`. Astro `site: 'https://thilak-rao.github.io'`, `base: '/nx-cache-server-bun'`.
- **OpenAPI is the single API source:** the site's API Reference is generated from `nx-cache-server.openapi.json`; never hand-write API docs.
- **Humanizer:** every human-facing file (README + all `docs-site/` prose pages) gets a `humanizer` pass before its commit. Tables, code blocks, env-var names, and status codes are copied verbatim from existing docs; only connective prose is authored then humanized.
- **`gh` owner/repo:** use the literal `{owner}/{repo}` placeholder in `gh api` calls — `gh` expands it for the current repo.
- **Scope fallback:** any `gh` settings call that fails for a missing token scope (try `gh auth refresh -h github.com -s admin:org,repo` once) is recorded in a checklist comment on the PR instead of silently skipped.

---

## Task 1: Governance files

**Files:**

- Create: `SECURITY.md`
- Create: `.github/CODEOWNERS`
- Create: `CONTRIBUTING.md`
- Create: `.github/pull_request_template.md`
- Create: `.github/ISSUE_TEMPLATE/bug_report.md`
- Create: `.github/ISSUE_TEMPLATE/feature_request.md`
- Create: `.github/ISSUE_TEMPLATE/config.yml`

**Interfaces:**

- Consumes: nothing.
- Produces: governance docs referenced by README badges (Task 10) and the ruleset/Issues settings (Task 12).

- [ ] **Step 1: Write `.github/CODEOWNERS`**

```
* @thilak-rao
```

- [ ] **Step 2: Write `SECURITY.md`**

```markdown
# Security Policy

## Reporting a vulnerability

Please report security issues privately through GitHub's
[Private Vulnerability Reporting](https://github.com/thilak-rao/nx-cache-server-bun/security/advisories/new).
Do not open a public issue for a suspected vulnerability.

You can expect an initial acknowledgement within a few days. Once a fix is
available, a GitHub Security Advisory is published with credit to the reporter.

## Supported versions

Only the latest published image and `main` receive security fixes. Pin to a
released tag (`ghcr.io/thilak-rao/nx-cache-server-bun:X.Y.Z`) and upgrade to
pick up fixes.
```

- [ ] **Step 3: Write `CONTRIBUTING.md`**

````markdown
# Contributing

Thanks for helping improve nx-cache-server-bun.

## Prerequisites

This project runs on [Bun](https://bun.sh). Install Bun, then:

```sh
bun install
```
````

## Develop

- `bun run serve` — start the server (requires `ADMIN_TOKEN`).
- `bun test` — run unit (`*.spec.ts`) and e2e (`e2e/*.e2e.spec.ts`) tests.
- `bun run lint` — oxlint.
- `bun run format` — oxfmt (rewrites files). CI runs `bun run format --check`, so format before pushing.

Build the docs site from `docs-site/` with `bun install && bun run build`.

## Conventions

- Conventional Commits: `type(scope): subject` (`feat|fix|docs|refactor|perf|test|build|ci|chore|revert`).
- Bun built-ins only — no Node-only equivalents or extra deps for what Bun provides.
- Docs travel with code: a change to behavior, the HTTP API, env vars, or config updates the matching docs surface in the same commit (see `AGENTS.md`).
- Full docs: https://thilak-rao.github.io/nx-cache-server-bun/

## Pull requests

CI (format-check, lint, test) and CodeQL must pass. Keep PRs focused.

````

- [ ] **Step 4: Write `.github/pull_request_template.md`**

```markdown
## What & why

<!-- Brief description of the change and motivation. -->

## Checklist

- [ ] `bun test` passes
- [ ] `bun run lint` passes
- [ ] `bun run format --check` passes
- [ ] Docs updated where behavior/API/config/env changed (README, `docs-site/`, or `nx-cache-server.openapi.json`)
- [ ] Commits follow Conventional Commits
````

- [ ] **Step 5: Write `.github/ISSUE_TEMPLATE/bug_report.md`**

```markdown
---
name: Bug report
about: Report a problem with the server
title: ''
labels: bug
---

**What happened**

**Expected behavior**

**Steps to reproduce**

**Environment**

- Version / image tag:
- Storage strategy (filesystem / s3):
- Bun version (if running from source):
```

- [ ] **Step 6: Write `.github/ISSUE_TEMPLATE/feature_request.md`**

```markdown
---
name: Feature request
about: Suggest an improvement
title: ''
labels: enhancement
---

**Problem**

**Proposed solution**

**Alternatives considered**
```

- [ ] **Step 7: Write `.github/ISSUE_TEMPLATE/config.yml`**

```yaml
blank_issues_enabled: false
contact_links:
  - name: Security report
    url: https://github.com/thilak-rao/nx-cache-server-bun/security/advisories/new
    about: Report a vulnerability privately (do not open a public issue).
```

- [ ] **Step 8: Run humanizer on `SECURITY.md` and `CONTRIBUTING.md`**

Invoke the `humanizer` skill on both files; apply its edits.

- [ ] **Step 9: Verify files exist**

Run: `ls SECURITY.md CONTRIBUTING.md .github/CODEOWNERS .github/pull_request_template.md .github/ISSUE_TEMPLATE/`
Expected: all paths listed, no "No such file".

- [ ] **Step 10: Commit**

```bash
git add SECURITY.md CONTRIBUTING.md .github/CODEOWNERS .github/pull_request_template.md .github/ISSUE_TEMPLATE
git commit -m "docs: add security policy, contributing guide, and issue/PR templates"
```

---

## Task 2: CodeQL workflow

**Files:**

- Create: `.github/workflows/codeql.yml`

**Interfaces:**

- Consumes: nothing.
- Produces: a status check whose job name is `analyze` (required by the ruleset in Task 13) and code-scanning results in the Security tab.

- [ ] **Step 1: Write `.github/workflows/codeql.yml`**

```yaml
name: CodeQL

on:
  push:
    branches: ['main']
  pull_request:
    branches: ['main']
  schedule:
    - cron: '23 5 * * 1'

jobs:
  analyze:
    name: analyze
    runs-on: ubuntu-latest
    permissions:
      security-events: write
      contents: read
      actions: read
    steps:
      - name: Checkout
        uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0

      - name: Initialize CodeQL
        uses: github/codeql-action/init@c35d1b164463ee62a100735382aaaa525c5d3496 # codeql-bundle-v2.25.6
        with:
          languages: javascript-typescript
          build-mode: none

      - name: Analyze
        uses: github/codeql-action/analyze@c35d1b164463ee62a100735382aaaa525c5d3496 # codeql-bundle-v2.25.6
        with:
          category: '/language:javascript-typescript'
```

- [ ] **Step 2: Validate YAML parses**

Run: `bun -e "import {parse} from 'yaml'; parse(await Bun.file('.github/workflows/codeql.yml').text()); console.log('ok')"`
Expected: `ok` (if the `yaml` module is unavailable, instead run `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/codeql.yml')); print('ok')"`).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/codeql.yml
git commit -m "ci: add CodeQL code scanning workflow"
```

---

## Task 3: OpenSSF Scorecard workflow

**Files:**

- Create: `.github/workflows/scorecard.yml`

**Interfaces:**

- Consumes: nothing.
- Produces: a Scorecard SARIF result in the Security tab and a public score used by the README badge (Task 10).

- [ ] **Step 1: Write `.github/workflows/scorecard.yml`**

```yaml
name: Scorecard

on:
  branch_protection_rule:
  schedule:
    - cron: '27 5 * * 1'
  push:
    branches: ['main']

permissions: read-all

jobs:
  analysis:
    name: Scorecard analysis
    runs-on: ubuntu-latest
    permissions:
      security-events: write
      id-token: write
      contents: read
    steps:
      - name: Checkout
        uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
        with:
          persist-credentials: false

      - name: Run Scorecard
        uses: ossf/scorecard-action@4eaacf0543bb3f2c246792bd56e8cdeffafb205a # v2.4.3
        with:
          results_file: results.sarif
          results_format: sarif
          publish_results: true

      - name: Upload artifact
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        with:
          name: SARIF file
          path: results.sarif
          retention-days: 5

      - name: Upload to code scanning
        uses: github/codeql-action/upload-sarif@c35d1b164463ee62a100735382aaaa525c5d3496 # codeql-bundle-v2.25.6
        with:
          sarif_file: results.sarif
```

- [ ] **Step 2: Validate YAML parses**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/scorecard.yml')); print('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/scorecard.yml
git commit -m "ci: add OpenSSF Scorecard workflow"
```

---

## Task 4: Pin existing Actions to commit SHAs

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/publish-image.yml`

**Interfaces:**

- Consumes: the SHA table in Global Constraints.
- Produces: SHA-pinned workflows; behavior unchanged.

- [ ] **Step 1: Edit `ci.yml` — pin both actions**

Replace `uses: actions/checkout@v7` with:

```yaml
uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
```

Replace `uses: oven-sh/setup-bun@v2` with:

```yaml
uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0
```

- [ ] **Step 2: Edit `publish-image.yml` — pin all five actions**

```yaml
uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
```

```yaml
uses: docker/setup-buildx-action@d7f5e7f509e45cec5c76c4d5afdd7de93d0b3df5 # v4.1.0
```

```yaml
uses: docker/login-action@650006c6eb7dba73a995cc03b0b2d7f5ca915bee # v4.2.0
```

```yaml
uses: docker/metadata-action@80c7e94dd9b9319bd5eb7a0e0fe9291e23a2a2e9 # v6.1.0
```

```yaml
uses: docker/build-push-action@f9f3042f7e2789586610d6e8b85c8f03e5195baf # v7.2.0
```

- [ ] **Step 3: Verify no unpinned `@vN` refs remain**

Run: `grep -rnE 'uses: .*@v[0-9]' .github/workflows/`
Expected: no output (every `uses:` now ends in a 40-char SHA).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/publish-image.yml
git commit -m "ci: pin GitHub Actions to commit SHAs"
```

---

## Task 5: Scaffold the Starlight site

**Files:**

- Create: `docs-site/package.json`
- Create: `docs-site/astro.config.mjs`
- Create: `docs-site/tsconfig.json`
- Create: `docs-site/.gitignore`
- Create: `docs-site/src/content.config.ts`
- Create: `docs-site/src/content/docs/index.mdx`
- Create: `docs-site/src/content/docs/getting-started/quickstart.md` (placeholder body; filled in Task 6)
- Generated: `docs-site/bun.lock`

**Interfaces:**

- Consumes: `nx-cache-server.openapi.json` (read at build time by `starlight-openapi`).
- Produces: a buildable Starlight app whose sidebar references slugs `getting-started/quickstart`, `guides/configuration`, `guides/storage-strategies`, `guides/tokens`, `guides/security`, `guides/deployment`, `contributing/architecture`, plus the auto-generated `...openAPISidebarGroups`.

- [ ] **Step 1: Write `docs-site/package.json`**

```json
{
  "name": "nx-cache-server-docs",
  "type": "module",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview"
  },
  "dependencies": {
    "@astrojs/starlight": "^0.41.1",
    "astro": "^7.0.3",
    "sharp": "^0.34.5",
    "starlight-links-validator": "^0.25.1",
    "starlight-openapi": "^0.25.3"
  }
}
```

- [ ] **Step 2: Write `docs-site/tsconfig.json`**

```json
{
  "extends": "astro/tsconfigs/strict",
  "include": [".astro/types.d.ts", "**/*"],
  "exclude": ["dist"]
}
```

- [ ] **Step 3: Write `docs-site/.gitignore`**

```
dist/
.astro/
node_modules/
```

- [ ] **Step 4: Write `docs-site/src/content.config.ts`**

```ts
import { defineCollection } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
};
```

- [ ] **Step 5: Write `docs-site/astro.config.mjs`**

```js
// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightOpenAPI, { openAPISidebarGroups } from 'starlight-openapi';
import starlightLinksValidator from 'starlight-links-validator';

// https://astro.build/config
export default defineConfig({
  site: 'https://thilak-rao.github.io',
  base: '/nx-cache-server-bun',
  integrations: [
    starlight({
      title: 'nx-cache-server-bun',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/thilak-rao/nx-cache-server-bun',
        },
      ],
      plugins: [
        starlightLinksValidator(),
        // Generate the API reference from the OpenAPI spec at the repo root.
        starlightOpenAPI([
          {
            base: 'api',
            schema: '../nx-cache-server.openapi.json',
            sidebar: { label: 'API Reference' },
          },
        ]),
      ],
      sidebar: [
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
            { label: 'Deployment', slug: 'guides/deployment' },
          ],
        },
        {
          label: 'Contributing',
          items: [{ label: 'Architecture', slug: 'contributing/architecture' }],
        },
        ...openAPISidebarGroups,
      ],
    }),
  ],
});
```

- [ ] **Step 6: Write `docs-site/src/content/docs/index.mdx`**

```mdx
---
title: nx-cache-server-bun
description: A small, self-hosted Nx Remote Cache server on the Bun runtime.
template: splash
hero:
  tagline: Self-hosted Nx Remote Cache on Bun — filesystem or S3 storage, token auth, one small container.
  actions:
    - text: Quickstart
      link: /nx-cache-server-bun/getting-started/quickstart/
      icon: right-arrow
    - text: View on GitHub
      link: https://github.com/thilak-rao/nx-cache-server-bun
      icon: external
      variant: minimal
---

import { Card, CardGrid } from '@astrojs/starlight/components';

<CardGrid>
  <Card title="Nx cache API" icon="rocket">
    Implements `GET`/`PUT /v1/cache/:hash` for the Nx self-hosted remote cache.
  </Card>
  <Card title="Token auth" icon="approve-check">
    `readonly` and `full` tokens, hashed at rest; an admin token manages them.
  </Card>
  <Card title="Pluggable storage" icon="open-book">
    Local filesystem by default, or any S3-compatible bucket.
  </Card>
  <Card title="Runs on Bun" icon="seti:typescript">
    `Bun.serve` + `bun:sqlite`, shipped as a small non-root container.
  </Card>
</CardGrid>
```

- [ ] **Step 7: Write a temporary `docs-site/src/content/docs/getting-started/quickstart.md`**

```markdown
---
title: Quickstart
description: Get the server running and wired into Nx.
---

Placeholder — filled in Task 6.
```

- [ ] **Step 8: Create temporary stub pages so the sidebar resolves during this task's build**

Create each of these with frontmatter only (real content lands in Tasks 6–8). Body is a single line `Placeholder.`:
`guides/configuration.md`, `guides/storage-strategies.md`, `guides/tokens.md`, `guides/security.md`, `guides/deployment.md`, `contributing/architecture.md` (all under `docs-site/src/content/docs/`). Each file:

```markdown
---
title: <Page title>
description: <one line>
---

Placeholder.
```

Use these exact titles: Configuration, Storage strategies, Token & admin API, Security model, Deployment, Architecture.

- [ ] **Step 9: Install deps with Bun**

Run: `cd docs-site && bun install`
Expected: completes; `docs-site/bun.lock` is created.

- [ ] **Step 10: Build and confirm the API reference generates**

Run: `cd docs-site && bun run build`
Expected: build succeeds; output includes generated API pages. Verify with:
`ls docs-site/dist/api` → expect an `index.html` (and per-operation folders) generated from the OpenAPI spec.
If `starlight-links-validator` errors on the splash hero links, set `starlightLinksValidator({ errorOnRelativeLinks: false })` in `astro.config.mjs` and rebuild.

- [ ] **Step 11: Commit**

```bash
git add docs-site
git commit -m "feat(docs): scaffold Starlight site with OpenAPI reference"
```

---

## Task 6: Getting Started + Configuration pages

**Files:**

- Modify: `docs-site/src/content/docs/getting-started/quickstart.md`
- Modify: `docs-site/src/content/docs/guides/configuration.md`

**Interfaces:**

- Consumes: env-var facts below (verbatim from `README.md`).
- Produces: the canonical Configuration page that README links to.

- [ ] **Step 1: Write `quickstart.md`** — frontmatter `title: Quickstart`. Author prose from these exact, verbatim facts (then humanize):
  - Install + run:
    ```sh
    bun install
    ADMIN_TOKEN="change-me" bun run serve
    ```
    Server starts on `http://localhost:3000` by default.
  - Create a `full` token:
    ```sh
    curl -sS -X POST \
      -H "Authorization: Bearer change-me" \
      -H "Content-Type: application/json" \
      "http://localhost:3000/v1/admin/tokens" \
      -d '{"id":"CI","permission":"full"}'
    ```
    The response body is the only place the generated token value appears (tokens are stored hashed).
  - Point Nx at the server (env on the Nx process):
    ```sh
    export NX_SELF_HOSTED_REMOTE_CACHE_SERVER="http://localhost:3000"
    export NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN="<token-from-admin-api>"
    ```
  - Link to the API Reference (`/nx-cache-server-bun/api/`) and Configuration page.

- [ ] **Step 2: Write `guides/configuration.md`** — frontmatter `title: Configuration`. Include this exact env-var table verbatim, then add short prose:

  | Variable               | Required | Default                                | Purpose                                                                     |
  | ---------------------- | -------- | -------------------------------------- | --------------------------------------------------------------------------- |
  | `ADMIN_TOKEN`          | yes      | —                                      | Admin API auth; full cache access. Server exits on startup without it.      |
  | `PORT`                 | no       | `3000`                                 | HTTP port.                                                                  |
  | `TOKENS_DB_PATH`       | no       | `./data/nx-cache-server-tokens.sqlite` | SQLite token DB path. Persist this in production.                           |
  | `MAX_UPLOAD_BYTES`     | no       | `524288000` (500 MiB)                  | Upload size cap for `PUT`; over the limit returns `413`.                    |
  | `STORAGE_STRATEGY`     | no       | filesystem                             | Set to `s3` for S3-compatible storage; any other value uses the filesystem. |
  | `CACHE_DIR`            | no       | `./cache`                              | Filesystem cache directory (filesystem strategy).                           |
  | `S3_REGION`            | for s3   | —                                      | S3 region.                                                                  |
  | `S3_BUCKET`            | for s3   | —                                      | S3 bucket.                                                                  |
  | `S3_ACCESS_KEY_ID`     | for s3   | —                                      | S3 access key.                                                              |
  | `S3_SECRET_ACCESS_KEY` | for s3   | —                                      | S3 secret key.                                                              |
  | `S3_ENDPOINT`          | no       | —                                      | Custom endpoint for MinIO / other S3-compatible providers.                  |
  | `VERBOSE`              | no       | —                                      | Set `1` to print `logger.info`/`logger.log` output; errors always print.    |

- [ ] **Step 3: Build**

Run: `cd docs-site && bun run build`
Expected: success; links-validator passes.

- [ ] **Step 4: Humanizer pass** on both edited files; apply edits.

- [ ] **Step 5: Commit**

```bash
git add docs-site/src/content/docs/getting-started/quickstart.md docs-site/src/content/docs/guides/configuration.md
git commit -m "docs(site): write quickstart and configuration pages"
```

---

## Task 7: Storage, Tokens, Security, Deployment guides

**Files:**

- Modify: `docs-site/src/content/docs/guides/storage-strategies.md`
- Modify: `docs-site/src/content/docs/guides/tokens.md`
- Modify: `docs-site/src/content/docs/guides/security.md`
- Modify: `docs-site/src/content/docs/guides/deployment.md`

**Interfaces:**

- Consumes: facts below (verbatim from `README.md`, `AGENTS.md`, and source).
- Produces: the four deep guides referenced by the sidebar.

- [ ] **Step 1: Write `guides/storage-strategies.md`** (`title: Storage strategies`). Facts:
  - Filesystem is the default; `CACHE_DIR` (default `./cache`) holds entries.
  - S3: set `STORAGE_STRATEGY=s3` and the four `S3_*` vars; `S3_ENDPOINT` for MinIO. Verbatim example:
    ```sh
    export STORAGE_STRATEGY=s3
    export S3_REGION=us-east-1
    export S3_BUCKET=nx-cache
    export S3_ACCESS_KEY_ID=...
    export S3_SECRET_ACCESS_KEY=...
    export S3_ENDPOINT="http://localhost:9000"  # optional (MinIO, etc.)
    ```
  - Writing a custom strategy: implement `CacheStorageStrategy` (`src/cache/storage-strategy/storage-strategy.interface.ts`) and register it in `createCacheStorage` (`src/cache/create-cache-storage.ts`). Filesystem (`file-system.ts`) and S3 (`s3.ts`) are the existing implementations to copy.
  - Cache writes are append-only: an existing hash returns `409`, never overwritten.

- [ ] **Step 2: Write `guides/tokens.md`** (`title: Token & admin API`). Facts:
  - Permissions: `readonly` (download), `full` (download + upload), admin token (manage tokens + full access).
  - Admin endpoints (all require `Authorization: Bearer <ADMIN_TOKEN>`):
    - `GET /v1/admin/tokens` → `{ "tokens": [{ "id", "permission" }] }` (no values).
    - `POST /v1/admin/tokens` body `{ "id": string, "permission": "readonly" | "full" }`; response is the only place the value appears.
    - `DELETE /v1/admin/tokens/:token` — delete by token value.
  - Values are hashed (SHA-256) at rest; a lost token can't be recovered and must be replaced.
  - Link to the API Reference for request/response schemas.

- [ ] **Step 3: Write `guides/security.md`** (`title: Security model`). Facts:
  - Token values hashed with SHA-256 at rest (`src/token/hash-token.ts`); store looks up by hash, returns only `id` + `permission`.
  - Admin token compared in constant time (`src/safe-equal.ts`).
  - Cache hashes validated to reject path traversal / malformed input (`src/cache/is-valid-hash.ts`); `PUT` requires an integer `Content-Length` (`400` otherwise).
  - Append-only writes (`409` on existing hash). `MAX_UPLOAD_BYTES` enforced (`413`).
  - `TokenStorage` migrates pre-hash plaintext DBs on open, gated by `PRAGMA user_version` (`src/token/token-storage.ts`).
  - HTTP status reference:
    - `GET /v1/cache/:hash`: `200` octet-stream · `404` missing · `403` no read permission.
    - `PUT /v1/cache/:hash`: `200` ok · `409` exists · `400` bad `Content-Length`/hash · `403` no write permission · `413` over `MAX_UPLOAD_BYTES`.

- [ ] **Step 4: Write `guides/deployment.md`** (`title: Deployment`). Facts:
  - Image: `ghcr.io/thilak-rao/nx-cache-server-bun` — `:latest` + `:sha-<short>` from `main`; `:X.Y.Z` + `:X.Y` from version tags.
  - Runs as a non-root user; Bun base image pinned by digest.
  - Persist `./data` (token DB) and, for the filesystem strategy, `./cache`. Set `ADMIN_TOKEN`.
  - Minimal run example:
    ```sh
    docker run -p 3000:3000 \
      -e ADMIN_TOKEN="change-me" \
      -v "$PWD/data:/app/data" \
      -v "$PWD/cache:/app/cache" \
      ghcr.io/thilak-rao/nx-cache-server-bun:latest
    ```

- [ ] **Step 5: Build**

Run: `cd docs-site && bun run build`
Expected: success; links-validator passes.

- [ ] **Step 6: Humanizer pass** on all four files; apply edits.

- [ ] **Step 7: Commit**

```bash
git add docs-site/src/content/docs/guides
git commit -m "docs(site): write storage, tokens, security, and deployment guides"
```

---

## Task 8: Architecture page

**Files:**

- Modify: `docs-site/src/content/docs/contributing/architecture.md`

**Interfaces:**

- Consumes: architecture facts (verbatim from `AGENTS.md`).
- Produces: the Contributing/Architecture page.

- [ ] **Step 1: Write `contributing/architecture.md`** (`title: Architecture`). Facts:
  - HTTP via `Bun.serve` with the `routes` object in `src/main.ts`.
  - Handlers stay thin: assemble dependencies, delegate to pure functions (`getCache`, `writeCache`, `addToken`, `listTokens`, `deleteToken`) that take deps as params and return a `Response` — the shape that makes them unit-testable.
  - Every response is built from a factory in `src/responses.ts` (`okResponse`, `badRequest`, `conflictError`, …); handlers never call `new Response`.
  - Storage is pluggable via `CacheStorageStrategy`, registered in `createCacheStorage`; filesystem + S3 exist.
  - SQLite via `bun:sqlite`; tokens hashed at rest with `PRAGMA user_version` migration.
  - Tests colocate as `*.spec.ts`; e2e under `e2e/`. Run with `bun test`.
  - Link to CONTRIBUTING.md for setup.

- [ ] **Step 2: Build and verify full sidebar resolves (no remaining placeholders)**

Run: `cd docs-site && bun run build`
Expected: success. Then confirm no stub bodies remain:
Run: `grep -rl "^Placeholder.$" docs-site/src/content/docs || echo "none"`
Expected: `none`.

- [ ] **Step 3: Humanizer pass**; apply edits.

- [ ] **Step 4: Commit**

```bash
git add docs-site/src/content/docs/contributing/architecture.md
git commit -m "docs(site): write architecture page"
```

---

## Task 9: Docs build + Pages deploy workflow

**Files:**

- Create: `.github/workflows/docs.yml`

**Interfaces:**

- Consumes: the `docs-site/` build (`bun run build` → `docs-site/dist`).
- Produces: a `build` status check on PRs (path-filtered, so NOT a ruleset-required check) and a Pages deploy on `main`.

- [ ] **Step 1: Write `.github/workflows/docs.yml`**

```yaml
name: Docs

on:
  push:
    branches: ['main']
    paths:
      - 'docs-site/**'
      - 'nx-cache-server.openapi.json'
      - '.github/workflows/docs.yml'
  pull_request:
    paths:
      - 'docs-site/**'
      - 'nx-cache-server.openapi.json'
      - '.github/workflows/docs.yml'
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: docs-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build:
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
        working-directory: docs-site

      - name: Build
        run: bun run build
        working-directory: docs-site

      - name: Upload Pages artifact
        if: github.event_name != 'pull_request'
        uses: actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9 # v5.0.0
        with:
          path: docs-site/dist

  deploy:
    needs: build
    if: github.event_name != 'pull_request'
    runs-on: ubuntu-latest
    permissions:
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@cd2ce8fcbc39b97be8ca5fce6e763baed58fa128 # v5.0.0
```

- [ ] **Step 2: Validate YAML parses**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/docs.yml')); print('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/docs.yml
git commit -m "ci: add docs build + Pages deploy workflow"
```

---

## Task 10: Trim README, add badges, reconcile AGENTS.md

**Files:**

- Modify: `README.md`
- Modify: `AGENTS.md:3`

**Interfaces:**

- Consumes: the docs site (canonical deep reference).
- Produces: a lean README landing; `AGENTS.md` line 3 pointing at the site.

- [ ] **Step 1: Rewrite `README.md`** to a landing page with these sections only (move deep content to the site):
  - Title + one-line description.
  - Badge row (place directly under the title):
    ```markdown
    [![CI](https://github.com/thilak-rao/nx-cache-server-bun/actions/workflows/ci.yml/badge.svg)](https://github.com/thilak-rao/nx-cache-server-bun/actions/workflows/ci.yml)
    [![Docs](https://github.com/thilak-rao/nx-cache-server-bun/actions/workflows/docs.yml/badge.svg)](https://thilak-rao.github.io/nx-cache-server-bun/)
    [![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/thilak-rao/nx-cache-server-bun/badge)](https://scorecard.dev/viewer/?uri=github.com/thilak-rao/nx-cache-server-bun)
    [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
    ```
  - **Documentation:** prominent link to `https://thilak-rao.github.io/nx-cache-server-bun/`.
  - **Features:** the existing short feature bullets.
  - **Quickstart:** install + `ADMIN_TOKEN="change-me" bun run serve` + create-token curl (keep concise; same commands as the Quickstart page).
  - **Configure Nx:** the two `NX_SELF_HOSTED_REMOTE_CACHE_*` env vars.
  - **Docker:** one `docker run` line + link to the Deployment guide.
  - **Links:** Configuration, API Reference, Security model, Contributing (all into the docs site).
  - Remove from README (now canonical on the site): the full env-var section, full API reference, S3 detail, and admin-endpoint detail — replace each with a one-line link.

- [ ] **Step 2: Reconcile `AGENTS.md` line 3**

Change line 3's tail so it points at the site instead of the README for the full reference. Replace:

```
See @README.md for the full API surface, environment variables, and deployment.
```

with:

```
See https://thilak-rao.github.io/nx-cache-server-bun/ for the full API surface, environment variables, and deployment; @README.md is the quickstart landing.
```

(`CLAUDE.md` is a symlink to `AGENTS.md`, so this updates both.)

- [ ] **Step 3: Humanizer pass on `README.md`**; apply edits.

- [ ] **Step 4: Verify links resolve locally**

Run: `grep -n "thilak-rao.github.io/nx-cache-server-bun" README.md`
Expected: at least the Documentation link and badge present.

- [ ] **Step 5: Commit**

```bash
git add README.md AGENTS.md
git commit -m "docs: trim README to a landing page and link to the docs site"
```

---

## Task 11: Open the PR and merge to main

**Files:** none (Git/GitHub operations).

**Interfaces:**

- Consumes: all prior commits on `feat/harden-repo-and-docs-site`.
- Produces: the workflows + `docs-site/` on `main`, which triggers the first Pages deploy. Required for Task 13 (the ruleset needs the `test` and `analyze` checks to exist on `main`).

- [ ] **Step 1: Push the branch**

Run: `git push -u origin feat/harden-repo-and-docs-site`

- [ ] **Step 2: Open the PR**

Run:

```bash
gh pr create --base main --head feat/harden-repo-and-docs-site \
  --title "Harden repo and add Starlight docs site" \
  --body "Implements docs/superpowers/specs/2026-06-28-repo-hardening-and-docs-site-design.md: security workflows, governance files, SHA-pinned Actions, and a Starlight docs site deployed to GitHub Pages. GitHub-side settings are applied after merge (see plan Tasks 12–13)."
```

- [ ] **Step 3: Wait for checks, then merge**

Run: `gh pr checks --watch`
Expected: CI `test`, CodeQL `analyze`, and the docs `build` succeed.
Then: `gh pr merge --squash --delete-branch`
(If branch protection from a later task ever blocks this, the repo admin bypass applies.)

- [ ] **Step 4: Sync local main**

Run: `git checkout main && git pull`

---

## Task 12: Apply GitHub security, merge, and discoverability settings

**Files:** none (`gh` API operations). Record any scope-blocked call as a PR/issue checklist item.

**Interfaces:**

- Consumes: a merged `main`.
- Produces: Dependabot alerts + security updates, private vuln reporting, secret-scanning validity checks, merge settings, Issues enabled, topics, Pages enabled.

- [ ] **Step 1: Dependabot alerts + security updates**

```bash
gh api -X PUT repos/{owner}/{repo}/vulnerability-alerts
gh api -X PUT repos/{owner}/{repo}/automated-security-fixes
```

Expected: HTTP 204 (no output) for each.

- [ ] **Step 2: Private vulnerability reporting**

```bash
gh api -X PUT repos/{owner}/{repo}/private-vulnerability-reporting
```

Expected: HTTP 204.

- [ ] **Step 3: Secret-scanning validity + non-provider patterns**

```bash
gh api -X PATCH repos/{owner}/{repo} --input - <<'JSON'
{
  "security_and_analysis": {
    "secret_scanning_validity_checks": { "status": "enabled" },
    "secret_scanning_non_provider_patterns": { "status": "enabled" }
  }
}
JSON
```

Expected: JSON response with the two statuses `enabled`.

- [ ] **Step 4: Merge settings + enable Issues**

```bash
gh api -X PATCH repos/{owner}/{repo} \
  -F has_issues=true \
  -F allow_merge_commit=false \
  -F delete_branch_on_merge=true
```

Expected: JSON showing `has_issues: true`, `allow_merge_commit: false`, `delete_branch_on_merge: true`.

- [ ] **Step 5: Topics**

```bash
gh api -X PUT repos/{owner}/{repo}/topics \
  -f 'names[]=nx' -f 'names[]=remote-cache' -f 'names[]=bun' \
  -f 'names[]=self-hosted' -f 'names[]=docker' -f 'names[]=nx-cache'
```

Expected: JSON listing the six topics.

- [ ] **Step 6: Enable Pages with the Actions source** (idempotent — skip if Task 11's deploy already enabled it)

```bash
gh api -X POST repos/{owner}/{repo}/pages -f build_type=workflow || \
  gh api -X PUT repos/{owner}/{repo}/pages -f build_type=workflow
```

Expected: JSON with `"build_type": "workflow"` and an `html_url`.

- [ ] **Step 7: Set the homepage URL**

```bash
gh api -X PATCH repos/{owner}/{repo} -f homepage='https://thilak-rao.github.io/nx-cache-server-bun/'
```

Expected: JSON with the homepage set.

- [ ] **Step 8: Verify settings**

```bash
gh api repos/{owner}/{repo} --jq '{has_issues, allow_merge_commit, delete_branch_on_merge, security_and_analysis}'
```

Expected: Issues on, merge-commit off, delete-on-merge on, validity checks enabled.

---

## Task 13: Create the `main` ruleset (light guardrails)

**Files:** none (`gh` API operation).

**Interfaces:**

- Consumes: `test` (CI) and `analyze` (CodeQL) checks now present on `main` from Task 11.
- Produces: an active ruleset protecting `main` with admin bypass.

- [ ] **Step 1: Confirm the required check names exist**

```bash
gh api repos/{owner}/{repo}/commits/main/check-runs --jq '.check_runs[].name' | sort -u
```

Expected: includes `test` and `analyze`. If a name differs (e.g. CodeQL reports differently), substitute the actual name in Step 2's `context` values.

- [ ] **Step 2: Create the ruleset**

```bash
gh api -X POST repos/{owner}/{repo}/rulesets --input - <<'JSON'
{
  "name": "main protection",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "bypass_actors": [
    { "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" }
  ],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "required_linear_history" },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [
          { "context": "test" },
          { "context": "analyze" }
        ]
      }
    }
  ]
}
JSON
```

Expected: JSON with `"enforcement": "active"` and an `id`.

- [ ] **Step 3: Verify**

```bash
gh api repos/{owner}/{repo}/rulesets --jq '.[].name'
```

Expected: `main protection` listed.

---

## Task 14: Final verification

**Files:** none.

- [ ] **Step 1: Live site responds**

Run: `curl -sS -o /dev/null -w "%{http_code}\n" https://thilak-rao.github.io/nx-cache-server-bun/`
Expected: `200` (allow a few minutes after the deploy workflow finishes).

- [ ] **Step 2: API reference is published**

Run: `curl -sS -o /dev/null -w "%{http_code}\n" https://thilak-rao.github.io/nx-cache-server-bun/api/`
Expected: `200`.

- [ ] **Step 3: Security features active**

Run: `gh api repos/{owner}/{repo}/code-scanning/analyses --jq 'length'` (expect ≥ 1 after CodeQL + Scorecard run) and confirm the Security tab shows CodeQL + Scorecard.

- [ ] **Step 4: Confirm deploy workflow succeeded**

Run: `gh run list --workflow=docs.yml --branch main --limit 1`
Expected: latest run `completed / success`.

---

## Self-Review (completed by plan author)

**Spec coverage:** Part A files → Tasks 1–4; A2 settings → Tasks 12–13; Part B site → Tasks 5–8; B4 OpenAPI → Task 5; Part C deploy → Tasks 9, 11–12; Part D README + AGENTS.md → Task 10; anti-drift AGENTS.md rule → already committed (noted in Global Constraints). Verification section → Task 14. No gaps.

**Placeholder scan:** the only "Placeholder." bodies are temporary stub pages created in Task 5 and explicitly overwritten in Tasks 6–8; Task 8 Step 2 asserts none remain. No TBD/TODO elsewhere.

**Type/name consistency:** sidebar slugs in Task 5's `astro.config.mjs` (`getting-started/quickstart`, `guides/configuration`, `guides/storage-strategies`, `guides/tokens`, `guides/security`, `guides/deployment`, `contributing/architecture`) match the file paths created in Tasks 5–8. The CodeQL job name `analyze` (Task 2) matches the ruleset `context` (Task 13). Action SHAs are identical everywhere they appear.

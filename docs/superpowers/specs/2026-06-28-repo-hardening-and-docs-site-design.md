# Design: Repository hardening + Starlight docs site

Date: 2026-06-28

## Goal

Two related improvements to `nx-cache-server-bun`:

1. **Harden the GitHub repository** with pragmatic, solo-maintainer-appropriate
   guardrails and supply-chain protections.
2. **Publish a polished documentation site** on GitHub Pages, built from the
   existing README and OpenAPI spec.

## Locked decisions

These were settled during brainstorming and drive the rest of this spec:

- **Protection model:** solo, light guardrails — a `main` ruleset that protects
  against accidents (no force-push, no deletion, linear history, required CI)
  but keeps an admin bypass so the maintainer is never locked out. No required
  reviews, required PRs, or signed-commit enforcement.
- **Doc site:** Astro **Starlight**, built with **Bun**.
- **Content depth:** Comprehensive (guides + auto-generated API reference).
- **Execution:** the implementer applies GitHub-side settings via `gh`/the REST
  API and authors all in-repo files. Anything blocked by a missing token scope
  falls back to a documented checklist.
- **Add-ons (all in scope):** enable Issues + templates, OpenSSF Scorecard
  workflow, pin Actions to commit SHAs, secret-scanning validity checks,
  Dependabot security updates.
- **README strategy:** trim & link — README is the landing (overview +
  quickstart + link to docs); deep reference is canonical on the site.
- **Site directory:** `docs-site/`.
- **Defaults accepted:** `starlight-links-validator` broken-link check; the
  `github.io` Pages URL (custom domain deferred).

## Scope

**In scope:** everything under Parts A–D below, plus verification.

**Out of scope:** the v1.0.0 / v2.0.0 GitHub _Release pages_ (covered by the
separate `2026-06-28-github-release-pages-design.md` spec); a custom domain;
required reviews / signed-commit enforcement; `CHANGELOG.md` automation;
versioned/multi-version docs; changing the application code or its public API.

## Part A — Repository hardening

### A1. In-repo files (committed, via PR)

- `.github/workflows/codeql.yml` — CodeQL code scanning for
  `javascript-typescript` (build-mode `none`; the project is interpreted TS on
  Bun). Triggers: `pull_request`, `push` to `main`, and a weekly `schedule`.
  Results surface in the Security tab and feed the `main` ruleset's required
  check.
- `.github/workflows/scorecard.yml` — OpenSSF Scorecard
  (`ossf/scorecard-action`). Triggers: `push` to `main`, weekly `schedule`, and
  `branch_protection_rule`. `publish_results: true`; uploads SARIF to code
  scanning. Enables a Scorecard badge in the README.
- `SECURITY.md` — vulnerability-reporting policy pointing at GitHub Private
  Vulnerability Reporting, with a short supported-versions note.
- `.github/CODEOWNERS` — `* @thilak-rao`. Informational under light guardrails;
  ready if required reviews are enabled later.
- `CONTRIBUTING.md` — dev setup (`bun install`, `bun test`, `bun run lint`,
  `bun run format`), Conventional Commits, the PR flow, and a link to the docs
  site. Reflects the `Bun, not Node` conventions from `CLAUDE.md`.
- `.github/pull_request_template.md` — short checklist (tests pass, formatted,
  linted, docs updated where behavior/API changed).
- `.github/ISSUE_TEMPLATE/` — bug-report and feature-request templates plus a
  `config.yml` (only meaningful once Issues are enabled — see A2).
- **Pin all GitHub Actions to commit SHAs** (with a `# vX.Y.Z` trailing
  comment) across `ci.yml`, `publish-image.yml`, and the new workflows. Current
  actions to pin: `actions/checkout`, `oven-sh/setup-bun`,
  `docker/setup-buildx-action`, `docker/login-action`,
  `docker/metadata-action`, `docker/build-push-action`; new:
  `actions/configure-pages`, `actions/upload-pages-artifact`,
  `actions/deploy-pages`, `github/codeql-action`, `ossf/scorecard-action`,
  `actions/upload-artifact`. The existing Dependabot `github-actions` ecosystem
  keeps the SHAs fresh.

### A2. GitHub settings (applied via `gh` / REST API)

Endpoints the implementer uses (each falls back to a checklist entry if a scope
is missing):

- **Ruleset on `main`** — `POST /repos/{owner}/{repo}/rulesets`. Rules:
  `deletion`, `non_fast_forward` (block force-push), `required_linear_history`,
  and `required_status_checks` for the CI `test` job and the CodeQL check.
  Target: the default branch. `enforcement: active`. Bypass actor: the
  repository admin role (`bypass_mode: always`) so the maintainer can still push
  directly and merge own PRs.
- **Dependabot alerts** — `PUT /repos/{owner}/{repo}/vulnerability-alerts`.
- **Dependabot security updates** — `PUT
/repos/{owner}/{repo}/automated-security-fixes`.
- **Private Vulnerability Reporting** — `PUT
/repos/{owner}/{repo}/private-vulnerability-reporting`.
- **Secret-scanning validity checks + non-provider patterns** — `PATCH
/repos/{owner}/{repo}` setting
  `security_and_analysis.secret_scanning_validity_checks.status=enabled` and
  `secret_scanning_non_provider_patterns.status=enabled` (push protection +
  base secret scanning are already on).
- **Merge settings** — `PATCH /repos/{owner}/{repo}` with
  `allow_merge_commit=false` (to match required linear history) and
  `delete_branch_on_merge=true`; keep squash + rebase.
- **Enable Issues** — `PATCH /repos/{owner}/{repo}` `has_issues=true` (currently
  off). Required for the issue templates and the SECURITY/CONTRIBUTING community
  flow to be meaningful.
- **Discoverability** — set repo **topics** (`PUT
/repos/{owner}/{repo}/topics`: `nx`, `remote-cache`, `bun`, `self-hosted`,
  `docker`, `nx-cache`) and the **homepage URL** (`PATCH` `homepage`) to the
  Pages site once live.
- **Enable Pages** — see Part C.

## Part B — Docs site (Starlight)

### B1. Stack & location

- Astro **Starlight** in `docs-site/`, with its own `package.json` and lockfile
  scoped to the site (kept separate from `docs/superpowers/` planning docs).
- Built with **Bun** (`bun install`, `bun run build`) so no Node/pnpm toolchain
  is introduced, consistent with the project's `Bun, not Node` rule.
- Exact Starlight / plugin versions and config APIs are verified against `ctx7`
  and current releases during planning/implementation (per the repo's
  library-verification rule); this spec fixes intent, not pinned versions.

### B2. Information architecture (Comprehensive)

- **Home / overview** — features, value, primary links.
- **Getting started** — Quickstart (install, run with `ADMIN_TOKEN`, create a
  token, point Nx at the server).
- **Guides**
  - Configuration — environment variables (required + optional) and storage
    selection. Canonical env-var table lives here.
  - Storage strategies — filesystem (default), S3-compatible, and writing a
    custom `CacheStorageStrategy` + registering it in `createCacheStorage`.
  - Token & admin API — auth model, `readonly`/`full`/admin permissions,
    hashing at rest, the admin endpoints.
  - Security model — token hashing (SHA-256), constant-time admin-token compare,
    path-traversal/hash validation, append-only writes (409, no overwrite),
    `MAX_UPLOAD_BYTES` (413).
  - Deployment — Docker/GHCR image, non-root user, persisting `./data`,
    production tips.
- **Contributing / Architecture** — thin handlers delegating to pure functions,
  the `responses.ts` factory, pluggable storage, the test layout.
- **API Reference** — auto-generated (see B4).

### B3. Content sourcing & single-source-of-truth rules

- Content is restructured from `README.md`, `CLAUDE.md`/`AGENTS.md`, and the
  OpenAPI spec. Net-new writing is mainly Storage strategies, Security model,
  and Architecture.
- **Single sources of truth to prevent drift:**
  - HTTP API: the OpenAPI spec only; the site renders it (B4).
  - Env vars: the site's Configuration page is canonical; the trimmed README
    links to it.
- All human-facing copy (site pages + the revised README) is run through the
  `humanizer` skill before commit, per the global writing rule.

### B4. OpenAPI integration

- The API Reference is generated from the existing
  `nx-cache-server.openapi.json` via the `starlight-openapi` plugin, integrated
  into Starlight's sidebar and search. The spec file remains the only API
  definition; no schema is duplicated into Markdown.
- Fallback if the plugin proves unsuitable at implementation time: embed a
  standalone Scalar or Redoc reference page that loads the same spec. Decision
  recorded in the plan, not pre-committed here.

## Part C — CI / Pages deploy

- New `.github/workflows/docs.yml`:
  - **PR build check** — on `pull_request` touching `docs-site/**`,
    `nx-cache-server.openapi.json`, or the workflow itself: `bun install` +
    `bun run build` (including the `starlight-links-validator` pass). No deploy.
    This is a status check that catches docs breakage.
  - **Deploy** — on `push` to `main` touching the same paths (plus
    `workflow_dispatch`): build, then deploy to Pages via
    `actions/configure-pages` → `actions/upload-pages-artifact` →
    `actions/deploy-pages`. Job permissions: `pages: write`, `id-token: write`.
    `concurrency` group for Pages with `cancel-in-progress: true`.
- **Enable Pages** with GitHub Actions as the source — `POST
/repos/{owner}/{repo}/pages` (`build_type: "workflow"`), or rely on the first
  `configure-pages` run if the API call is scope-blocked.
- URL: `https://thilak-rao.github.io/nx-cache-server-bun/`. Astro config sets
  `site: 'https://thilak-rao.github.io'` and `base: '/nx-cache-server-bun/'` so
  asset paths resolve under the project subpath.

## Part D — README changes

- Trim the README to: project summary, key features, a concise quickstart, and a
  prominent link to the docs site. Move the deep reference (full env-var table,
  storage internals, security model, architecture) to the site.
- Add badges: CI status, Pages/docs, license, GHCR image, and OpenSSF Scorecard.
- Keep `CLAUDE.md`/`AGENTS.md` references accurate after the README is trimmed
  (`CLAUDE.md` is a symlink to `AGENTS.md`, so one edit covers both). Update
  `AGENTS.md` line 3 once the docs site is canonical: it currently points at the
  README for "the full API surface, environment variables, and deployment".

### Anti-drift governance (AGENTS.md)

`AGENTS.md` carries a `## Docs stay in sync` rule (added ahead of this plan) so
docs are updated in the same commit as the code that changes them:

- HTTP API → `nx-cache-server.openapi.json` (single source of truth; the site's
  API Reference is generated from it).
- Env vars / config → the site's Configuration page (canonical); README links to
  it.
- Behavior / storage / security / architecture → the matching site guide.

The plan must reconcile `AGENTS.md` line 3 with this rule once the site exists.

## Verification

**Hardening**

- `gh api repos/{owner}/{repo}/rulesets` lists the `main` ruleset with the four
  rules; the required checks reference `test` and CodeQL.
- `gh api repos/{owner}/{repo}` shows `has_issues=true`,
  `allow_merge_commit=false`, `delete_branch_on_merge=true`, and the
  secret-scanning validity-check status enabled.
- Dependabot alerts + security updates and Private Vulnerability Reporting read
  as enabled.
- The Security tab shows CodeQL and Scorecard results after their first runs.
- Topics and homepage URL are set.

**Docs site**

- `cd docs-site && bun install && bun run build` succeeds locally and in CI; the
  links-validator passes.
- The deployed `github.io` URL returns 200; the API Reference renders all three
  endpoints; the sidebar shows every guide page.

**CI gate**

- A PR touching `docs-site/**` runs the build check; merging to `main` runs the
  deploy job and the live site updates.

## Risks / notes

- **Token scopes:** applying rulesets and security settings may require a
  one-time `gh auth refresh` for admin scopes. Each scope-blocked step degrades
  to a copy-paste checklist entry rather than failing the task.
- **Pages base path:** the `base` must match the repo name exactly, or assets
  404 on the deployed site. Covered by the post-deploy 200 + render check.
- **Bun + Astro:** building with Bun is supported; if a specific Starlight
  plugin misbehaves under Bun at implementation time, that is surfaced in the
  plan, not worked around silently.

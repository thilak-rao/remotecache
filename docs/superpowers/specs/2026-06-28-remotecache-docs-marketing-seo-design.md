# Design: remotecache.dev — marketing, narrative & SEO overhaul of the docs site

Date: 2026-06-28

## Goal

Turn the `nx-cache-server-bun` documentation site from accurate-but-dry
reference pages into a positioned, discoverable product site that:

1. Tells a credible origin story — a maintainer shipping free software, tired of
   Nx's caching being jerked around (free → paid → free → deprecated) and the
   per-seat cost of the paid escape hatch, who found
   [`jase88/nx-cache-server-bun`](https://github.com/jase88/nx-cache-server-bun)
   and hardened it.
2. Ranks for people actively looking for a self-hosted Nx remote cache —
   especially the wave whose official `@nx/*` self-hosted plugins were just
   deprecated over a cache-poisoning CVE.
3. Reads like a veteran engineer / developer-relations writer wrote it: concrete,
   honest about tradeoffs, zero hype.

This is a **content, positioning, and SEO** change. It does **not** change the
server's behaviour, HTTP API, or public surface.

## Background / context

Source material that drives the narrative (all public):

- Emily Xiong, *"Exploring of Nx Self-Hosted Cache: From Free to Paid to Free to
  Deprecated"* (Medium, Nov 2025) — the timeline and the CVE explainer.
- Jeff Cross (@jeffbcross) deprecation announcement (May 21, 2026): the four
  packages `@nx/s3-cache`, `@nx/gcs-cache`, `@nx/azure-cache`,
  `@nx/shared-fs-cache` deprecated, citing **CVE-2025-36852 (CREEP)** cache
  poisoning. Nx Cloud (paid) is the recommended path.
- The CREEP flaw is **architectural**: the plugins use a single shared
  credential that both reads and writes the whole cache; artifacts aren't bound
  to a branch/trust boundary. A malicious fork PR can build a poisoned artifact,
  upload it first under a key a later trusted `main` build will hash to, and that
  trusted build gets a cache hit on the poisoned artifact → arbitrary code
  execution.

### Why this server is a credible answer (grounded in the code)

Verified in this repo, not assumed:

- `src/main.ts:57-63` resolves a request's permission: admin token → `full`,
  otherwise the stored token's `readonly` | `full`, else `null`.
- `src/cache/write-cache.ts:41-45`: only `full` may `PUT`; `readonly` → `403`.
- Writes are append-only: an existing hash → `409`, never an overwrite
  (`src/cache/write-cache.ts:51-58`).

So the `readonly`/`full` split is the **primitive that lets you enforce the
trust boundary** CREEP exploits: give untrusted contexts (fork PRs, untrusted
CI) `readonly` tokens — they physically cannot write, so they cannot poison the
cache — and reserve `full` tokens for trusted main/deploy pipelines.

## Locked decisions (from brainstorming)

- **Narrative spine:** *"Own your Nx remote cache."* Security + freedom woven,
  anchored by the origin story. Hook: Nx caching went free → paid ($250/seat) →
  free → deprecated in ~18 months; the official plugins are now deprecated over a
  cache-poisoning CVE; Nx Cloud is the paid escape hatch; this is the free,
  MIT-licensed third option you run yourself.
- **Scope:** docs site + README + four net-new SEO pages.
- **Story home:** homepage hook/teaser + a dedicated `/why` narrative page.
- **Domain:** `remotecache.dev` is canonical/primary. `remotecache.sh`
  301-redirects to it (Cloudflare redirect rule; GitHub Pages serves one custom
  domain per repo). Both are already registered.
- **`vs Nx Cloud` tone:** scrupulously fair — name when Nx Cloud is the right
  choice. Ranks better and this audience smells a hit-piece instantly.
- **GitHub/DNS/Cloudflare/OG-image steps:** authored as a precise checklist in
  this spec; everything in-repo (config, CNAME, content) is done by the
  implementer.

## Honesty guardrails (non-negotiable)

Overclaiming destroys credibility with this exact audience. Every page obeys:

- Frame the token split as *"lets you architect around the cache-poisoning
  class"* — **never** "immune to / fixes CVE-2025-36852."
- The security page carries an explicit **Honest limits** callout:
  - Append-only is **first-writer-wins**: a `full` token handed to an untrusted
    context re-introduces the poisoning risk.
  - This is **not** Nx Cloud's cryptographic artifact-integrity verification. The
    server gives you the lever; correct token scoping is the operator's job.
- **Credit `jase88`** on `/why` and in the README; preserve MIT attribution. The
  "what this fork adds" list is the real git history only: SHA-256 token hashing
  at rest + plaintext-DB migration, upload size cap (`413`), constant-time admin
  compare, path-traversal/hash hardening, non-root pinned container, GHCR
  publishing, full repo hardening (CodeQL/Scorecard/Dependabot/rulesets), and the
  docs site.
- **No invented benchmarks.** Any cost-of-no-cache framing (e.g. "3-min → 30-min
  build") is attributed to the Medium piece, not claimed as our measurement.
- The `vs Nx Cloud` comparison states Nx Cloud's genuine strengths (managed,
  zero-trust artifact verification, distributed task execution / agents).

## Information architecture

### Rewrites (voice + SEO intro + correct metadata; keep technically accurate)

- **Home** (`index.mdx`, splash) — new hero (`Own your Nx remote cache`),
  2–3 sentence story teaser linking `/why`, reframed value cards (free & MIT •
  trust-boundary tokens • filesystem/S3 • one small Bun container), primary CTAs
  (Quickstart, GitHub). A short "what changed with Nx caching" strip.
- **Quickstart** — same five-minute flow, tightened voice.
- **Configuration** — canonical env-var table (unchanged content, intro added).
- **Storage strategies** — filesystem / S3 / custom strategy.
- **Token & admin API** — permission model + admin endpoints.
- **Security model** — expand with the **trust-boundary recipe** (readonly for
  untrusted writers, full for trusted pipelines) and the Honest limits callout.
- **Deployment** — Docker/GHCR, non-root, persistence.
- **Architecture** (contributing) — light voice pass.
- **README** — trim to summary + features + quickstart + prominent docs link;
  add the one-paragraph origin + `jase88` credit; badges intact.

### New SEO pages

- **`/why` — Why this exists.** Origin story → the free/paid/free/deprecated
  timeline → cost & lock-in → credit to `jase88` + what this fork adds →
  CVE-2025-36852 in brief → "your options" (accept-risk-with-mitigations / Nx
  Cloud / self-host this) → CTAs. Internal-links the whole cluster.
- **`/guides/migrate-from-nx-s3-cache` — Migrate off the deprecated `@nx/*`
  plugins.** What the deprecation means, what keeps working vs. what won't, and
  the concrete swap: point `NX_SELF_HOSTED_REMOTE_CACHE_SERVER` /
  `NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN` here, with an env-var mapping from
  the old `@nx/s3-cache` config to this server's `S3_*` storage strategy.
- **`/compare/nx-cloud` — vs Nx Cloud.** Fair comparison table; when Nx Cloud
  wins (managed, zero-trust verification, DTE/agents) vs. when self-hosting wins
  (cost, data residency, no per-seat, full control).
- **`/security/cve-2025-36852` — Is your self-hosted Nx cache safe?** The CREEP
  cache-poisoning explainer, the trust-boundary mitigation recipe, the Honest
  limits. Marked up as `FAQPage`.

### Sidebar / nav structure (Starlight)

```
Getting started → Quickstart
Why remotecache → Why this exists · Is your Nx cache safe? (CVE-2025-36852)
Guides → Configuration · Storage strategies · Token & admin API ·
         Security model · Migrate from @nx/s3-cache · Deployment
Compare → vs Nx Cloud
Contributing → Architecture
API Reference (auto-generated, unchanged)
```

## SEO / technical layer

### Domain migration (canonical = `remotecache.dev`)

- `docs-site/astro.config.mjs`: `site: 'https://remotecache.dev'`, **remove**
  `base: '/nx-cache-server-bun'`.
- Add `docs-site/public/CNAME` containing `remotecache.dev`.
- Replace every hard-coded `/nx-cache-server-bun/...` internal link (in
  `index.mdx`, the guides, and `starlightLinksValidator`/`starlightOpenAPI`
  `base` config) with root-relative `/...`. Audit with a grep gate before build.
- `starlight-openapi` stays `base: 'api'`; links-validator `exclude` updates to
  `/api/**`.

### Per-page metadata

- `<title>` 50–60 chars, meta `description` 110–160 chars, `<link rel=canonical>`
  per page (Starlight emits canonical from `site`; verify after base removal).
- Open Graph + Twitter card tags via Starlight per-page `head` frontmatter (or a
  small shared head component). One default social share image
  (`docs-site/public/og.png`, optimized via `imageoptim`).

### Structured data (JSON-LD)

- Home: `SoftwareApplication` / `SoftwareSourceCode`.
- `/why`, `/compare/nx-cloud`, `/guides/migrate-from-nx-s3-cache`: `TechArticle`.
- `/security/cve-2025-36852`: `FAQPage` (rich-result eligible).
- Sitewide: `BreadcrumbList`.

### Crawl & linking

- Sitemap (Astro/Starlight built-in) + `robots.txt` pointing at it.
- Deliberate internal-link graph: Home → `/why` → cluster pages → Quickstart;
  every cluster page links back to Quickstart and to one sibling.

### Keyword map

- **Primary:** "self-hosted Nx remote cache", "Nx remote cache server".
- **Secondary:** "free Nx Cloud alternative", "@nx/s3-cache deprecated
  alternative", "self-host Nx cache Docker", "Nx remote cache without Nx Cloud".
- **Long-tail (cluster-owned):** "CVE-2025-36852", "Nx cache poisoning", "CREEP
  vulnerability", "Nx Powerpack alternative", "migrate off @nx/s3-cache".
- Front-load primary keywords in titles, H1s, and opening sentences.

## Voice & attribution

- Veteran-engineer / DRE register: concrete commands, honest tradeoffs, short
  sentences. Banned hype vocabulary ("unlock", "seamless", "effortless",
  "supercharge", "game-changing"). No formulaic "Key Takeaways"/"TL;DR" blocks
  unless a page genuinely reads better with a short answer capsule.
- Every human-facing page (site + README) runs through the **humanizer** skill
  before commit.
- `jase88` credited as the upstream this is built on; MIT license preserved.

## Out of scope

- Any change to the server's behaviour, HTTP API, env vars, or storage logic.
- Adding a blog section / versioned docs.
- Renaming the GitHub repo or npm/package identity.
- Buying/registering domains (already done) and the actual DNS/Cloudflare/Pages
  console actions (checklist below; operator-executed).

## Operator checklist (out-of-repo; implementer documents, you execute)

1. **DNS — `remotecache.dev`:** add the GitHub Pages `A`/`AAAA` (apex) or
   `CNAME` (`www`) records; if fronted by Cloudflare, set DNS-only (grey cloud)
   for the Pages verification, then proxy as desired.
2. **GitHub Pages custom domain:** set `remotecache.dev` in repo Pages settings
   (or via `gh api`); enable "Enforce HTTPS". The committed `CNAME` file backs
   this.
3. **`remotecache.sh` → `remotecache.dev` 301:** Cloudflare redirect rule
   (preserve path + query), since Pages serves a single custom domain.
4. **OG image:** produce `docs-site/public/og.png` (1200×630), run `imageoptim`.
5. **Search Console:** add `https://remotecache.dev`, submit the sitemap, request
   indexing for Home + `/why` + the cluster pages.
6. **Repo homepage + topics:** point repo homepage at `https://remotecache.dev`;
   confirm topics (`nx`, `remote-cache`, `bun`, `self-hosted`, `nx-cache`).

## Verification (before "done")

- `cd docs-site && bun install && bun run build` is green; `starlight-links-validator` passes.
- Grep gate: no remaining `/nx-cache-server-bun/` link references in
  `docs-site/src` after the base-path removal.
- `playwright-cli` render/screenshot of Home and `/why`; no console errors.
- JSON-LD validates (schema.org / Rich Results structure).
- Lighthouse SEO audit on the built Home + one cluster page (target ≥ 95 SEO).
- OG/share image present and optimized.

## Risks / notes

- **Base-path removal is the riskiest mechanical step:** miss one
  `/nx-cache-server-bun/...` link and it 404s on the custom domain. The grep gate
  + links-validator + post-deploy 200 check cover it.
- **Canonical correctness:** after dropping `base`, confirm Starlight emits
  `https://remotecache.dev/...` canonicals (not the old github.io path).
- **Honest-claims review:** the security and comparison pages get an explicit
  pass against the Honesty guardrails before commit — the single highest-risk
  area for credibility.

# remotecache.dev Docs Marketing & SEO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the `nx-cache-server-bun` Starlight docs site into a positioned,
discoverable product site on the custom domain `remotecache.dev`, with an origin
narrative, four SEO cluster pages, and full search metadata — without changing
any server behaviour.

**Architecture:** Astro Starlight site in `docs-site/`. Migrate off the
`/nx-cache-server-bun` GitHub-Pages base path onto the apex domain
`remotecache.dev`, add SEO metadata (Open Graph, JSON-LD, sitemap, robots),
rewrite existing pages for voice, and add a `/why` + three comparison/security
cluster pages. Content is drafted at execution time against the committed source
material and run through the humanizer skill; this plan fixes structure, exact
frontmatter, exact JSON-LD, internal links, and verification gates.

**Tech Stack:** Astro 7, `@astrojs/starlight` ^0.41, `starlight-openapi`,
`starlight-links-validator`, Bun, `sharp` (already a `docs-site` dependency).

## Global Constraints

- **Runtime:** all commands use **Bun** (`bun install`, `bun run build`). Never npm/pnpm/yarn.
- **Canonical domain:** `https://remotecache.dev` (apex). `remotecache.sh` 301s to it (operator/Cloudflare, out of repo).
- **No base path:** after Task 1 there is **no** `/nx-cache-server-bun/` prefix anywhere in `docs-site/src`. All internal links are root-relative (`/guides/...`).
- **Honesty guardrails (verbatim from spec — apply to every content task):**
  - Frame the token split as *"lets you architect around the cache-poisoning class"* — **never** "fixes/immune to CVE-2025-36852".
  - Security page carries an explicit **Honest limits** callout: append-only is **first-writer-wins**; a `full` token in an untrusted context reintroduces the risk; this is **not** Nx Cloud's cryptographic artifact verification.
  - **Credit `jase88`** on `/why` and in README; preserve MIT. "What this fork adds" = the real git history only (token hashing at rest + plaintext-DB migration, upload cap/413, constant-time admin compare, path-traversal/hash hardening, non-root pinned container, GHCR publishing, repo hardening, docs site).
  - **No invented benchmarks.** The "~3-min → ~30-min" framing is attributed to the Medium piece, not our measurement.
  - `vs Nx Cloud` names Nx Cloud's genuine strengths (managed, zero-trust verification, DTE/agents).
- **Source of truth for facts:** `docs/superpowers/specs/2026-06-28-remotecache-source-material.md`. Cite from it; invent nothing beyond it.
- **Voice:** veteran-engineer / DRE. Banned words: "unlock", "seamless", "effortless", "supercharge", "game-changing". No formulaic "Key Takeaways"/"TL;DR" blocks.
- **Per-page metadata:** `<title>` 50–60 chars, meta `description` 110–160 chars (exact strings provided per task).
- **Commits:** Conventional Commits (`type(scope): subject`).

## File structure

Config / infra (modify or create):
- `docs-site/astro.config.mjs` — `site`/`base`, links-validator `exclude`, global `head` (default OG image), sidebar restructure. *(Tasks 1, 2, and each new-page task touch the sidebar.)*
- `docs-site/public/CNAME` — **create** (`remotecache.dev`).
- `docs-site/public/robots.txt` — **create**.
- `docs-site/public/og.png` — **create** (1200×630 placeholder via sharp; operator replaces).
- `docs-site/scripts/make-og-placeholder.mjs` — **create** (one-off generator).

Content rewrites:
- `docs-site/src/content/docs/index.mdx`
- `docs-site/src/content/docs/getting-started/quickstart.md`
- `docs-site/src/content/docs/guides/{configuration,storage-strategies,tokens,security,deployment}.md`
- `docs-site/src/content/docs/contributing/architecture.md`
- `README.md`

New pages:
- `docs-site/src/content/docs/why.md` → `/why`
- `docs-site/src/content/docs/security/cve-2025-36852.md` → `/security/cve-2025-36852`
- `docs-site/src/content/docs/compare/nx-cloud.md` → `/compare/nx-cloud`
- `docs-site/src/content/docs/guides/migrate-from-nx-s3-cache.md` → `/guides/migrate-from-nx-s3-cache`

**Verification vocabulary (docs project — these replace unit tests):**
- *Build gate:* `cd docs-site && bun run build` exits 0 and `starlight-links-validator` reports no broken links.
- *Grep gate:* a `grep` returns no matches (e.g. no stale base path).
- *Render gate:* `bunx playwright-cli` screenshot of the built page, no console errors.
- *Schema gate:* JSON-LD parses and validates (Google Rich Results / schema.org).

---

### Task 1: Domain + base-path migration + crawl files

**Files:**
- Modify: `docs-site/astro.config.mjs`
- Create: `docs-site/public/CNAME`
- Create: `docs-site/public/robots.txt`
- Modify: every `docs-site/src/content/docs/**/*.{md,mdx}` link that contains `/nx-cache-server-bun/`

**Interfaces:**
- Produces: root-relative internal-link convention (`/guides/...`, `/api/...`) every later task uses; `site = https://remotecache.dev`.

- [ ] **Step 1: Establish the green baseline build**

Run: `cd docs-site && bun install && bun run build`
Expected: exits 0; links-validator passes (current state, base path present).

- [ ] **Step 2: Grep the current base-path usage (the change surface)**

Run: `grep -rn "/nx-cache-server-bun/" docs-site/src docs-site/astro.config.mjs`
Expected: lists the hard-coded links in `index.mdx`, the guides, and the config. Note them.

- [ ] **Step 3: Update `astro.config.mjs` — site, base, links-validator exclude**

In `docs-site/astro.config.mjs`: set `site: 'https://remotecache.dev'`, **remove** the `base: '/nx-cache-server-bun'` line, and change the links-validator `exclude` from `['/nx-cache-server-bun/api/**']` to `['/api/**']`. Leave `starlightOpenAPI` `base: 'api'` unchanged.

```js
export default defineConfig({
  site: 'https://remotecache.dev',
  integrations: [
    starlight({
      title: 'nx-cache-server-bun',
      // ...social unchanged...
      plugins: [
        starlightLinksValidator({ exclude: ['/api/**'] }),
        starlightOpenAPI([
          { base: 'api', schema: '../nx-cache-server.openapi.json', sidebar: { label: 'API Reference' } },
        ]),
      ],
      // sidebar unchanged in this task
    }),
  ],
});
```

- [ ] **Step 4: Rewrite every internal link to root-relative**

For each file from Step 2, replace `/nx-cache-server-bun/` with `/`. Example in `index.mdx`: `link: /nx-cache-server-bun/getting-started/quickstart/` → `link: /getting-started/quickstart/`. Do the same across all guides (e.g. `/nx-cache-server-bun/guides/configuration/` → `/guides/configuration/`).

- [ ] **Step 5: Create `docs-site/public/CNAME`**

```
remotecache.dev
```

- [ ] **Step 6: Create `docs-site/public/robots.txt`**

```
User-agent: *
Allow: /

Sitemap: https://remotecache.dev/sitemap-index.xml
```

- [ ] **Step 7: Grep gate — base path is gone**

Run: `grep -rn "/nx-cache-server-bun/" docs-site/src docs-site/astro.config.mjs`
Expected: **no matches.** (The `social` GitHub URL `https://github.com/thilak-rao/nx-cache-server-bun` is a full URL without a trailing slash and must remain — confirm the grep pattern's trailing slash excludes it.)

- [ ] **Step 8: Build gate**

Run: `cd docs-site && bun run build`
Expected: exits 0; links-validator passes. Confirm `dist/CNAME`, `dist/robots.txt`, and `dist/sitemap-index.xml` exist.

- [ ] **Step 9: Canonical check**

Run: `grep -r "rel=\"canonical\"" docs-site/dist/index.html`
Expected: canonical href starts with `https://remotecache.dev/` (no `github.io`, no base path).

- [ ] **Step 10: Commit**

```bash
git add docs-site/astro.config.mjs docs-site/public/CNAME docs-site/public/robots.txt docs-site/src
git commit -m "build(docs): migrate docs site to remotecache.dev apex domain"
```

---

### Task 2: Shared SEO metadata — default OG image + social tags

**Files:**
- Create: `docs-site/scripts/make-og-placeholder.mjs`
- Create: `docs-site/public/og.png`
- Modify: `docs-site/astro.config.mjs` (global `head`)

**Interfaces:**
- Consumes: `site` from Task 1.
- Produces: a sitewide default `og:image`/`twitter:image` at `/og.png`; per-page tasks may override via frontmatter `head`.

- [ ] **Step 1: Write the OG placeholder generator**

Create `docs-site/scripts/make-og-placeholder.mjs` (uses `sharp`, already a dependency):

```js
import sharp from 'sharp';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <rect width="1200" height="630" fill="#0d1117"/>
  <text x="80" y="300" font-family="sans-serif" font-size="72" font-weight="700" fill="#ffffff">Own your Nx remote cache.</text>
  <text x="80" y="380" font-family="sans-serif" font-size="36" fill="#9ca3af">Free, self-hosted, MIT-licensed. remotecache.dev</text>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile(new URL('../public/og.png', import.meta.url).pathname);
console.log('wrote public/og.png');
```

- [ ] **Step 2: Generate the placeholder**

Run: `cd docs-site && bun run scripts/make-og-placeholder.mjs`
Expected: prints `wrote public/og.png`; `docs-site/public/og.png` exists at 1200×630. (Operator replaces with the designed image + `imageoptim` per the spec checklist.)

- [ ] **Step 3: Add global default social tags in `astro.config.mjs`**

Add a `head` array to the `starlight({ ... })` options:

```js
head: [
  { tag: 'meta', attrs: { property: 'og:image', content: 'https://remotecache.dev/og.png' } },
  { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
  { tag: 'meta', attrs: { name: 'twitter:image', content: 'https://remotecache.dev/og.png' } },
],
```

- [ ] **Step 4: Build gate + tag check**

Run: `cd docs-site && bun run build && grep -r "og:image" docs-site/dist/index.html`
Expected: build exits 0; `og:image` meta with `https://remotecache.dev/og.png` present in the home page HTML.

- [ ] **Step 5: Commit**

```bash
git add docs-site/scripts/make-og-placeholder.mjs docs-site/public/og.png docs-site/astro.config.mjs
git commit -m "feat(docs): add default Open Graph and Twitter social metadata"
```

---

### Task 3: Home page rewrite + SoftwareApplication JSON-LD

**Files:**
- Modify: `docs-site/src/content/docs/index.mdx`

**Interfaces:**
- Consumes: root-relative links (Task 1), default OG (Task 2).
- Produces: the homepage hook + links into `/why` and the cluster. **Execute after Task 4** (its scaffold makes every linked route exist), per the execution-order note.

- [ ] **Step 1: Rewrite `index.mdx`** (splash template)

Keep `template: splash`. Replace frontmatter + body:
- `title: remotecache` ; add a `head` title override + description:

```yaml
---
title: remotecache
description: Own your Nx remote cache. A free, self-hosted, MIT-licensed Nx remote cache server on Bun — filesystem or S3 storage, token auth, one small container.
template: splash
head:
  - tag: title
    content: "Self-Hosted Nx Remote Cache — Free & MIT-Licensed | remotecache"
  - tag: script
    attrs: { type: application/ld+json }
    content: |
      {"@context":"https://schema.org","@type":"SoftwareApplication","name":"remotecache (nx-cache-server-bun)","applicationCategory":"DeveloperApplication","operatingSystem":"Docker, Linux, macOS","offers":{"@type":"Offer","price":"0","priceCurrency":"USD"},"license":"https://opensource.org/licenses/MIT","codeRepository":"https://github.com/thilak-rao/nx-cache-server-bun","url":"https://remotecache.dev/","description":"A free, self-hosted, MIT-licensed Nx remote cache server on the Bun runtime."}
hero:
  tagline: "Own your Nx remote cache. Free, MIT-licensed, self-hosted — the third option when the official @nx/* plugins are deprecated and Nx Cloud is the paid escape hatch."
  actions:
    - text: Quickstart
      link: /getting-started/quickstart/
      icon: right-arrow
    - text: Why this exists
      link: /why/
      icon: open-book
      variant: minimal
    - text: View on GitHub
      link: https://github.com/thilak-rao/nx-cache-server-bun
      icon: external
      variant: minimal
---
```

- Body: keep the `<CardGrid>` but reframe the four cards to the value props (exact card content drafted in voice; each ≤ 2 sentences):
  1. **Free & MIT** — "No per-seat fees, no Commercial license. Run it yourself." (contrast the deprecated plugins' Commercial license — see source material).
  2. **Trust-boundary tokens** — "`readonly` for untrusted CI, `full` for trusted pipelines. Untrusted PRs can't write, so they can't poison the cache." (honest framing — links to `/security/cve-2025-36852/`).
  3. **Filesystem or S3** — "Local disk by default, or any S3-compatible bucket (AWS S3, MinIO)."
  4. **One small Bun container** — "`Bun.serve` + `bun:sqlite`, shipped as a non-root image on GHCR."
- Below the grid, add a 2–3 sentence **story teaser** ending with a link to `/why/`.

- [ ] **Step 2: Build + links gate**

Run: `cd docs-site && bun run build`
Expected: exits 0; links-validator passes. (Run **after** Task 4 — its scaffold makes `/why/` and the cluster routes exist, so the home page's links resolve. See the execution-order note.)

- [ ] **Step 3: Schema gate**

Run: `grep -A0 'application/ld+json' docs-site/dist/index.html` then copy the JSON into the [Rich Results test](https://search.google.com/test/rich-results) or a `bun -e` `JSON.parse`.
Expected: JSON-LD parses; `@type` is `SoftwareApplication`.

- [ ] **Step 4: Render gate**

Run: `bunx playwright-cli open "file://$(pwd)/docs-site/dist/index.html"` → `bunx playwright-cli screenshot` → `bunx playwright-cli close`
Expected: hero shows "Own your Nx remote cache"; three action buttons; no console errors.

- [ ] **Step 5: Commit**

```bash
git add docs-site/src/content/docs/index.mdx
git commit -m "feat(docs): rewrite home page with positioning and SoftwareApplication schema"
```

---

### Task 4: `/why` narrative page + TechArticle JSON-LD

**Files:**
- Create: `docs-site/src/content/docs/why.md`
- Modify: `docs-site/astro.config.mjs` (sidebar)

**Interfaces:**
- Consumes: source material (`...-source-material.md`); links to `/security/cve-2025-36852/`, `/compare/nx-cloud/`, `/guides/migrate-from-nx-s3-cache/`, `/getting-started/quickstart/`.

- [ ] **Step 1: Create `why.md`** with this exact frontmatter:

```yaml
---
title: "Why remotecache exists"
description: "Nx self-hosted caching went free to paid to free to deprecated. Here's why I run a free, MIT-licensed Nx remote cache I actually own — and what this fork adds."
head:
  - tag: title
    content: "Why remotecache exists: the Nx cache deprecation story"
  - tag: script
    attrs: { type: application/ld+json }
    content: |
      {"@context":"https://schema.org","@type":"TechArticle","headline":"Why remotecache exists: the Nx self-hosted cache deprecation story","description":"Nx self-hosted caching went free to paid to free to deprecated. A free, MIT-licensed, self-hosted Nx remote cache built on jase88/nx-cache-server-bun.","url":"https://remotecache.dev/why/","author":{"@type":"Person","name":"Thilak Rao"},"mainEntityOfPage":"https://remotecache.dev/why/"}
---
```

- [ ] **Step 2: Draft the body** (in voice, humanized at Task 11) with these exact H2 sections and required facts/links:
  1. **The short version** — one paragraph: free → paid ($250/seat) → free → deprecated; this is the free, self-hosted third option.
  2. **What happened to Nx caching** — the four dated milestones from source material §timeline (before v20 / v20 Sep 2024 / v20.8 Apr 2025 / May 21 2026). Link "CVE-2025-36852" → `/security/cve-2025-36852/`.
  3. **The cost and the lock-in** — the per-seat Powerpack pricing and the MIT-vs-Commercial license contrast (cite source material). No invented numbers.
  4. **Standing on `jase88`'s shoulders** — credit `https://github.com/jase88/nx-cache-server-bun`; then the "what this fork adds" list (the verbatim git-history list from Global Constraints).
  5. **Your options now** — A/B/C/D from source material; one line each; B links `/compare/nx-cloud/`; D links `/security/cve-2025-36852/` and `/getting-started/quickstart/`.
  6. **Get started** — link `/getting-started/quickstart/`.

- [ ] **Step 3: Scaffold the three sibling cluster pages as stubs** (so every cross-link resolves and `links-validator` stays green from here on). Tasks 6/7/8 overwrite these with full content. Create each with only frontmatter + a heading:

```md
---
title: "Is your self-hosted Nx cache safe? CVE-2025-36852"
description: "CVE-2025-36852 (CREEP) cache poisoning deprecated Nx's self-hosted plugins. How a readonly/full token split lets you enforce the trust boundaries it exploits."
---

# Is your self-hosted Nx cache safe?
```

Create the analogous stubs for `compare/nx-cloud.md` (title "Self-hosted Nx remote cache vs Nx Cloud", description from Task 7) and `guides/migrate-from-nx-s3-cache.md` (title "Migrate off the deprecated @nx/s3-cache plugin", description from Task 8). These descriptions are the exact final ones — Tasks 6/7/8 keep them and add the `head` JSON-LD + body.

- [ ] **Step 4: Register all new sidebar entries at once** in `astro.config.mjs`:

```js
// New top group, placed above the existing 'Guides' group:
{ label: 'Why remotecache', items: [
  { label: 'Why this exists', slug: 'why' },
  { label: 'Is your Nx cache safe?', slug: 'security/cve-2025-36852' },
]},
// New 'Compare' group, after 'Guides':
{ label: 'Compare', items: [{ label: 'vs Nx Cloud', slug: 'compare/nx-cloud' }] },
// Add into the existing 'Guides' items array, after 'Security model':
{ label: 'Migrate from @nx/s3-cache', slug: 'guides/migrate-from-nx-s3-cache' },
```

All four routes now exist (stubs), so every cross-link in this and later tasks resolves.

- [ ] **Step 5: Build + links gate**

Run: `cd docs-site && bun run build`
Expected: exits 0; links-validator passes (all four routes exist as stubs, so `/why`'s forward links resolve).

- [ ] **Step 6: Schema gate** — `bun -e "JSON.parse(require('fs').readFileSync('docs-site/dist/why/index.html','utf8').match(/ld\+json\">([\s\S]*?)<\/script>/)[1])"` → no throw.

- [ ] **Step 7: Commit**

```bash
git add docs-site/src/content/docs/why.md docs-site/src/content/docs/security docs-site/src/content/docs/compare docs-site/src/content/docs/guides/migrate-from-nx-s3-cache.md docs-site/astro.config.mjs
git commit -m "feat(docs): add Why page and scaffold the SEO cluster"
```

---

### Task 5: Security model rewrite — trust-boundary recipe + honest limits

**Files:**
- Modify: `docs-site/src/content/docs/guides/security.md`

- [ ] **Step 1: Add SEO frontmatter** (keep existing accurate sections):

```yaml
---
title: Security model
description: "Token hashing, constant-time admin compare, path-traversal validation, append-only writes, and using readonly/full tokens to enforce CI trust boundaries."
---
```

- [ ] **Step 2: Add a "Trust boundaries: stopping cache poisoning" H2** after the existing "Append-only writes" section, covering:
  - The recipe: issue `readonly` tokens to untrusted contexts (fork PRs, untrusted CI) and `full` tokens only to trusted main/deploy pipelines; `readonly` → `403` on `PUT` (cite `src/cache/write-cache.ts`), so untrusted writers physically cannot write → cannot poison.
  - Link `/security/cve-2025-36852/` for the full explainer.

- [ ] **Step 3: Add an explicit "Honest limits" callout** (Starlight `:::caution`), verbatim intent:
  - Append-only is **first-writer-wins**: a `full` token in an untrusted context reintroduces the poisoning risk.
  - This is **not** Nx Cloud's cryptographic artifact-integrity verification. The server gives you the lever; correct token scoping is on you.

- [ ] **Step 4: Build gate** — `cd docs-site && bun run build` exits 0; links-validator passes.

- [ ] **Step 5: Commit**

```bash
git add docs-site/src/content/docs/guides/security.md
git commit -m "docs: expand security model with trust-boundary recipe and honest limits"
```

---

### Task 6: `/security/cve-2025-36852` explainer + FAQPage JSON-LD

**Files:**
- Modify (overwrite the Task 4 stub): `docs-site/src/content/docs/security/cve-2025-36852.md`

*(Sidebar entry already registered in Task 4 Step 4. Keep the stub's `title`/`description`; add the `head` JSON-LD and body below.)*

- [ ] **Step 1: Overwrite the stub** with this exact frontmatter (FAQPage answers are honest and final — use as written):

```yaml
---
title: "Is your self-hosted Nx cache safe? CVE-2025-36852"
description: "CVE-2025-36852 (CREEP) cache poisoning deprecated Nx's self-hosted plugins. How a readonly/full token split lets you enforce the trust boundaries it exploits."
head:
  - tag: title
    content: "Is your self-hosted Nx cache safe? CVE-2025-36852 (CREEP)"
  - tag: script
    attrs: { type: application/ld+json }
    content: |
      {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[
        {"@type":"Question","name":"What is CVE-2025-36852 (CREEP)?","acceptedAnswer":{"@type":"Answer","text":"A design flaw in Nx's self-hosted remote cache plugins: a single shared credential reads and writes the whole cache and artifacts aren't bound to a trust boundary, so a malicious pull request can poison artifacts that later trusted builds consume."}},
        {"@type":"Question","name":"Does a self-hosted Nx cache fix the cache-poisoning flaw?","acceptedAnswer":{"@type":"Answer","text":"Not by itself. Self-hosting gives you control over who can write to the cache, which lets you architect around the cache-poisoning class — but you have to scope write access to trusted pipelines."}},
        {"@type":"Question","name":"How do readonly and full tokens prevent cache poisoning?","acceptedAnswer":{"@type":"Answer","text":"Issue readonly tokens to untrusted contexts like fork pull requests and full tokens only to trusted main and deploy pipelines. Readonly tokens are rejected on upload, so untrusted workflows cannot write to the cache and cannot poison it."}},
        {"@type":"Question","name":"Is remotecache immune to CVE-2025-36852?","acceptedAnswer":{"@type":"Answer","text":"No. It gives you the primitive to enforce trust boundaries, but append-only storage is first-writer-wins and a full token handed to an untrusted context reintroduces the risk. It is not Nx Cloud's cryptographic artifact verification."}}
      ]}
---
```

- [ ] **Step 2: Draft the body** with H2s mirroring the FAQ (so the visible content matches the JSON-LD — required for FAQPage eligibility):
  - **The flaw, in one diagram's worth of words** — the CREEP mechanics from source material §CVE (shared credential; CI workflow not in the cache key; first-uploader wins; trusted build gets the poisoned hit).
  - **Why this got the official plugins deprecated** — the May 21 2026 deprecation; packages stay on npm but unmaintained.
  - **How to architect around it here** — the `readonly`/`full` recipe; link `/guides/security/`.
  - **Honest limits** — the same first-writer-wins / not-Nx-Cloud caveat.
  - **Your options** — link `/compare/nx-cloud/` and `/guides/migrate-from-nx-s3-cache/`.

- [ ] **Step 3: Build + schema gate** — `cd docs-site && bun run build` exits 0; links-validator passes; FAQPage JSON-LD parses (same `bun -e` JSON.parse pattern as Task 4 Step 6 on `dist/security/cve-2025-36852/index.html`).

- [ ] **Step 4: Commit**

```bash
git add docs-site/src/content/docs/security/cve-2025-36852.md
git commit -m "feat(docs): add CVE-2025-36852 cache-poisoning explainer with FAQ schema"
```

---

### Task 7: `/compare/nx-cloud` comparison page + TechArticle JSON-LD

**Files:**
- Modify (overwrite the Task 4 stub): `docs-site/src/content/docs/compare/nx-cloud.md`

*(Sidebar "Compare" group already registered in Task 4 Step 4.)*

- [ ] **Step 1: Overwrite the stub** with this exact frontmatter:

```yaml
---
title: "Self-hosted Nx remote cache vs Nx Cloud"
description: "Nx Cloud vs a free, self-hosted Nx remote cache: cost, security, control, and data residency — and an honest take on when each one is the right call."
head:
  - tag: title
    content: "Self-Hosted Nx Remote Cache vs Nx Cloud: Honest Comparison"
  - tag: script
    attrs: { type: application/ld+json }
    content: |
      {"@context":"https://schema.org","@type":"TechArticle","headline":"Self-hosted Nx remote cache vs Nx Cloud","description":"An honest comparison of Nx Cloud and a free self-hosted Nx remote cache across cost, security, control, and data residency.","url":"https://remotecache.dev/compare/nx-cloud/","author":{"@type":"Person","name":"Thilak Rao"},"mainEntityOfPage":"https://remotecache.dev/compare/nx-cloud/"}
---
```

- [ ] **Step 2: Draft the body**:
  - A short intro stating the page is deliberately fair.
  - A **comparison table** (cost, hosting model, cache-poisoning defense, distributed task execution / agents, data residency, license, support). Use source-material pricing facts with the "verify against nx.dev/pricing, cite date observed" caveat in prose.
  - **When Nx Cloud is the right call** — managed, zero-trust artifact verification, DTE/agents, teams that want SaaS. (Honesty guardrail.)
  - **When self-hosting this wins** — cost, data residency/air-gapped, full control, no per-seat, MIT.
  - CTA → `/getting-started/quickstart/`; link `/why/`.

- [ ] **Step 3: Build gate** — `cd docs-site && bun run build` exits 0; links-validator passes; TechArticle JSON-LD parses.

- [ ] **Step 4: Commit**

```bash
git add docs-site/src/content/docs/compare/nx-cloud.md
git commit -m "feat(docs): add vs Nx Cloud comparison page"
```

---

### Task 8: `/guides/migrate-from-nx-s3-cache` migration page + TechArticle JSON-LD

**Files:**
- Modify (overwrite the Task 4 stub): `docs-site/src/content/docs/guides/migrate-from-nx-s3-cache.md`

*(Sidebar entry already added to the Guides group in Task 4 Step 4.)*

- [ ] **Step 1: Overwrite the stub** with this exact frontmatter:

```yaml
---
title: "Migrate off the deprecated @nx/s3-cache plugin"
description: "@nx/s3-cache and the other @nx/* self-hosted cache plugins are deprecated. Move to a free, self-hosted Nx remote cache server in a handful of env vars."
head:
  - tag: title
    content: "Migrate off the deprecated @nx/s3-cache plugin | remotecache"
  - tag: script
    attrs: { type: application/ld+json }
    content: |
      {"@context":"https://schema.org","@type":"TechArticle","headline":"Migrate off the deprecated @nx/s3-cache plugin","description":"Move from the deprecated @nx/* self-hosted cache plugins to a free, self-hosted Nx remote cache server.","url":"https://remotecache.dev/guides/migrate-from-nx-s3-cache/","author":{"@type":"Person","name":"Thilak Rao"},"mainEntityOfPage":"https://remotecache.dev/guides/migrate-from-nx-s3-cache/"}
---
```

- [ ] **Step 2: Draft the body**:
  - **What's deprecated and why** — the four `@nx/*` plugins; CVE link → `/security/cve-2025-36852/`; packages stay on npm but unmaintained (source material).
  - **What keeps working vs. what won't** — `useLegacyCache` on v20; legacy engine removed in v21+ (source material §version notes).
  - **The swap** — point Nx at this server via `NX_SELF_HOSTED_REMOTE_CACHE_SERVER` + `NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN` (link `/getting-started/quickstart/` and `/guides/configuration/`).
  - **Reusing your S3 bucket** — map the old `@nx/s3-cache` settings to this server's `S3_*` storage strategy (link `/guides/storage-strategies/`). Show the `STORAGE_STRATEGY=s3` env block.
  - **Lock down trust boundaries while you're here** — link `/guides/security/`.

- [ ] **Step 3: Build gate** — `cd docs-site && bun run build` exits 0; links-validator passes; JSON-LD parses.

- [ ] **Step 4: Commit**

```bash
git add docs-site/src/content/docs/guides/migrate-from-nx-s3-cache.md
git commit -m "feat(docs): add migrate-from-@nx/s3-cache guide"
```

---

### Task 9: Voice + SEO pass on the remaining guides

**Files (modify):**
- `docs-site/src/content/docs/getting-started/quickstart.md`
- `docs-site/src/content/docs/guides/configuration.md`
- `docs-site/src/content/docs/guides/storage-strategies.md`
- `docs-site/src/content/docs/guides/tokens.md`
- `docs-site/src/content/docs/guides/deployment.md`
- `docs-site/src/content/docs/contributing/architecture.md`

- [ ] **Step 1: For each file, tighten the opening to front-load the primary keyword and set a 110–160 char `description`.** Keep all technical content accurate and unchanged. Exact descriptions:
  - quickstart: `"Get a self-hosted Nx remote cache running and wired into Nx in five minutes: start the server, create a token, point Nx at it."`
  - configuration: `"Every environment variable for the self-hosted Nx remote cache server: admin token, port, storage strategy, upload limits, and S3 settings."`
  - storage-strategies: `"Store your self-hosted Nx remote cache on local disk or any S3-compatible bucket (AWS S3, MinIO), or write a custom storage strategy."`
  - tokens: `"Manage access to your Nx remote cache: readonly and full tokens hashed at rest, plus the admin API for creating and revoking them."`
  - deployment: `"Deploy the self-hosted Nx remote cache server as a small non-root container from GHCR, with persistence for the token DB and cache."`
  - architecture: `"How the Bun-based Nx remote cache server is built: thin handlers, pure functions, pluggable storage, and hashed token storage."`

- [ ] **Step 2: Add one contextual internal link per page** into the cluster where natural (e.g. quickstart → `/why/`; deployment → `/guides/security/`). Do not force links.

- [ ] **Step 3: Build gate** — `cd docs-site && bun run build` exits 0; links-validator passes.

- [ ] **Step 4: Commit**

```bash
git add docs-site/src/content/docs/getting-started docs-site/src/content/docs/guides docs-site/src/content/docs/contributing
git commit -m "docs: voice and SEO pass on quickstart, guides, and architecture"
```

---

### Task 10: README rewrite — trim + origin + jase88 credit

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Rewrite README** to: one-line summary, the 18-month free→paid→free→deprecated hook (2–3 sentences) linking `https://remotecache.dev/why/`, key features, the existing quickstart block (update the docs link to `https://remotecache.dev/`), and a **Credits** section crediting `jase88/nx-cache-server-bun` with the "what this fork adds" list. Keep all badges. Keep the Docker quickstart accurate.

- [ ] **Step 2: Grep gate — docs links point at the domain**

Run: `grep -n "thilak-rao.github.io/nx-cache-server-bun" README.md`
Expected: **no matches** (all replaced with `https://remotecache.dev/`).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README with origin story and jase88 credit"
```

---

### Task 11: Final verification — humanizer, Lighthouse, full gate

**Files:** any touched up from review (content only).

- [ ] **Step 1: Humanizer pass** — run the `humanizer` skill over every human-facing page authored/edited (home, `/why`, security, CVE, comparison, migration, the guide intros, README). Apply edits. Re-confirm no banned words (`grep -rniE "unlock|seamless|effortless|supercharge|game-chang" docs-site/src README.md` → none, allowing for legitimate technical uses reviewed by hand).

- [ ] **Step 2: Honesty-guardrail review** — manually re-read the security + CVE + comparison pages against the Global Constraints honesty rules. Confirm: no "fixes/immune to CVE" phrasing; the first-writer-wins limit is present; Nx Cloud strengths named; jase88 credited; no invented benchmarks.

- [ ] **Step 3: Full build + links gate**

Run: `cd docs-site && bun run build`
Expected: exits 0; links-validator passes with zero broken links.

- [ ] **Step 4: Schema sweep** — `JSON.parse` the JSON-LD in `dist/index.html`, `dist/why/index.html`, `dist/security/cve-2025-36852/index.html`, `dist/compare/nx-cloud/index.html`, `dist/guides/migrate-from-nx-s3-cache/index.html`. All parse.

- [ ] **Step 5: Lighthouse SEO audit** — use the `lighthouse` skill (or `bunx lighthouse`) on the built Home and one cluster page (serve `dist/` locally). Target SEO ≥ 95. Fix any flagged meta/crawl issue.

- [ ] **Step 6: Render gate** — `bunx playwright-cli` screenshot of Home and `/why`; no console errors.

- [ ] **Step 7: Commit any fixes**

```bash
git add -A docs-site/src README.md
git commit -m "docs: humanizer pass and final SEO verification fixes"
```

---

## Execution order (link-validation dependency)

`starlight-links-validator` fails the build on any broken internal link, and the
cluster pages cross-link in a cycle (`/why` ↔ CVE ↔ compare ↔ migrate, and home
→ all). **Task 4 resolves this by scaffolding all four new pages as stubs and
registering every sidebar entry up front**, so all routes exist before any
forward link is validated. From then on every build is green.

**Execution order (one swap from numeric):**

> **1 → 2 → 4 → 3 → 5 → 6 → 7 → 8 → 9 → 10 → 11**

Task 4 scaffolds the cluster + sidebar, so it must run **before** Task 3 (home),
which links into the cluster. That single 4-before-3 swap is the only deviation;
everything else runs in numeric order, and every build gate is green because the
stubs exist by the end of Task 4.

## Spec coverage check

- Domain migration / canonical / base-path removal → Task 1. ✓
- OG/Twitter/social image → Task 2. ✓
- Structured data (SoftwareApplication / TechArticle / FAQPage) → Tasks 3,4,6,7,8. ✓ (BreadcrumbList is emitted by Starlight's built-in breadcrumb nav; no extra task.)
- Sitemap + robots → Task 1 (sitemap auto-generated; robots.txt created). ✓
- Home rewrite → Task 3. ✓ `/why` → Task 4. ✓ Security expand → Task 5. ✓ CVE page → Task 6. ✓ vs Nx Cloud → Task 7. ✓ Migration → Task 8. ✓ Guide rewrites → Task 9. ✓ README → Task 10. ✓
- Voice + humanizer + honesty guardrails + Lighthouse → Task 11 (and per-task). ✓
- Keyword map → realized in the exact titles/descriptions across Tasks 3–10. ✓
- Operator checklist (DNS, Pages domain, .sh→.dev 301, OG image swap, Search Console) → spec §"Operator checklist"; surfaced again at handoff. Not a code task. ✓

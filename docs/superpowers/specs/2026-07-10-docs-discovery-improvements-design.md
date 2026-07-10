# Docs discovery improvements — design

**Date:** 2026-07-10
**Status:** Approved (brainstorm complete)
**Scope:** `docs-site/` plus one README line. Repo changes only.

## Context and evidence

The docs site (Astro + Starlight, ~15 pages) is four days old. Umami data for its whole life (2026-07-06 → 2026-07-10): 103 pageviews, 54 unique sessions, 75% bounce rate. Search engines sent 5 visits total. remotecache.dev is not verified in Google Search Console, so indexing status is invisible and the sitemap has never been submitted.

Conclusion: content quality is not the bottleneck; discovery is. This cycle makes the site findable and quotable for both search engines and AI agents, and adds a small number of pages chosen for search intent.

Top current pages: `/` (50 views), `/why/` (10), `/security/cve-2025-36852/` (6), `/deploy/docker/` (5), `/getting-started/quickstart/` (4). The CVE page is already an organic entry point with zero promotion.

## Goals

1. AI agents can discover and read the docs cheaply (index file, full dump, per-page markdown).
2. Search snippets and social previews are competitive for the queries this project can win.
3. Two to three new pages capture high-intent searches (CI setup, error messages, monitoring).

Non-goal: anything outside this repo. GSC verification, sitemap submission, launch posts, GitHub repo settings (topics, social preview), a blog/changelog, benchmarks, more compare pages, and an MCP server are all out of scope. They form the external playbook, tracked separately.

## Workstream 1 — Agent plumbing

### llms.txt generation

Add `starlight-llms-txt@0.11.0` (peer deps verified against Starlight 0.41 / Astro 7). Build emits:

- `/llms.txt`: annotated page index
- `/llms-full.txt`: all docs inlined
- `/llms-small.txt`: abridged variant

Exclude the generated API Reference pages (`/api/**`): they would bloat the dump with prose redundant to `/openapi.json`, which is already published and linked from SKILL.md and auth.md.

### Per-page raw markdown

A custom Astro endpoint (shape: `src/pages/[...slug].md.ts` over the `docs` content collection) serves each page's raw markdown at `<page-url>.md`. Lets an agent fetch one page (e.g. the configuration reference) without pulling llms-full.txt. Generated API pages are excluded, same reason as above.

### SKILL.md refresh

Update `docs-site/public/.well-known/agent-skills/remotecache/SKILL.md` to point at the new surfaces (`llms.txt`, per-page `.md`) as the preferred way to read docs. The digest in `index.json` regenerates via the existing `prepare-agent-assets.mjs`. Edit goes through prompt-wizard (it is a skill description).

### Deliberately skipped

`robots.txt` AI-crawler stanzas. The file is already `Allow: /` for every user agent, so explicit GPTBot/ClaudeBot entries are no-ops.

## Workstream 2 — SEO plumbing

### Structured data (JSON-LD)

Two placements only, where the schema type genuinely fits:

- Homepage (`index.mdx`): `SoftwareApplication` with category `DeveloperApplication`, MIT license, price free, and `sameAs` pointing at the GitHub repo.
- Troubleshooting page (new, workstream 3): `FAQPage` matching its real Q&A content.

Injection via Starlight per-page frontmatter `head` or whatever equivalent mechanism Starlight supports.

### Per-page OG images

Generate a branded OG image per docs page at build (page title + logo on a template) with `astro-og-canvas` or an equivalent library. The existing `og.png` stays as homepage/fallback. Per-page `og:image` and `twitter:image` metas must point at the generated image.

### Title/description tuning (4 pages)

HTML titles target real queries; sidebar labels stay short.

| Page | Target query |
| --- | --- |
| `compare/nx-cloud` | "Nx Cloud alternative" |
| `why` | "Nx Powerpack cache deprecated" / "@nx/s3-cache deprecated" |
| homepage | "self-hosted Nx remote cache" |
| `getting-started/quickstart` | "set up Nx remote cache" |

### Internal linking pass

The CVE page and `why` (organic entry points; 45 of 60 visits bounce) get stronger calls-to-action into quickstart and compare.

### Already in place, untouched

Sitemap (Starlight auto-generates), canonical URLs, per-page meta descriptions.

## Workstream 3 — New content pages

In priority order. Both guides land in the sidebar and flow into llms.txt automatically.

### 1. CI recipes — `guides/ci-recipes`

Targets "nx remote cache github actions" and neighbors. Content:

- GitHub Actions workflow wiring `NX_SELF_HOSTED_REMOTE_CACHE_SERVER` + token secrets
- The fork-PR pattern: `readonly` token on `pull_request`, `full` token on `main`. This is the project's write-trust boundary made concrete
- GitLab CI equivalent
- Short generic-CI section

Cross-linked from quickstart and the security guide.

### 2. Troubleshooting / FAQ — `guides/troubleshooting`

Q&A entries built from the actual error strings and status codes in `src/responses.ts` (what people paste into search). Covers at minimum:

- 401/403 token failures
- 409 on PUT (append-only working as intended; gets its own entry because it looks like an error)
- `/ready` failing, per storage backend
- Docker volume permissions
- Eviction not running (it is opt-in)
- TLS / proxy issues

Carries the `FAQPage` JSON-LD.

### 3. Monitoring — `guides/monitoring` (cut line)

Prometheus scrape config, actual metric names from `/metrics`, 3–4 example alert rules (hit-rate drop, readiness failing, size approaching `CACHE_MAX_BYTES`). No Grafana dashboard JSON. If the cycle runs long, this page drops to the backlog first.

## README

One added line pointing agents at `https://remotecache.dev/llms.txt`.

## Verification

- `bun run build` in `docs-site/` passes; the links validator checks every new internal link at build.
- Post-build assertions: `dist/` contains `llms.txt`, `llms-full.txt`, per-page `.md` files, and per-page OG images; `llms-full.txt` contains no API-reference pages.
- JSON-LD blocks parse as valid JSON at build; rich-results eligibility checked manually after deploy.
- No server behavior, HTTP API, or env vars change, so the repo docs-sync rule triggers no OpenAPI or Configuration-page updates.
- New prose passes a humanizer review before commit.

## Implementation notes

- All third-party APIs (starlight-llms-txt options, OG image library, Starlight head/endpoint mechanics) get verified with ctx7 + production OSS usage during planning, per workspace rules.
- Commits follow Conventional Commits; docs build runs in PR CI.

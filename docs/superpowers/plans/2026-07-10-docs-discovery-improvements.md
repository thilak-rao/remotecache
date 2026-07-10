# Docs Discovery Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the remotecache docs site findable and quotable for search engines and AI agents: llms.txt outputs, per-page raw markdown, per-page OG images, targeted title fixes, and three search-intent content pages.

**Architecture:** All work lands in `docs-site/` (Astro 7 + Starlight 0.41) plus one README line. Agent surfaces come from a Starlight plugin (`starlight-llms-txt`) and two small custom endpoints (`[...slug].md.ts`, `og/[...route].ts` + route middleware). Content pages are plain Starlight markdown with frontmatter `head` for JSON-LD, a pattern already proven on `index.mdx`, `why.md`, and the CVE page.

**Tech Stack:** Bun, Astro 7, Starlight 0.41, `starlight-llms-txt@0.11.0`, `astro-og-canvas@0.13.0`.

**Spec:** `docs/superpowers/specs/2026-07-10-docs-discovery-improvements-design.md`

## Global Constraints

- Install docs-site deps with `bun add`/`bun install` inside `docs-site/`. Never npm, pnpm, or yarn.
- Every task's verification build is: `cd docs-site && bun run build`. It must exit 0. The build runs `prepare:agent-assets` and the Starlight links validator, so broken internal links fail the build.
- Run `bun run format` from the repo root before each commit (CI gates on `format --check`).
- Commits follow Conventional Commits: `type(scope): subject`, imperative, lowercase, no trailing period.
- Site URL is `https://remotecache.dev`. Docs pages live in `docs-site/src/content/docs/`.
- Single quotes in JS/TS (oxfmt). No `console` calls in new TS (use nothing; these files don't log).
- New user-facing prose must be reviewed against the humanizer skill's patterns before committing (no em-dash overuse, no rule-of-three padding, no "delve/landscape/testament" vocabulary, sentence-case headings).
- Already done, do NOT redo: homepage SEO title + `SoftwareApplication` JSON-LD (`index.mdx`), `why.md` and `compare/nx-cloud.md` SEO titles + `TechArticle` JSON-LD, CVE page `FAQPage` JSON-LD, sitemap, meta descriptions.

---

### Task 1: llms.txt generation

**Files:**
- Modify: `docs-site/package.json` (via `bun add`)
- Modify: `docs-site/astro.config.mjs`

**Interfaces:**
- Produces: build outputs `dist/llms.txt`, `dist/llms-full.txt`, `dist/llms-small.txt`. Task 8 links to `https://remotecache.dev/llms.txt`.

- [ ] **Step 1: Install the plugin**

```bash
cd docs-site && bun add starlight-llms-txt@0.11.0
```

- [ ] **Step 2: Register the plugin**

In `docs-site/astro.config.mjs`, add the import after the existing `starlightLinksValidator` import:

```js
import starlightLlmsTxt from 'starlight-llms-txt';
```

Then add the plugin call to the `plugins` array, after the `starlightOpenAPI([...])` entry:

```js
        starlightLlmsTxt({
          projectName: 'remotecache',
          description:
            'A free, self-hosted, MIT-licensed Nx remote cache server on the Bun runtime with filesystem, S3, or GCS storage and readonly/full bearer-token auth.',
          promote: ['index*', 'getting-started/**'],
          optionalLinks: [
            {
              label: 'OpenAPI document',
              url: 'https://remotecache.dev/openapi.json',
              description:
                'Machine-readable HTTP API spec with exact endpoints, status codes, and request/response shapes',
            },
          ],
        }),
```

- [ ] **Step 3: Build**

Run: `cd docs-site && bun run build`
Expected: exit 0.

- [ ] **Step 4: Verify outputs**

```bash
cd docs-site && test -f dist/llms.txt && test -f dist/llms-full.txt && test -f dist/llms-small.txt && echo OK
grep -c 'remotecache' dist/llms.txt
grep -c '/api/operations' dist/llms-full.txt || echo 'no api pages: OK'
```

Expected: `OK`; a non-zero count for the second command; `no api pages: OK` for the third (starlight-openapi routes are not in the `docs` collection, so they must not appear).

- [ ] **Step 5: Commit**

```bash
cd docs-site && git add package.json bun.lock astro.config.mjs
git commit -m "feat(site): generate llms.txt for ai agents"
```

---

### Task 2: Per-page raw markdown endpoint

**Files:**
- Create: `docs-site/src/pages/[...slug].md.ts`
- Modify: `docs-site/astro.config.mjs` (add `details` to the Task 1 plugin config)

**Interfaces:**
- Consumes: the `docs` content collection (`getCollection('docs')`); entries expose `id` (slug, `''` or `'index'` for the homepage) and `body` (raw markdown without frontmatter).
- Produces: every docs page served as raw markdown at `<page-path>.md` (e.g. `/guides/configuration.md`, `/index.md`). The id normalization convention `entry.id || 'index'` is shared with Task 3.

- [ ] **Step 1: Create the endpoint**

Create `docs-site/src/pages/[...slug].md.ts`:

```ts
import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';

// Serves each docs page's raw markdown at `<page-path>.md` so agents can
// fetch a single page without downloading llms-full.txt. Pages generated by
// starlight-openapi are not in the collection; /openapi.json covers the API.
export const getStaticPaths = (async () => {
  const entries = await getCollection('docs');
  return entries.map((entry) => ({
    params: { slug: entry.id || 'index' },
    props: { body: entry.body ?? '' },
  }));
}) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props }) =>
  new Response(props.body, {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
```

- [ ] **Step 2: Advertise the endpoint in llms.txt**

In `docs-site/astro.config.mjs`, add a `details` key to the `starlightLlmsTxt({...})` options from Task 1:

```js
          details:
            'Every documentation page is also available as raw Markdown by appending `.md` to its URL path, for example <https://remotecache.dev/guides/configuration.md>.',
```

- [ ] **Step 3: Build**

Run: `cd docs-site && bun run build`
Expected: exit 0.

- [ ] **Step 4: Verify outputs**

```bash
cd docs-site && test -f dist/guides/configuration.md && test -f dist/index.md && echo OK
grep -c 'Environment variables' dist/guides/configuration.md
grep -c 'appending `.md`' dist/llms.txt
```

Expected: `OK`, then non-zero counts. If `dist/index.md` is missing, check whether the homepage entry id is `''` or `'index'` and adjust the normalization; the other pages must exist regardless.

- [ ] **Step 5: Commit**

```bash
cd docs-site && git add src/pages astro.config.mjs
git commit -m "feat(site): serve per-page raw markdown for agents"
```

---

### Task 3: Per-page OG images

**Files:**
- Modify: `docs-site/package.json` (via `bun add`)
- Create: `docs-site/src/pages/og/[...route].ts`
- Create: `docs-site/src/route-data.ts`
- Modify: `docs-site/astro.config.mjs` (register `routeMiddleware`, remove global `og:image`/`twitter:image` head entries)

**Interfaces:**
- Consumes: the `docs` collection and the `entry.id || 'index'` convention from Task 2.
- Produces: `dist/og/<id>.png` per docs page (homepage at `/og/index.png`); every Starlight page's `<head>` carries `og:image` + `twitter:image` pointing at its generated image, with `/og.png` as the fallback for pages outside the collection (the starlight-openapi API pages). `public/og.png` stays in place as that fallback.

- [ ] **Step 1: Install**

```bash
cd docs-site && bun add astro-og-canvas@0.13.0
```

(`canvaskit-wasm` is a regular dependency of the package; no extra install.)

- [ ] **Step 2: Create the image endpoint**

Create `docs-site/src/pages/og/[...route].ts`:

```ts
import { getCollection } from 'astro:content';
import { OGImageRoute } from 'astro-og-canvas';

const entries = await getCollection('docs');
const pages = Object.fromEntries(entries.map((entry) => [entry.id || 'index', entry.data]));

export const { getStaticPaths, GET } = await OGImageRoute({
  pages,
  getImageOptions: (_path, page) => ({
    title: page.title,
    description: page.description ?? '',
    logo: { path: './src/assets/logo.png', size: [80] },
    bgGradient: [[24, 24, 27]],
  }),
});
```

Note: `OGImageRoute`'s default slug mapping appends `.png` to each `pages` key, so the key `guides/configuration` becomes `/og/guides/configuration.png`. Do not pass a `param` option; the installed version infers it from the route pattern.

- [ ] **Step 3: Create the route middleware**

Create `docs-site/src/route-data.ts`:

```ts
import { defineRouteMiddleware } from '@astrojs/starlight/route-data';
import { getCollection } from 'astro:content';

const docsIds = new Set((await getCollection('docs')).map((entry) => entry.id || 'index'));

export const onRequest = defineRouteMiddleware((context) => {
  const { head, id } = context.locals.starlightRoute;
  const routeId = id || 'index';
  // API reference pages are generated by starlight-openapi and have no
  // per-page image; they fall back to the site-wide card.
  const imagePath = docsIds.has(routeId) ? `/og/${routeId}.png` : '/og.png';
  const imageUrl = new URL(imagePath, context.site);
  head.push(
    { tag: 'meta', attrs: { property: 'og:image', content: imageUrl.href } },
    { tag: 'meta', attrs: { name: 'twitter:image', content: imageUrl.href } },
  );
});
```

- [ ] **Step 4: Register the middleware and drop the global image metas**

In `docs-site/astro.config.mjs`:

1. Add `routeMiddleware: './src/route-data.ts',` to the `starlight({...})` options (next to `favicon`).
2. Delete these two entries from the `head` array (the middleware now sets both per page; keep the `twitter:card` and `apple-touch-icon` entries and the Umami script):

```js
        { tag: 'meta', attrs: { property: 'og:image', content: 'https://remotecache.dev/og.png' } },
```

```js
        {
          tag: 'meta',
          attrs: { name: 'twitter:image', content: 'https://remotecache.dev/og.png' },
        },
```

- [ ] **Step 5: Build**

Run: `cd docs-site && bun run build`
Expected: exit 0. (First build compiles canvaskit; it can take noticeably longer.)

- [ ] **Step 6: Verify outputs**

```bash
cd docs-site && test -f dist/og/index.png && test -f dist/og/guides/configuration.png && echo OK
grep -c 'property="og:image"' dist/guides/configuration/index.html
grep -c 'og/guides/configuration.png' dist/guides/configuration/index.html
```

Expected: `OK`; og:image count exactly `1` (no duplicate from the removed global entry); non-zero for the per-page URL.

- [ ] **Step 7: Commit**

```bash
cd docs-site && git add package.json bun.lock astro.config.mjs src/pages/og src/route-data.ts
git commit -m "feat(site): generate per-page open graph images"
```

---

### Task 4: SEO title tweaks and quickstart CTA

**Files:**
- Modify: `docs-site/src/content/docs/getting-started/quickstart.md:1-4` (frontmatter)
- Modify: `docs-site/src/content/docs/compare/nx-cloud.md:4-6` (head title)
- Modify: `docs-site/src/content/docs/security/cve-2025-36852.md:74-79` (Your options list)

**Interfaces:**
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Tune the quickstart title**

In `quickstart.md`, replace the frontmatter block:

```yaml
---
title: Quickstart
description: 'Get a self-hosted Nx remote cache running and wired into Nx in five minutes: start the server, create a token, point Nx at it.'
---
```

with:

```yaml
---
title: Quickstart
description: 'Get a self-hosted Nx remote cache running and wired into Nx in five minutes: start the server, create a token, point Nx at it.'
head:
  - tag: title
    content: 'Set Up a Self-Hosted Nx Remote Cache in 5 Minutes | remotecache'
---
```

- [ ] **Step 2: Add "alternative" to the compare page title**

In `compare/nx-cloud.md`, replace:

```yaml
  - tag: title
    content: 'Self-Hosted Nx Remote Cache vs Nx Cloud: Honest Comparison'
```

with:

```yaml
  - tag: title
    content: 'Nx Cloud Alternative? Self-Hosted Nx Remote Cache vs Nx Cloud'
```

(`why.md` needs no link change: it already links the quickstart from both "Your options" and "Get started", which satisfies the spec's internal-linking pass for that page.)

- [ ] **Step 3: Add a quickstart CTA to the CVE page**

In `cve-2025-36852.md`, the "Your options" section ends with two bullets (Compare with Nx Cloud, Migrate from @nx/s3-cache). Add a third bullet after them:

```md
- **[Set up remotecache](/getting-started/quickstart/)** — start the server, create `readonly` and `full` tokens, and wire Nx to it in about five minutes.
```

- [ ] **Step 4: Build**

Run: `cd docs-site && bun run build`
Expected: exit 0.

```bash
cd docs-site && grep -c 'Set Up a Self-Hosted Nx Remote Cache' dist/getting-started/quickstart/index.html
grep -c 'Nx Cloud Alternative' dist/compare/nx-cloud/index.html
```

Expected: non-zero counts.

- [ ] **Step 5: Commit**

```bash
cd docs-site && git add src/content/docs
git commit -m "docs(site): tune seo titles and add quickstart cta to cve page"
```

---

### Task 5: CI recipes page

**Files:**
- Create: `docs-site/src/content/docs/guides/ci-recipes.md`
- Modify: `docs-site/astro.config.mjs` (sidebar)
- Modify: `docs-site/src/content/docs/getting-started/quickstart.md` (Next steps)
- Modify: `docs-site/src/content/docs/guides/security.md` (trust boundaries cross-link)

**Interfaces:**
- Produces: page at `/guides/ci-recipes/`. Task 6 links to it.

- [ ] **Step 1: Create the page**

Create `docs-site/src/content/docs/guides/ci-recipes.md` with exactly this content:

````md
---
title: 'CI recipes'
description: 'Wire the Nx remote cache into GitHub Actions and GitLab CI with readonly tokens for untrusted jobs and a full token only on trusted branches.'
head:
  - tag: title
    content: 'Nx Remote Cache in GitHub Actions and GitLab CI | remotecache'
---

Nx talks to this server through two environment variables, so any CI provider works. What differs per provider is how you keep the `full` token away from untrusted jobs. That separation is the whole point: a `readonly` token can pull cache hits but cannot write, so an untrusted job can never poison an artifact that a trusted build later consumes (see [CVE-2025-36852](/security/cve-2025-36852/)).

Create the two tokens once with the [admin API](/guides/tokens/):

```sh
# full: for trusted pipelines that populate the cache (main, deploy)
curl -sS -X POST -H "Authorization: Bearer ${ADMIN_TOKEN}" -H "Content-Type: application/json" \
  "https://cache.example.com/v1/admin/tokens" -d '{"id":"ci-main","permission":"full"}'

# readonly: for everything else
curl -sS -X POST -H "Authorization: Bearer ${ADMIN_TOKEN}" -H "Content-Type: application/json" \
  "https://cache.example.com/v1/admin/tokens" -d '{"id":"ci-readonly","permission":"readonly"}'
```

## GitHub Actions

Store both token values as repository secrets (`NX_CACHE_FULL_TOKEN`, `NX_CACHE_READONLY_TOKEN`). The workflow picks the token by branch: `main` gets `full`, everything else gets `readonly`.

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

env:
  NX_SELF_HOSTED_REMOTE_CACHE_SERVER: https://cache.example.com
  NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN: ${{ github.ref == 'refs/heads/main' && secrets.NX_CACHE_FULL_TOKEN || secrets.NX_CACHE_READONLY_TOKEN }}

jobs:
  main:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npx nx affected -t lint test build
```

### Fork pull requests

GitHub does not pass secrets to workflows triggered by a `pull_request` from a fork. Both token variables resolve to empty strings there, Nx skips the remote cache, and the job builds against its local cache only. That default is the safe one: fork PRs get no cache credentials of any kind.

Do not work around this with `pull_request_target` to hand tokens to fork code. That event runs with secret access against untrusted head commits, and chained with cache poisoning it is exactly the attack pattern seen in the May 2026 TanStack compromise.

## GitLab CI

GitLab's protected variables map onto the token split directly. Define two CI/CD variables:

- `NX_CACHE_READONLY_TOKEN`: a normal variable, available to every branch pipeline.
- `NX_CACHE_FULL_TOKEN`: a **protected** variable, exposed only to pipelines on protected branches (protect `main`).

```yaml
default:
  image: node:22

variables:
  NX_SELF_HOSTED_REMOTE_CACHE_SERVER: 'https://cache.example.com'

.nx-cache: &nx-cache
  before_script:
    - npm ci
    - |
      if [ -n "$NX_CACHE_FULL_TOKEN" ]; then
        export NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN="$NX_CACHE_FULL_TOKEN"
      else
        export NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN="$NX_CACHE_READONLY_TOKEN"
      fi

build:
  <<: *nx-cache
  script:
    - npx nx affected -t lint test build
```

On a protected branch both variables exist and the job exports the `full` token; on any other branch only the readonly one is set. Pipelines for merge requests from forks receive no CI/CD variables by default, which degrades to the same safe cache-less behavior as GitHub.

## Any other CI

Set the same two variables on the process that runs Nx:

```sh
export NX_SELF_HOSTED_REMOTE_CACHE_SERVER="https://cache.example.com"
export NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN="<readonly-or-full-token>"
```

Two rules carry over regardless of provider:

- Only pipelines you trust to produce artifacts (typically `main` and deploy jobs) get the `full` token.
- If a job's inputs can be influenced by people you would not let push to `main`, it gets `readonly` or nothing.

The [security model](/guides/security/) explains what the token split does and does not protect against.
````

- [ ] **Step 2: Review the copy against humanizer patterns**

Read the page once looking specifically for AI tells (em-dash chains, rule-of-three lists, filler phrases). Fix anything you find before continuing.

- [ ] **Step 3: Add the sidebar entry**

In `docs-site/astro.config.mjs`, in the `Guides` sidebar group, insert after the Security model entry:

```js
            { label: 'CI recipes', slug: 'guides/ci-recipes' },
```

- [ ] **Step 4: Cross-link from quickstart and the security guide**

In `quickstart.md`, "Next steps" list, insert as the second bullet:

```md
- [CI recipes](/guides/ci-recipes/) — GitHub Actions and GitLab CI with `readonly` tokens for untrusted jobs.
```

In `guides/security.md`, at the end of the "Trust boundaries: containing cache poisoning" section (after the paragraph ending "so they cannot place a poisoned artifact."), add:

```md
[CI recipes](/guides/ci-recipes/) shows this split wired into GitHub Actions and GitLab CI.
```

- [ ] **Step 5: Build**

Run: `cd docs-site && bun run build`
Expected: exit 0 (links validator confirms the new links).

- [ ] **Step 6: Commit**

```bash
cd docs-site && git add src/content/docs astro.config.mjs
git commit -m "docs(site): add ci recipes guide for github actions and gitlab"
```

---

### Task 6: Troubleshooting page with FAQPage JSON-LD

**Files:**
- Create: `docs-site/src/content/docs/guides/troubleshooting.md`
- Modify: `docs-site/astro.config.mjs` (sidebar)

**Interfaces:**
- Consumes: `/guides/ci-recipes/` from Task 5 (one link).
- Produces: page at `/guides/troubleshooting/`.

- [ ] **Step 1: Create the page**

Create `docs-site/src/content/docs/guides/troubleshooting.md` with exactly this content. The answers quote the server's real response bodies (from `src/responses.ts` and its callers) so error messages pasted into a search engine land here.

````md
---
title: 'Troubleshooting'
description: 'Fixes for the errors the Nx remote cache server actually returns: 403 Access forbidden, 409 Cannot override an existing record, 503 Not Ready, and more.'
head:
  - tag: title
    content: 'Troubleshooting the Self-Hosted Nx Remote Cache | remotecache'
  - tag: script
    attrs: { type: application/ld+json }
    content: |
      {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[
        {"@type":"Question","name":"Why does the Nx remote cache return 403 Access forbidden?","acceptedAnswer":{"@type":"Answer","text":"The bearer token is missing, wrong, or lacks permission. A readonly token on an upload returns 403 by design: readonly tokens cannot write. Uploads need a token with full permission."}},
        {"@type":"Question","name":"Why does PUT return 409 Cannot override an existing record?","acceptedAnswer":{"@type":"Answer","text":"The cache is append-only. An entry for that hash already exists and is never overwritten. This is working as intended; treat it as success on retries."}},
        {"@type":"Question","name":"Why does /ready return 503 Not Ready?","acceptedAnswer":{"@type":"Answer","text":"The readiness probe checks the SQLite token database and the configured storage backend. One of them is unreachable; the specific dependency failure is written to the server logs."}},
        {"@type":"Question","name":"Why does the server exit immediately on startup?","acceptedAnswer":{"@type":"Answer","text":"ADMIN_TOKEN is missing or shorter than 16 characters, or the storage configuration is invalid, such as setting only one of the two TLS paths or enabling cache eviction with object storage. The startup error is printed to stderr."}},
        {"@type":"Question","name":"Why is Nx not using the remote cache at all?","acceptedAnswer":{"@type":"Answer","text":"NX_SELF_HOSTED_REMOTE_CACHE_SERVER and NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN must be set on the process that runs Nx. In CI, check they are exported in the job that invokes nx, not just defined elsewhere."}},
        {"@type":"Question","name":"Why is cache eviction not running?","acceptedAnswer":{"@type":"Answer","text":"Eviction is opt-in and filesystem-only. Set CACHE_MAX_BYTES or CACHE_TTL_HOURS to enable it. Setting either with S3 or GCS storage is a startup error; use bucket lifecycle rules instead."}}
      ]}
---

Every error below quotes the exact response body the server sends, so you can search for the message you saw.

## 403 `Access forbidden`

The bearer token is missing, wrong, or lacks permission for the operation.

- On `GET /v1/cache/:hash`: the token isn't valid at all. Check the `Authorization: Bearer <token>` header value against a token created via the [admin API](/guides/tokens/).
- On `PUT /v1/cache/:hash`: a valid `readonly` token is being rejected from writing. That is the write-trust boundary doing its job; uploads need `full` permission. If this shows up in CI, your trusted pipeline is holding the wrong token — see [CI recipes](/guides/ci-recipes/).
- On `/v1/admin/tokens`: only the `ADMIN_TOKEN` value works, not cache tokens.

The `nx_cache_requests_total{method="PUT",result="forbidden"}` metric counts readonly write rejections, so you can tell one misconfigured job from a probe or attack pattern.

## 409 `Cannot override an existing record`

The cache is append-only: an entry for that hash already exists and will not be overwritten. This is working as intended, not a failure — two builds raced to upload the same artifact and the first writer won. Nx treats the artifact as cached either way.

## 400 `Invalid hash`

The `:hash` path parameter failed validation. Hashes must match `[A-Za-z0-9_-]`, 1–128 characters; anything else (including dots) is rejected before touching storage. If you see this from Nx itself rather than a hand-written client, check that a proxy isn't rewriting the URL.

## 400 `Invalid Content-Length header`

`PUT /v1/cache/:hash` requires a `Content-Length` header with a positive integer. Chunked uploads without a length are rejected. If a proxy sits in front of the server, confirm it forwards the header instead of switching to chunked transfer encoding.

## 404 `The record was not found`

A cache miss. Normal on first builds and after eviction. If your hit rate is unexpectedly low, compare hashes between environments — different Node versions, environment variables in named inputs, or OS differences produce different task hashes.

## 413 `Upload exceeds the maximum allowed size of N bytes`

The artifact is larger than `MAX_UPLOAD_BYTES` (default 500 MiB). Raise the cap in the server's environment if the artifact is legitimate; see [Configuration](/guides/configuration/).

## 503 `Not Ready` from `/ready`

The readiness probe checks SQLite token storage and the configured cache backend, and one of them failed. The response body is static; the actual dependency error is in the server logs. Common causes: the `./data` volume isn't writable, the S3/GCS bucket or credentials are wrong, or the bucket isn't reachable from the container's network.

## The server exits immediately on startup

The server fails fast on invalid configuration and prints the reason to stderr:

- `ADMIN_TOKEN` missing or shorter than 16 characters.
- Only one of `TLS_CERT_PATH`/`TLS_KEY_PATH` set, or a file missing.
- `CACHE_MAX_BYTES`/`CACHE_TTL_HOURS` set together with `STORAGE_STRATEGY=s3` or `gcs` (eviction is filesystem-only).
- An unknown `STORAGE_STRATEGY` value.

## Permission errors on Docker volumes

The container runs the server as the non-root `bun` user, and the entrypoint prepares mounted data directories on start. If you still hit `EACCES` on `/app/data` or `/app/cache`, the host directories were likely created by another UID with restrictive permissions — make them writable for the container user (for example `chmod 777` for a quick test, or `chown` to the container's UID for a proper fix).

## Eviction is not running

Eviction is opt-in and filesystem-only. Nothing is evicted until you set `CACHE_MAX_BYTES` (LRU size cap) or `CACHE_TTL_HOURS` (last-access TTL). The sweep runs every `CACHE_SWEEP_INTERVAL_MS` (default 60 s) and only when a cap or TTL is set. On S3/GCS, use bucket lifecycle rules instead; see [Storage strategies](/guides/storage-strategies/).

## Nx isn't using the remote cache

`NX_SELF_HOSTED_REMOTE_CACHE_SERVER` and `NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN` must be set on the process that runs `nx`. In CI that means the job step that invokes Nx, not a different job or a shell that already exited. Verify from the same shell:

```sh
curl -fsS -H "Authorization: Bearer ${NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN}" \
  "${NX_SELF_HOSTED_REMOTE_CACHE_SERVER}/v1/cache/does-not-exist"
```

A `404` means auth works and the server is reachable (it's just a miss). A `403` means the token is wrong; a connection error means the URL is wrong or the network path is blocked.
````

- [ ] **Step 2: Review the copy against humanizer patterns**

Same check as Task 5 Step 2.

- [ ] **Step 3: Add the sidebar entry**

In `docs-site/astro.config.mjs`, `Guides` group, insert after the CI recipes entry:

```js
            { label: 'Troubleshooting', slug: 'guides/troubleshooting' },
```

- [ ] **Step 4: Build**

Run: `cd docs-site && bun run build`
Expected: exit 0.

```bash
cd docs-site && grep -c 'FAQPage' dist/guides/troubleshooting/index.html
```

Expected: non-zero (JSON-LD present in the built page).

- [ ] **Step 5: Commit**

```bash
cd docs-site && git add src/content/docs astro.config.mjs
git commit -m "docs(site): add troubleshooting guide with faq structured data"
```

---

### Task 7: Monitoring page (cut line — drop first if the cycle runs long)

**Files:**
- Create: `docs-site/src/content/docs/guides/monitoring.md`
- Modify: `docs-site/astro.config.mjs` (sidebar)
- Modify: `docs-site/src/content/docs/deploy/docker.md` (link from its Monitoring section)

**Interfaces:**
- Produces: page at `/guides/monitoring/`.

- [ ] **Step 1: Create the page**

Create `docs-site/src/content/docs/guides/monitoring.md` with exactly this content (metric names match `src/metrics/metrics-registry.ts`):

````md
---
title: 'Monitoring'
description: 'Prometheus metrics for the Nx remote cache server: hit rate, readonly write rejections, eviction, and example alert rules.'
head:
  - tag: title
    content: 'Monitoring the Nx Remote Cache with Prometheus | remotecache'
---

The server exposes Prometheus metrics at `GET /metrics` in the text exposition format. The endpoint is unauthenticated and reports only aggregates — no token values, no cache hashes — but treat it as private operational data: scrape it over a private network and block `/metrics` at your public proxy.

## Metrics

| Metric | Type | Meaning |
| --- | --- | --- |
| `nx_cache_requests_total{method,result}` | counter | Cache requests by method and outcome. `GET` results: `hit`, `miss`, `forbidden`, `bad_request`, `error`. `PUT` results: `stored`, `forbidden`, `immutable`, `too_large`, `bad_request`, `error`. |
| `nx_cache_uploaded_bytes_total` | counter | Bytes accepted by successful uploads. |
| `nx_cache_evicted_entries_total` | counter | Entries deleted by the eviction sweeper (filesystem strategy). |
| `nx_cache_evicted_bytes_total` | counter | Bytes reclaimed by the eviction sweeper. |
| `nx_cache_size_bytes` | gauge | Committed cache size as of the last eviction sweep. Only updates when eviction is enabled. |

Two results deserve a note:

- `PUT` `forbidden` counts `readonly` tokens rejected from writing — the write-trust boundary firing. A steady nonzero rate means a job holds the wrong token (see [CI recipes](/guides/ci-recipes/)) or someone is probing.
- `PUT` `immutable` counts attempts to overwrite an existing entry (`409`). Occasional occurrences are normal racing builds.

## Scraping

```yaml
scrape_configs:
  - job_name: nx-cache
    static_configs:
      - targets: ['nx-cache:3000']
```

## Useful queries

Cache hit rate over the last 15 minutes:

```promql
sum(rate(nx_cache_requests_total{method="GET",result="hit"}[15m]))
/
sum(rate(nx_cache_requests_total{method="GET",result=~"hit|miss"}[15m]))
```

Upload throughput:

```promql
rate(nx_cache_uploaded_bytes_total[15m])
```

## Example alert rules

```yaml
groups:
  - name: nx-cache
    rules:
      - alert: NxCacheDown
        expr: up{job="nx-cache"} == 0
        for: 5m
        labels: { severity: critical }
        annotations:
          summary: 'Nx cache server is unreachable'

      - alert: NxCacheHitRateLow
        expr: |
          sum(rate(nx_cache_requests_total{method="GET",result="hit"}[1h]))
          /
          sum(rate(nx_cache_requests_total{method="GET",result=~"hit|miss"}[1h])) < 0.5
        for: 2h
        labels: { severity: warning }
        annotations:
          summary: 'Cache hit rate below 50% — check for hash instability or recent eviction'

      - alert: NxCacheReadonlyWriteAttempts
        expr: increase(nx_cache_requests_total{method="PUT",result="forbidden"}[15m]) > 0
        labels: { severity: warning }
        annotations:
          summary: 'A readonly token attempted a cache write — misconfigured job or probe'

      - alert: NxCacheNearCapacity
        # Replace 50000000000 with 90% of your CACHE_MAX_BYTES value; the cap
        # itself is not exported as a metric.
        expr: nx_cache_size_bytes > 50000000000
        for: 30m
        labels: { severity: warning }
        annotations:
          summary: 'Filesystem cache approaching CACHE_MAX_BYTES; sweeps will evict aggressively'
```

Tune the hit-rate threshold to your baseline; a monorepo with many long-lived branches naturally sits lower than one where most builds hit `main`-warmed entries.

## Readiness

Use token-free `GET /health` for liveness and `GET /ready` for dependency readiness (token DB plus storage backend). `/ready` returning `503 Not Ready` while `/health` is fine points at storage or the token database — see [Troubleshooting](/guides/troubleshooting/).
````

- [ ] **Step 2: Review the copy against humanizer patterns**

Same check as Task 5 Step 2.

- [ ] **Step 3: Sidebar and cross-link**

In `docs-site/astro.config.mjs`, `Guides` group, insert after the Troubleshooting entry:

```js
            { label: 'Monitoring', slug: 'guides/monitoring' },
```

In `deploy/docker.md`, at the end of its "Monitoring" section (after the scrape-config code block), add:

```md
For PromQL queries and example alert rules, see the [Monitoring guide](/guides/monitoring/).
```

- [ ] **Step 4: Build**

Run: `cd docs-site && bun run build`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
cd docs-site && git add src/content/docs astro.config.mjs
git commit -m "docs(site): add prometheus monitoring guide"
```

---

### Task 8: SKILL.md refresh, auth.md, README

**Files:**
- Modify: `docs-site/public/.well-known/agent-skills/remotecache/SKILL.md`
- Modify: `docs-site/public/auth.md`
- Modify: `README.md` (repo root)

**Interfaces:**
- Consumes: `/llms.txt` (Task 1) and per-page `.md` (Task 2) must exist, or the links below are false claims.

- [ ] **Step 1: Invoke prompt-wizard**

This step edits a skill description. Invoke the `prompt-wizard` skill first and apply its guidance to the edit below (the executor must actually invoke it, not skip it).

- [ ] **Step 2: Update SKILL.md**

In `docs-site/public/.well-known/agent-skills/remotecache/SKILL.md`, replace the "Primary docs" list:

```md
Primary docs:

- Quickstart: https://remotecache.dev/getting-started/quickstart/
- API reference: https://remotecache.dev/api/
- OpenAPI document: https://remotecache.dev/openapi.json
- Configuration: https://remotecache.dev/guides/configuration/
- Storage strategies: https://remotecache.dev/guides/storage-strategies/
- Token and admin API: https://remotecache.dev/guides/tokens/
- Security model: https://remotecache.dev/guides/security/
```

with:

```md
Primary docs (read `llms.txt` first; append `.md` to any page URL for raw Markdown):

- Docs index for agents: https://remotecache.dev/llms.txt
- Full docs in one file: https://remotecache.dev/llms-full.txt
- Quickstart: https://remotecache.dev/getting-started/quickstart/
- API reference: https://remotecache.dev/api/
- OpenAPI document: https://remotecache.dev/openapi.json
- Configuration: https://remotecache.dev/guides/configuration/
- Storage strategies: https://remotecache.dev/guides/storage-strategies/
- Token and admin API: https://remotecache.dev/guides/tokens/
- Security model: https://remotecache.dev/guides/security/
```

- [ ] **Step 3: Update auth.md discovery section**

In `docs-site/public/auth.md`, replace the "Discovery" section body:

```md
The API reference is at https://remotecache.dev/api/
The OpenAPI document is at https://remotecache.dev/openapi.json
```

with:

```md
The API reference is at https://remotecache.dev/api/
The OpenAPI document is at https://remotecache.dev/openapi.json
The docs index for agents is at https://remotecache.dev/llms.txt
```

- [ ] **Step 4: Add the README line**

In the repo-root `README.md`, in the "Links" section, add after the API Reference line:

```md
- [llms.txt](https://remotecache.dev/llms.txt) — agent-readable docs index; append `.md` to any docs URL for raw Markdown
```

- [ ] **Step 5: Build and verify the digest regenerated**

Run: `cd docs-site && bun run build`
Expected: exit 0, and the `sha256:` digest inside `docs-site/public/.well-known/agent-skills/index.json` differs from the pre-edit value (the build's `prepare:agent-assets` step recomputes it from the edited SKILL.md).

- [ ] **Step 6: Commit**

```bash
git add docs-site/public README.md
git commit -m "docs(agents): point agents at llms.txt and per-page markdown"
```

---

### Task 9: Final verification pass

**Files:** none (verification only).

- [ ] **Step 1: Full clean build**

```bash
cd docs-site && rm -rf dist && bun run build
```

Expected: exit 0.

- [ ] **Step 2: Assert every spec deliverable exists in dist**

```bash
cd docs-site
for f in llms.txt llms-full.txt llms-small.txt index.md guides/configuration.md \
  og/index.png og/guides/ci-recipes.png og/guides/troubleshooting.png \
  guides/ci-recipes/index.html guides/troubleshooting/index.html guides/monitoring/index.html; do
  test -f "dist/$f" && echo "OK  $f" || echo "MISSING  $f"
done
grep -c '/api/operations' dist/llms-full.txt || echo 'OK  no api pages in llms-full'
```

Expected: `OK` for every file, `OK no api pages in llms-full`. Any `MISSING` line means a prior task's output regressed — stop and fix before proceeding.

- [ ] **Step 3: Validate the FAQPage JSON-LD parses**

```bash
cd docs-site && python3 - <<'EOF'
import json, re
html = open('dist/guides/troubleshooting/index.html').read()
blocks = re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.S)
assert blocks, 'no JSON-LD block found'
for b in blocks:
    json.loads(b)
print('JSON-LD OK:', len(blocks), 'block(s)')
EOF
```

Expected: `JSON-LD OK: 1 block(s)`.

- [ ] **Step 4: Repo-wide gates**

```bash
cd /Users/trao/git/remotecache/.agents/worktrees/docs-improvement
bun run format && bun run lint && bun test
```

Expected: all pass (server code untouched, so failures indicate an accidental edit outside `docs-site/`).

- [ ] **Step 5: Report**

Summarize which deliverables shipped and confirm the external follow-ups that remain out of repo scope (GSC verification + sitemap submission, rich-results check after deploy).

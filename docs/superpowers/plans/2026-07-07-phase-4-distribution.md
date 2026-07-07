# Phase 4 distribution implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add repo-local deploy templates, docs, README positioning, and external-action checklists for Phase 4 distribution.

**Architecture:** Keep TypeScript runtime code unchanged. Add root platform config files, one Docker entrypoint for mounted-volume ownership, one docs-site deployment page, one distribution checklist, and small README/sidebar updates. Secrets stay outside committed files.

**Tech Stack:** Bun, Dockerfile, Astro/Starlight docs, Railway config-as-code, Render Blueprints, Fly.io `fly.toml`.

---

### Task 1: Add platform deploy templates

**Files:**

- Create: `railway.json`
- Create: `render.yaml`
- Create: `fly.toml`
- Create: `docker-entrypoint.sh`
- Modify: `Dockerfile`

- [ ] **Step 1: Add Railway config**

Create `railway.json`:

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "healthcheckPath": "/health",
    "healthcheckTimeout": 60,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10,
    "requiredMountPath": "/app/data",
    "drainingSeconds": 35
  }
}
```

- [ ] **Step 2: Add Render Blueprint**

Create `render.yaml`:

```yaml
services:
  - type: web
    name: remotecache
    runtime: image
    image:
      url: ghcr.io/thilak-rao/remotecache:latest
    plan: starter
    numInstances: 1
    healthCheckPath: /health
    maxShutdownDelaySeconds: 35
    envVars:
      - key: ADMIN_TOKEN
        sync: false
      - key: PORT
        value: 3000
      - key: CACHE_DIR
        value: /app/data/cache
      - key: TOKENS_DB_PATH
        value: /app/data/tokens.sqlite
    disk:
      name: remotecache-data
      mountPath: /app/data
      sizeGB: 10
```

- [ ] **Step 3: Add Fly app config**

Create `fly.toml`:

```toml
app = "remotecache"
primary_region = "ord"
kill_signal = "SIGTERM"
kill_timeout = "35s"

[build]
  image = "ghcr.io/thilak-rao/remotecache:latest"

[env]
  CACHE_DIR = "/app/data/cache"
  TOKENS_DB_PATH = "/app/data/tokens.sqlite"

[http_service]
  internal_port = 3000
  force_https = true

  [[http_service.checks]]
    interval = "30s"
    timeout = "5s"
    grace_period = "30s"
    method = "GET"
    path = "/health"

[[mounts]]
  source = "remotecache_data"
  destination = "/app/data"
```

- [ ] **Step 4: Add Docker entrypoint for mounted volumes**

Create `docker-entrypoint.sh` so the image can prepare mounted `CACHE_DIR` and `TOKENS_DB_PATH` directories when it starts as root, then `exec su-exec bun:bun "$@"`. If the container is already running as a non-root UID, the script should skip ownership setup and `exec "$@"`.

Modify `Dockerfile` to install `su-exec`, copy the entrypoint, keep the existing `CMD`, and set `ENTRYPOINT ["/app/docker-entrypoint.sh"]`.

### Task 2: Document PaaS deploys

**Files:**

- Create: `docs-site/src/content/docs/deploy/paas.md`
- Modify: `docs-site/astro.config.mjs`
- Modify: `README.md`
- Modify: `docs-site/src/content/docs/deploy/docker.md`
- Modify: `docs-site/src/content/docs/index.mdx`
- Modify: `docs-site/src/content/docs/why.md`

- [ ] **Step 1: Add PaaS docs page**

Create `docs-site/src/content/docs/deploy/paas.md` with frontmatter and sections for Railway, Render, Fly.io, persistence, S3, security, and validation commands.

- [ ] **Step 2: Add docs sidebar entry**

Modify `docs-site/astro.config.mjs` Deploy items to include:

```js
{ label: 'Railway, Render, and Fly.io', slug: 'deploy/paas' },
```

after Docker.

- [ ] **Step 3: Update README**

Add a short CREEP-answer paragraph near the top and add the PaaS page to the links/deploy section.

- [ ] **Step 4: Humanize docs copy**

Review the new and changed prose against the humanizer checklist: remove inflated claims, vague authority, em dash overuse, and chatbot-style phrasing.

### Task 3: Add external distribution checklist

**Files:**

- Create: `docs/distribution/phase-4-checklist.md`

- [ ] **Step 1: Add checklist**

Create a status table and detailed owner-run sections for account-bound Phase 4 tasks. Every item should have acceptance criteria and avoid claiming the work is complete.

- [ ] **Step 2: Humanize checklist copy**

Review the checklist for natural, direct phrasing and remove promotional filler.

### Task 4: Verify

**Files:**

- All touched files

- [ ] **Step 1: Run docs build**

Run:

```bash
bun run build
```

from `docs-site/`.

- [ ] **Step 2: Run repo checks**

Run:

```bash
bun run format --check
bun run lint
bun run typecheck
```

Expected: all commands exit `0`.

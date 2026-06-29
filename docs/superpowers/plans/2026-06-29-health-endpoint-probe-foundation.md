# Health endpoint and probe foundation implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an unauthenticated `GET /health` endpoint and move Docker smoke checks to it, while fixing the stale agent workflow instructions left after Docker publishing changed.

**Architecture:** Follow the existing thin-route pattern in `src/main.ts`: route handlers delegate to small pure helpers and responses come from `src/responses.ts`. Document `/health` in OpenAPI and user docs in the same commit as the behavior change, then update CI and publish workflow smoke checks to use `/health` instead of `/metrics`.

**Tech Stack:** Bun `Bun.serve` routes, `bun:test`, OpenAPI 3.0 JSON, Astro/Starlight generated API docs, GitHub Actions.

---

## Scope

Implement the `/health` probe foundation.

In scope:

- Fix stale `AGENTS.md` Docker publishing instructions from Plan 3.
- Add unauthenticated `GET /health`.
- Return status `200`, content type `text/plain`, and body `OK`.
- Add unit and e2e coverage for `/health`.
- Add `/health` to `nx-cache-server.openapi.json`.
- Update README and docs-site deployment docs.
- Update Docker smoke checks in `ci.yml` and `publish-image.yml` to call `/health`.
- Update `AGENTS.md` so future agents know `/health` exists.

Out of scope:

- Helm chart creation.
- Kubernetes manifests.
- Dockerfile `HEALTHCHECK`.
- TLS support.
- S3 integration tests.
- Nx e2e tests.
- Changing `/metrics` behavior.
- Making `/health` validate filesystem or S3 backend reachability.

## Current baseline

Plan 3 was implemented in these commits:

- `24aa26d` `ci(docker): publish edge stable and multiarch images`
- `ae3900b` `docs(docker): document stable and edge image tags`
- `9dc49da` `docs(release): describe docker publishing flow`

The Plan 3 output reports all gates passed. Local inspection confirms:

- `.github/workflows/publish-image.yml` publishes `edge` and `sha-<short>` from `main`.
- Release tags publish `latest`, `X.Y.Z`, and `X.Y`.
- `AGENTS.md` still says `main` publishes `latest` and `sha-<short>`, so it is stale and must be fixed before another agent relies on it.

## Source checks

- Context7 `/oven-sh/bun`: `Bun.serve({ routes })` supports route entries with HTTP method handlers that return `Response` objects.
- Context7 `/oven-sh/bun`: `bun:test` uses `describe`, `it`/`test`, and `expect` imported from `bun:test`.
- Bun official HTTP server docs: `routes` can include static `Response` objects and dynamic handlers.
- Bun official test docs: Bun's test runner is Jest-compatible and supports TypeScript tests.

## File map

- Modify `AGENTS.md`: sync Docker publishing instructions and add `/health` to the project summary.
- Create `src/health/get-health.ts`: pure health response helper.
- Create `src/health/get-health.spec.ts`: unit test for the helper.
- Create `e2e/health.e2e.spec.ts`: unauthenticated HTTP test for `/health`.
- Modify `src/main.ts`: import and route `GET /health`.
- Modify `nx-cache-server.openapi.json`: add the `/health` operation.
- Modify `README.md`: list `/health` in features and Docker notes.
- Modify `docs-site/src/content/docs/guides/deployment.md`: document health checks.
- Modify `docs-site/src/content/docs/guides/configuration.md`: note that `/health` has no configuration knob.
- Modify `.github/workflows/ci.yml`: Docker smoke calls `/health`.
- Modify `.github/workflows/publish-image.yml`: publish preflight smoke calls `/health`.

## Task 1: Sync stale agent workflow instructions

**Files:**

- Modify: `AGENTS.md`

- [ ] **Step 1: Replace the stale workflow bullet**

In `AGENTS.md`, replace this bullet:

```markdown
- CI runs format-check, lint, and test on every PR; all three must pass (`.github/workflows/ci.yml`). Pushing to `main` builds and pushes the GHCR image as `:latest` + `:sha-<short>`; pushing a `vX.Y.Z` tag publishes `:X.Y.Z` + `:X.Y` (`.github/workflows/publish-image.yml`).
```

with:

```markdown
- CI runs format-check, lint, audits, tests, docs build, Docker smoke, and Trivy filesystem scan on every PR (`.github/workflows/ci.yml`). Pushing to `main` runs the Docker publish workflow after its preflight gate and publishes GHCR image tags `:edge` + `:sha-<short>`; pushing a `vX.Y.Z` tag publishes `:latest`, `:X.Y.Z`, and `:X.Y` for `linux/amd64` and `linux/arm64` (`.github/workflows/publish-image.yml`).
```

- [ ] **Step 2: Verify the stale tag statement is gone**

Run:

```bash
if rg -n 'main.*:latest|latest.*main' AGENTS.md; then
  exit 1
fi
rg -n ':edge.*:sha-<short>|:latest.*:X\\.Y\\.Z.*:X\\.Y' AGENTS.md
```

Expected: the first command exits `0` with no output, and the second command prints the updated workflow bullet.

- [ ] **Step 3: Commit**

Run:

```bash
git add AGENTS.md
git commit -m "docs: sync agent workflow instructions"
```

## Task 2: Add the health response helper

**Files:**

- Create: `src/health/get-health.ts`
- Create: `src/health/get-health.spec.ts`

- [ ] **Step 1: Write the health helper test**

Create `src/health/get-health.spec.ts` with this content:

```ts
import { describe, expect, it } from 'bun:test';
import { getHealth } from './get-health';

describe('getHealth', () => {
  it('returns an unauthenticated OK response for probes', async () => {
    const response = getHealth();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/plain');
    expect(await response.text()).toBe('OK');
  });
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
bun test src/health/get-health.spec.ts
```

Expected: fail because `src/health/get-health.ts` does not exist.

- [ ] **Step 3: Add the health helper**

Create `src/health/get-health.ts` with this content:

```ts
import { okResponse } from '../responses';

const HEALTH_CONTENT_TYPE = 'text/plain; charset=utf-8';

/**
 * Return a lightweight unauthenticated health response for container and
 * orchestrator probes. This checks that the process is accepting requests; it
 * does not validate filesystem or S3 backend reachability.
 */
export function getHealth(): Response {
  return okResponse({
    message: 'OK',
    contentType: HEALTH_CONTENT_TYPE,
  });
}
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run:

```bash
bun test src/health/get-health.spec.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/health/get-health.ts src/health/get-health.spec.ts
git commit -m "feat(health): add health response helper"
```

## Task 3: Route and document `GET /health`

**Files:**

- Modify: `src/main.ts`
- Create: `e2e/health.e2e.spec.ts`
- Modify: `nx-cache-server.openapi.json`
- Modify: `README.md`
- Modify: `docs-site/src/content/docs/guides/deployment.md`
- Modify: `docs-site/src/content/docs/guides/configuration.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Write the `/health` e2e test**

Create `e2e/health.e2e.spec.ts` with this content:

```ts
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let baseUrl: string;
const adminToken = Bun.env.ADMIN_TOKEN ?? 'admin-token';

mock.module('../src/logger', () => ({ logger: console }));

describe('health endpoint e2e', () => {
  beforeAll(async () => {
    Bun.env.ADMIN_TOKEN = adminToken;
    Bun.env.CACHE_DIR = join(tmpdir(), `nx-cache-health-e2e-${randomUUID()}`);
    Bun.env.PORT = '4010';

    const { server } = await import('../src/main');
    baseUrl = server.url.origin;
  });

  it('returns OK without authentication', async () => {
    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/plain');
    expect(await response.text()).toBe('OK');
  });
});
```

- [ ] **Step 2: Run the e2e test to verify it fails**

Run:

```bash
bun test e2e/health.e2e.spec.ts
```

Expected: fail with status `404`, because the route is not registered yet.

- [ ] **Step 3: Add the route**

In `src/main.ts`, add this import near the other handler imports:

```ts
import { getHealth } from './health/get-health';
```

Then add this route before `/metrics`:

```ts
    '/health': {
      GET: () => getHealth(),
    },
```

The beginning of the `routes` object should look like this:

```ts
  routes: {
    '/health': {
      GET: () => getHealth(),
    },
    '/metrics': {
      GET: () => getMetrics(metrics),
    },
```

- [ ] **Step 4: Run the focused e2e test to verify it passes**

Run:

```bash
bun test e2e/health.e2e.spec.ts
```

Expected: pass.

- [ ] **Step 5: Add `/health` to OpenAPI**

In `nx-cache-server.openapi.json`, add this path object before the existing `/metrics` path:

```json
"/health": {
  "get": {
    "description": "Lightweight unauthenticated health check for container and orchestrator probes. Returns OK when the server process is running and accepting requests; it does not validate filesystem or S3 backend reachability.",
    "operationId": "getHealth",
    "security": [],
    "responses": {
      "200": {
        "description": "Server is running",
        "content": {
          "text/plain": {
            "schema": {
              "type": "string",
              "example": "OK"
            }
          }
        }
      }
    }
  }
},
```

- [ ] **Step 6: Update README features**

In `README.md`, under `## Features`, add this bullet immediately after the Prometheus metrics bullet:

```markdown
- Health check at `GET /health` (unauthenticated; process liveness)
```

In the Docker section, add this sentence after the `latest`/`edge` note:

```markdown
Health checks can call `GET /health` without a token.
```

- [ ] **Step 7: Update deployment docs**

In `docs-site/src/content/docs/guides/deployment.md`, add this section before `## Monitoring`:

````markdown
## Health checks

`GET /health` returns `200 OK` with a plain text `OK` body and does not require a token. Use it for container and orchestrator liveness/readiness checks.

This endpoint confirms the server process is running and accepting requests. It does not validate filesystem or S3 backend reachability.

```sh
curl -fsS http://localhost:3000/health
```
````

- [ ] **Step 8: Update configuration docs**

In `docs-site/src/content/docs/guides/configuration.md`, under `## Notes`, add this paragraph after the `ADMIN_TOKEN` note:

```markdown
`GET /health` has no configuration. It returns `OK` when the process is accepting requests and is intended for liveness/readiness checks.
```

- [ ] **Step 9: Update `AGENTS.md` project summary**

In `AGENTS.md`, replace this sentence:

```markdown
Self-hosted Nx Remote Cache server on the Bun runtime. Implements the Nx self-hosted remote cache HTTP API (`GET`/`PUT /v1/cache/:hash`) plus a token admin API (`/v1/admin/tokens`). See https://remotecache.dev/ for the full API surface, environment variables, and deployment; @README.md is the quickstart landing.
```

with:

```markdown
Self-hosted Nx Remote Cache server on the Bun runtime. Implements the Nx self-hosted remote cache HTTP API (`GET`/`PUT /v1/cache/:hash`), `GET /metrics`, `GET /health`, and the token admin API (`/v1/admin/tokens`). See https://remotecache.dev/ for the full API surface, environment variables, and deployment; @README.md is the quickstart landing.
```

- [ ] **Step 10: Human-facing docs pass**

Read the changed README, deployment guide, configuration guide, OpenAPI description, and AGENTS text. Keep the wording direct. Remove filler, generic conclusions, hype, and chatbot phrasing.

- [ ] **Step 11: Verify route, docs, and OpenAPI**

Run:

```bash
bun test src/health/get-health.spec.ts e2e/health.e2e.spec.ts
bun run format --check nx-cache-server.openapi.json
cd docs-site && bun run build
```

Expected:

- both health tests pass
- OpenAPI JSON format check exits `0`
- docs build exits `0` and internal links are valid

- [ ] **Step 12: Commit**

Run:

```bash
git add src/health/get-health.ts src/health/get-health.spec.ts e2e/health.e2e.spec.ts src/main.ts nx-cache-server.openapi.json README.md docs-site/src/content/docs/guides/deployment.md docs-site/src/content/docs/guides/configuration.md AGENTS.md
git commit -m "feat(health): add unauthenticated health endpoint"
```

## Task 4: Use `/health` for Docker smoke checks

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/publish-image.yml`
- Modify: `docs-site/src/content/docs/contributing/releases.md`

- [ ] **Step 1: Update CI Docker smoke**

In `.github/workflows/ci.yml`, replace the `/metrics` polling block:

```text
            if curl -fsS http://127.0.0.1:3000/metrics > /tmp/remotecache-metrics.txt; then
              cat /tmp/remotecache-metrics.txt
              exit 0
            fi
```

with:

```text
            if curl -fsS http://127.0.0.1:3000/health > /tmp/remotecache-health.txt; then
              cat /tmp/remotecache-health.txt
              exit 0
            fi
```

- [ ] **Step 2: Update publish workflow Docker smoke**

In `.github/workflows/publish-image.yml`, replace the same `/metrics` polling block with the `/health` block from Step 1.

- [ ] **Step 3: Update release docs preflight wording**

In `docs-site/src/content/docs/contributing/releases.md`, replace this sentence:

```markdown
The Docker publishing workflow runs its own preflight gate before pushing images. It repeats the root checks, docs checks, Docker smoke test, and Trivy image scan so image publishing cannot race ahead of CI.
```

with:

```markdown
The Docker publishing workflow runs its own preflight gate before pushing images. It repeats the root checks, docs checks, Docker smoke test against `/health`, and Trivy image scan so image publishing cannot race ahead of CI.
```

- [ ] **Step 4: Verify workflow references**

Run:

```bash
rg -n '127\\.0\\.0\\.1:3000/health|remotecache-health' .github/workflows/ci.yml .github/workflows/publish-image.yml
if rg -n '127\\.0\\.0\\.1:3000/metrics|remotecache-metrics' .github/workflows/ci.yml .github/workflows/publish-image.yml; then
  exit 1
fi
```

Expected: `/health` and `remotecache-health` are present in both workflows; the forbidden `/metrics` smoke-check strings are absent from those workflow files.

- [ ] **Step 5: Commit**

Run:

```bash
git add .github/workflows/ci.yml .github/workflows/publish-image.yml docs-site/src/content/docs/contributing/releases.md
git commit -m "ci: use health endpoint for docker smoke checks"
```

## Task 5: Verify the health probe phase

**Files:**

- Validate: `AGENTS.md`
- Validate: `src/health/get-health.ts`
- Validate: `src/health/get-health.spec.ts`
- Validate: `e2e/health.e2e.spec.ts`
- Validate: `src/main.ts`
- Validate: `nx-cache-server.openapi.json`
- Validate: `README.md`
- Validate: `docs-site/src/content/docs/guides/deployment.md`
- Validate: `docs-site/src/content/docs/guides/configuration.md`
- Validate: `.github/workflows/ci.yml`
- Validate: `.github/workflows/publish-image.yml`
- Validate: `docs-site/src/content/docs/contributing/releases.md`

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

- [ ] **Step 3: Run local Docker smoke against `/health`**

Run:

```bash
docker rm -f remotecache-health-check >/dev/null 2>&1 || true
docker build -t remotecache:health-check .
docker run -d --name remotecache-health-check -e ADMIN_TOKEN=test-token -p 3000:3000 remotecache:health-check
for attempt in {1..30}; do
  if curl -fsS http://127.0.0.1:3000/health > /tmp/remotecache-health.txt; then
    cat /tmp/remotecache-health.txt
    docker rm -f remotecache-health-check
    exit 0
  fi
  sleep 1
done
docker logs remotecache-health-check
docker rm -f remotecache-health-check
exit 1
```

Expected: output is `OK` and the script exits `0`.

- [ ] **Step 4: Verify OpenAPI and workflow static contract**

Run:

```bash
rg -n '"/health"|"operationId": "getHealth"|"description": "Lightweight unauthenticated health check' nx-cache-server.openapi.json
rg -n "'/health'|getHealth" src/main.ts src/health/get-health.ts
rg -n '127\\.0\\.0\\.1:3000/health' .github/workflows/ci.yml .github/workflows/publish-image.yml
```

Expected:

- OpenAPI, route, and workflow greps print matches

- [ ] **Step 5: Verify planned file scope**

Run:

```bash
git diff --name-only HEAD~4..HEAD
```

Expected paths should be limited to:

```text
.github/workflows/ci.yml
.github/workflows/publish-image.yml
AGENTS.md
README.md
docs-site/src/content/docs/contributing/releases.md
docs-site/src/content/docs/guides/configuration.md
docs-site/src/content/docs/guides/deployment.md
e2e/health.e2e.spec.ts
nx-cache-server.openapi.json
src/health/get-health.spec.ts
src/health/get-health.ts
src/main.ts
```

If another path appears, inspect it and keep it only if it directly supports this plan.

- [ ] **Step 6: Final commit if verification changed files**

If verification or formatting changed tracked files, commit them:

```bash
git add .github/workflows/ci.yml .github/workflows/publish-image.yml AGENTS.md README.md docs-site/src/content/docs/contributing/releases.md docs-site/src/content/docs/guides/configuration.md docs-site/src/content/docs/guides/deployment.md e2e/health.e2e.spec.ts nx-cache-server.openapi.json src/health/get-health.spec.ts src/health/get-health.ts src/main.ts
git commit -m "chore(health): verify probe endpoint"
```

Skip this commit if there are no changes.


## Plan self-review

- Spec coverage: covers the approved `/health` endpoint phase and prepares later Helm probes without implementing Helm.
- Plan 3 follow-up: fixes stale `AGENTS.md` Docker tag instructions before adding new behavior.
- Scope check: TLS, Helm, S3 integration, Nx e2e, and Dockerfile `HEALTHCHECK` are explicitly excluded.
- Incomplete-work scan: no markers remain.
- Prompt check: handoff prompt uses XML tags, imperative verbs, explicit constraints, and a checkable output format.
- File consistency: route names, test names, OpenAPI operation ID, workflow paths, and docs paths are consistent throughout the plan.

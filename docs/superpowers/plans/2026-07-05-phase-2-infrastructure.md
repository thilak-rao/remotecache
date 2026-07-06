# Phase 2 — Test & Release Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the test-coverage and release-engineering gaps from the 2026-07-05 audit: real S3 integration tests, HTTP-level concurrency proofs, Kubernetes install verification, native-runner binary smoke tests, deduplicated CI, bounded shutdown, startup config validation, SBOM + automated chart versioning, and the doc drift that Phase 1 left open.

**Architecture:** No new features — every server change hardens an existing behavior (config fail-fast, drain deadline). The bulk of the work is CI: a reusable checks workflow feeds both `ci.yml` and `publish-image.yml`; new jobs add MinIO-backed S3 e2e, kubeconform + kind chart verification, and a five-platform binary smoke matrix. Docs and OpenAPI updates land in the same commit as the behavior they describe.

**Tech Stack:** Bun 1.3.14 (`bun:test`, `Bun.serve`, `Bun.S3Client`, `Bun.connect`), Helm 3, kind via `helm/kind-action`, kubeconform v0.8.0, MinIO, release-please v5, anchore/sbom-action.

**Prerequisite:** Phase 1 (`2026-07-05-phase-1-hardening.md`) is merged — this plan builds on `e2e/spawn-server.ts`, `CacheEntryExistsError`, the reworked `publish-image.yml` job permissions, and the pinned `bun-version: 1.3.14`.

## Global Constraints

- Bun built-ins only: `Bun.serve`, `bun:sqlite`, `bun:test`, `Bun.env`, `bun install`. `@aws-sdk/credential-providers` is the only approved runtime dependency.
- Never call `console`; import `logger` from `src/logger.ts`. `no-explicit-any` is an error. Single quotes (oxfmt).
- Every HTTP response comes from a factory in `src/responses.ts`.
- Docs land in the same commit as the behavior change: HTTP API → `nx-cache-server.openapi.json`; env vars → `docs-site/src/content/docs/guides/configuration.md`; behavior/storage/security → the matching `docs-site` guide.
- Conventional Commits. No task in this plan is breaking (`!`) — the chart's `readOnlyRootFilesystem` default flip is called out in the chart docs instead.
- GitHub Actions are pinned by full commit SHA with a `# vX.Y.Z` comment. Bun setup steps use `bun-version: 1.3.14 # keep in sync with @types/bun`.
- All ADMIN_TOKEN values anywhere (tests, CI, docs) must be ≥ 16 characters.
- E2E port registry — never reuse: 4010 health, 4011 metrics, 4012 tokens, 4013 upload-limits, 4014 startup-validation, 4020 tls, 4030/4031 graceful-shutdown. **This plan allocates: 4015 concurrency, 4016 s3-minio, 4032 drain-deadline.**
- Verify with `bun test`, `bun run typecheck`, `bun run lint`, `bun run format --check` before every commit.

---

### Task 1: Fail at startup on unknown `STORAGE_STRATEGY` or unwritable `CACHE_DIR`

Today `createCacheStorage` silently treats any non-`s3` value (typo'd `S3`, future `gcs`) as filesystem, and an unwritable `CACHE_DIR` only surfaces on the first upload. Both must fail loudly at boot.

**Files:**

- Modify: `src/cache/create-cache-storage.ts`
- Modify: `src/cache/create-cache-storage.spec.ts`
- Modify: `src/main.ts:24` (wrap storage creation)
- Modify: `e2e/startup-validation.e2e.spec.ts`
- Modify: `docs-site/src/content/docs/guides/configuration.md:16`, `docs-site/src/content/docs/guides/storage-strategies.md:10`

**Interfaces:**

- Consumes: `createCacheStorage(env: typeof Bun.env): CacheStorageStrategy` (existing).
- Produces: same signature, but now `@throws` on unknown strategy or unwritable dir. `main.ts` catches, logs, exits 1.

- [ ] **Step 1: Write the failing unit tests**

Append to `src/cache/create-cache-storage.spec.ts` (extend the existing imports):

```ts
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCacheStorage, resolveS3Config } from './create-cache-storage';
```

(`resolveS3Config` is already imported on line 2 — merge, don't duplicate.) Then add:

```ts
describe('createCacheStorage', () => {
  it('throws on an unknown STORAGE_STRATEGY', () => {
    expect(() => createCacheStorage(asEnv({ STORAGE_STRATEGY: 'gcs' }))).toThrow(
      /Unknown STORAGE_STRATEGY "gcs"/,
    );
  });

  it('throws when CACHE_DIR cannot be created or written', () => {
    const base = mkdtempSync(join(tmpdir(), 'rc-config-'));
    chmodSync(base, 0o500);
    try {
      expect(() => createCacheStorage(asEnv({ CACHE_DIR: join(base, 'cache') }))).toThrow(
        /not writable/,
      );
    } finally {
      chmodSync(base, 0o700);
      rmSync(base, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run to verify both fail**

Run: `bun test src/cache/create-cache-storage.spec.ts`
Expected: 2 fail (no throw on `gcs`; no throw on read-only dir).

- [ ] **Step 3: Implement**

In `src/cache/create-cache-storage.ts`, add to the imports:

```ts
import { accessSync, constants, mkdirSync } from 'node:fs';
```

Add above `createCacheStorage`:

```ts
function assertWritableDir(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
  } catch (error) {
    throw new Error(
      `CACHE_DIR "${dir}" is not writable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
```

Replace the body of `createCacheStorage` (keep the s3 branch untouched) and add a JSDoc:

```ts
/**
 * Build the configured storage backend. Fails fast instead of falling back:
 * an unknown `STORAGE_STRATEGY` or an unwritable `CACHE_DIR` is a deployment
 * mistake that should stop the server at boot, not surface as 500s at the
 * first upload.
 *
 * @throws on unknown `STORAGE_STRATEGY`, unwritable `CACHE_DIR`, or invalid S3
 * settings (see {@link resolveS3Config}).
 */
export function createCacheStorage(env: typeof Bun.env): CacheStorageStrategy {
  const kind = (env.STORAGE_STRATEGY ?? 'filesystem').toLowerCase();
  if (kind === 's3') {
    const cfg = resolveS3Config(env);
    const credentials = cfg.mode === 'static' ? cfg.credentials : fromNodeProviderChain();
    return new S3Strategy({
      bucket: cfg.bucket,
      region: cfg.region,
      endpoint: cfg.endpoint,
      credentials,
    });
  }

  if (kind !== 'filesystem') {
    throw new Error(
      `Unknown STORAGE_STRATEGY "${env.STORAGE_STRATEGY}". Use "filesystem" or "s3".`,
    );
  }

  const cacheDir = env.CACHE_DIR ?? './cache';
  assertWritableDir(cacheDir);
  return new FileSystemStrategy(cacheDir);
}
```

In `src/main.ts`, add the type import and replace line 24 (`const storage = createCacheStorage(Bun.env);`):

```ts
import type { CacheStorageStrategy } from './cache/storage-strategy/storage-strategy.interface';
```

```ts
let storage: CacheStorageStrategy;
try {
  storage = createCacheStorage(Bun.env);
} catch (error) {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
```

(`process.exit` returns `never`, so TypeScript's flow analysis treats `storage` as definitely assigned afterwards — the typecheck in Step 5 confirms.)

- [ ] **Step 4: Add the e2e exit-code test**

Append to the `describe` block in `e2e/startup-validation.e2e.spec.ts`:

```ts
it('refuses to start on an unknown STORAGE_STRATEGY', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rc-startup-storage-'));
  const proc = Bun.spawn(['bun', 'src/main.ts'], {
    env: {
      ...Bun.env,
      ADMIN_TOKEN: 'e2e-admin-token-0123456789abcdef',
      PORT: '4014',
      STORAGE_STRATEGY: 'gcs',
      CACHE_DIR: join(dir, 'cache'),
      TOKENS_DB_PATH: join(dir, 'tokens.sqlite'),
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const exitCode = await proc.exited;
  const stderr = await new Response(proc.stderr).text();
  rmSync(dir, { recursive: true, force: true });

  expect(exitCode).toBe(1);
  expect(stderr).toContain('Unknown STORAGE_STRATEGY');
});
```

- [ ] **Step 5: Run the full gate**

Run: `bun test && bun run typecheck && bun run lint`
Expected: all pass, 0 fail.

- [ ] **Step 6: Update docs (same commit)**

`docs-site/src/content/docs/guides/configuration.md` line 16 — replace the `STORAGE_STRATEGY` row description with:

```
| `STORAGE_STRATEGY`     | no       | filesystem                             | `filesystem` or `s3`. Any other value refuses to start.                                      |
```

`docs-site/src/content/docs/guides/storage-strategies.md` line 10 — replace the first sentence of the Filesystem section with:

```md
When `STORAGE_STRATEGY` is unset or `filesystem`, cache entries are stored on disk under `CACHE_DIR` (default: `./cache`). Any other value except `s3` fails at startup, as does a `CACHE_DIR` the server cannot create or write — misconfiguration surfaces at boot, not as `500`s on the first upload.
```

- [ ] **Step 7: Commit**

```bash
git add src/cache/create-cache-storage.ts src/cache/create-cache-storage.spec.ts src/main.ts e2e/startup-validation.e2e.spec.ts docs-site/src/content/docs/guides/configuration.md docs-site/src/content/docs/guides/storage-strategies.md
git commit -m "fix(config): fail at startup on unknown STORAGE_STRATEGY or unwritable CACHE_DIR"
```

---

### Task 2: Bound the shutdown drain with `SHUTDOWN_DRAIN_TIMEOUT_MS`

`shutdown()` waits for uploads forever — a slow-loris client can hold the process past Kubernetes' grace period until SIGKILL. Bound the drain with a deadline.

**Files:**

- Modify: `src/main.ts` (const + validation + `shutdown`)
- Modify: `e2e/graceful-shutdown.e2e.spec.ts` (port 4032)
- Modify: `docs-site/src/content/docs/guides/configuration.md`, `docs-site/src/content/docs/deploy/kubernetes.md:54`, `CLAUDE.md`

**Interfaces:**

- Consumes: `waitForUploadsToDrain(): Promise<void>` (existing in `src/main.ts`).
- Produces: env var `SHUTDOWN_DRAIN_TIMEOUT_MS` (default `30000`, must be a positive number).

- [ ] **Step 1: Write the failing e2e test**

Append to the `describe` block in `e2e/graceful-shutdown.e2e.spec.ts`:

```ts
it('exits after SHUTDOWN_DRAIN_TIMEOUT_MS when an upload stalls', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rc-sigterm-stall-'));
  const port = 4032;
  const proc = Bun.spawn(['bun', 'src/main.ts'], {
    env: {
      ...Bun.env,
      ADMIN_TOKEN: 'e2e-admin-token-0123456789abcdef',
      PORT: String(port),
      CACHE_DIR: join(dir, 'cache'),
      TOKENS_DB_PATH: join(dir, 'tokens.sqlite'),
      SHUTDOWN_DRAIN_TIMEOUT_MS: '500',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  let up = false;
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) {
        up = true;
        break;
      }
    } catch {}
    await Bun.sleep(100);
  }
  expect(up).toBe(true);

  // Start an upload and never finish the body: without a deadline the drain
  // would wait forever and SIGKILL (exit code ≠ 0) would be the only way out.
  const socket = await Bun.connect({
    hostname: '127.0.0.1',
    port,
    socket: { data() {}, close() {}, error() {} },
  });
  socket.write(
    `PUT /v1/cache/stalleduploadhash1 HTTP/1.1\r\n` +
      `Host: 127.0.0.1:${port}\r\n` +
      `Authorization: Bearer e2e-admin-token-0123456789abcdef\r\n` +
      `Content-Length: 2000\r\n` +
      `Connection: close\r\n\r\n`,
  );
  socket.write('x'.repeat(100));
  await Bun.sleep(150);

  const started = performance.now();
  proc.kill('SIGTERM');
  const exitCode = await proc.exited;
  const elapsed = performance.now() - started;
  socket.end();
  rmSync(dir, { recursive: true, force: true });

  expect(exitCode).toBe(0);
  expect(elapsed).toBeGreaterThanOrEqual(400);
  expect(elapsed).toBeLessThan(5000);
}, 15000);
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test e2e/graceful-shutdown.e2e.spec.ts`
Expected: the new test FAILS by timeout (the drain never resolves; the 15 s test deadline fires).

- [ ] **Step 3: Implement**

In `src/main.ts`, add below the `MAX_UPLOAD_BYTES` const (line 23):

```ts
const SHUTDOWN_DRAIN_TIMEOUT_MS = Number(Bun.env.SHUTDOWN_DRAIN_TIMEOUT_MS ?? '30000');
```

Add below the `MAX_UPLOAD_BYTES` validation block:

```ts
if (!Number.isFinite(SHUTDOWN_DRAIN_TIMEOUT_MS) || SHUTDOWN_DRAIN_TIMEOUT_MS <= 0) {
  logger.error('Error: SHUTDOWN_DRAIN_TIMEOUT_MS environment variable must be a positive number.');
  process.exit(1);
}
```

In `shutdown`, replace `await waitForUploadsToDrain();` (and its comment's last sentence) with:

```ts
// Drain active uploads before stopping; `server.stop()` would otherwise
// close their connections. The deadline stops a stalled client (slow-loris
// upload) from holding the process past the orchestrator's grace period.
await Promise.race([waitForUploadsToDrain(), Bun.sleep(SHUTDOWN_DRAIN_TIMEOUT_MS)]);
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test e2e/graceful-shutdown.e2e.spec.ts && bun test && bun run typecheck && bun run lint`
Expected: all pass — including the two pre-existing drain tests (their uploads finish well before 30 s).

- [ ] **Step 5: Update docs (same commit)**

`docs-site/src/content/docs/guides/configuration.md` — add a row after `MAX_UPLOAD_BYTES` (line 15):

```
| `SHUTDOWN_DRAIN_TIMEOUT_MS` | no  | `30000`                                | Max wait for in-flight uploads on `SIGTERM`/`SIGINT` before the server exits anyway.         |
```

And extend the `BIND_ADDRESS` notes paragraph (line 51) — after "…wait for active uploads to finish." append:

```md
The drain is bounded by `SHUTDOWN_DRAIN_TIMEOUT_MS` (default 30 s), so a stalled client cannot hold the process open indefinitely.
```

`docs-site/src/content/docs/deploy/kubernetes.md` line 54 — after "no extra `preStop` hook is needed." append:

```md
The drain is bounded at 30 s by default (`SHUTDOWN_DRAIN_TIMEOUT_MS`); keep `terminationGracePeriodSeconds` above it.
```

`CLAUDE.md` — in the `bun run serve` bullet, change "The server drains in-flight requests on `SIGTERM`/`SIGINT`." to:

```md
The server drains in-flight requests on `SIGTERM`/`SIGINT`, bounded by `SHUTDOWN_DRAIN_TIMEOUT_MS` (default 30 s).
```

- [ ] **Step 6: Commit**

```bash
git add src/main.ts e2e/graceful-shutdown.e2e.spec.ts docs-site/src/content/docs/guides/configuration.md docs-site/src/content/docs/deploy/kubernetes.md CLAUDE.md
git commit -m "fix(server): bound the shutdown drain with SHUTDOWN_DRAIN_TIMEOUT_MS"
```

---

### Task 3: Concurrency and truncated-upload e2e over real sockets

Phase 1 proved first-writer-wins at the strategy layer (`file-system.spec.ts`). This proves it through the whole HTTP stack, plus that a client disconnect mid-body never leaves a partial artifact. Note: an _overlong_ body can't be tested over HTTP — Content-Length framing means the server never reads past the declared length — so the disconnect (truncation) case is the real-socket-reachable one; the overrun path stays covered by `write-cache.spec.ts`.

**Files:**

- Create: `e2e/concurrency.e2e.spec.ts` (port 4015)

**Interfaces:**

- Consumes: `spawnServer(port, env?)`, `E2E_ADMIN_TOKEN`, `SpawnedServer` from `e2e/spawn-server.ts`.

- [ ] **Step 1: Write the spec**

Create `e2e/concurrency.e2e.spec.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { E2E_ADMIN_TOKEN, spawnServer, type SpawnedServer } from './spawn-server';

const PORT = 4015;

interface RawConnection {
  write: (data: string | Uint8Array) => void;
  end: () => void;
  response: Promise<string>;
}

// Raw TCP so a request body can be streamed in stages; fetch() buffers the
// body, which would let one PUT fully commit before the other starts.
async function openConnection(): Promise<RawConnection> {
  let text = '';
  let resolveResponse: (v: string) => void;
  const received = new Promise<string>((resolve) => {
    resolveResponse = resolve;
  });
  const socket = await Bun.connect({
    hostname: '127.0.0.1',
    port: PORT,
    socket: {
      data(_s, data) {
        text += new TextDecoder().decode(data);
      },
      close() {
        resolveResponse(text);
      },
      error() {
        resolveResponse(text);
      },
    },
  });
  return {
    write: (data) => void socket.write(data),
    end: () => socket.end(),
    response: Promise.race([received, Bun.sleep(10000).then(() => '__TIMEOUT__')]),
  };
}

const putHead = (hash: string, contentLength: number) =>
  `PUT /v1/cache/${hash} HTTP/1.1\r\n` +
  `Host: 127.0.0.1:${PORT}\r\n` +
  `Authorization: Bearer ${E2E_ADMIN_TOKEN}\r\n` +
  `Content-Length: ${contentLength}\r\n` +
  `Connection: close\r\n\r\n`;

describe('cache concurrency e2e', () => {
  let server: SpawnedServer;

  beforeAll(async () => {
    server = await spawnServer(PORT);
  });

  afterAll(async () => {
    await server.stop();
  });

  it('resolves two concurrent uploads of one hash to a single 200 and a 409', async () => {
    const hash = 'concurrentputhash01';
    const size = 64 * 1024;
    const bodyA = new Uint8Array(size).fill(65); // 'A'
    const bodyB = new Uint8Array(size).fill(66); // 'B'

    const a = await openConnection();
    const b = await openConnection();

    // Interleave so both requests pass the exists() check before either commits.
    a.write(putHead(hash, size));
    b.write(putHead(hash, size));
    a.write(bodyA.slice(0, size / 2));
    b.write(bodyB.slice(0, size / 2));
    await Bun.sleep(150);
    a.write(bodyA.slice(size / 2));
    b.write(bodyB.slice(size / 2));

    const statuses = [await a.response, await b.response].map((r) => r.split(' ')[1]);
    expect(statuses.toSorted()).toEqual(['200', '409']);

    const res = await fetch(`${server.baseUrl}/v1/cache/${hash}`, {
      headers: { Authorization: `Bearer ${E2E_ADMIN_TOKEN}` },
    });
    expect(res.status).toBe(200);
    const stored = new Uint8Array(await res.arrayBuffer());
    expect(stored.length).toBe(size);
    // First-writer-wins must commit one intact artifact, never an interleaving.
    const first = stored[0];
    expect(stored.every((byte) => byte === first)).toBe(true);
  }, 20000);

  it('never stores a truncated upload after a client disconnect mid-body', async () => {
    const hash = 'truncatedputhash01';
    const conn = await openConnection();
    conn.write(putHead(hash, 1000));
    conn.write(new Uint8Array(500).fill(67));
    conn.end();
    await conn.response;
    await Bun.sleep(300);

    const res = await fetch(`${server.baseUrl}/v1/cache/${hash}`, {
      headers: { Authorization: `Bearer ${E2E_ADMIN_TOKEN}` },
    });
    expect(res.status).toBe(404);
  }, 15000);
});
```

- [ ] **Step 2: Run it**

Run: `bun test e2e/concurrency.e2e.spec.ts`
Expected: PASS (Phase 1's `link()` commit makes it pass already — this is a regression net, verifying the guarantee holds through `Bun.serve`, `writeCache`, and the strategy together).

- [ ] **Step 3: Run the full gate and commit**

Run: `bun test && bun run lint && bun run format --check`

```bash
git add e2e/concurrency.e2e.spec.ts
git commit -m "test(e2e): prove first-writer-wins over HTTP and drop truncated uploads"
```

---

### Task 4: Extract the reusable checks workflow

`ci.yml`'s `test` job and `publish-image.yml`'s `preflight` duplicate 10 steps; they have already drifted once. Extract to a `workflow_call` workflow.

**Files:**

- Create: `.github/workflows/checks.yml`
- Modify: `.github/workflows/ci.yml` (replace `test` job body)
- Modify: `.github/workflows/publish-image.yml` (split `preflight` into `checks` + `image-check`; update `needs`)

**Interfaces:**

- Produces: reusable workflow `./.github/workflows/checks.yml` (no inputs/outputs). Later tasks reference jobs `checks` and `image-check` in `needs`.

- [ ] **Step 1: Create `.github/workflows/checks.yml`**

```yaml
name: Checks

on:
  workflow_call:

permissions:
  contents: read

jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0

      - name: Set up Bun
        uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0
        with:
          bun-version: 1.3.14 # keep in sync with @types/bun

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Format check
        run: bun run format --check

      - name: Lint
        run: bun run lint

      - name: Typecheck
        run: bun run typecheck

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
```

- [ ] **Step 2: Point `ci.yml` at it**

Replace the entire `test` job in `.github/workflows/ci.yml` (lines 16–55) with:

```yaml
test:
  uses: ./.github/workflows/checks.yml
  permissions:
    contents: read
```

Leave `docker-smoke` (`needs: test`), `helm`, and `security` untouched.

- [ ] **Step 3: Split `publish-image.yml`'s preflight**

Replace the `preflight` job with two jobs — `checks` (the reusable call) and `image-check` (the Docker-specific steps that were previously inside preflight, verbatim):

```yaml
checks:
  uses: ./.github/workflows/checks.yml
  permissions:
    contents: read

image-check:
  runs-on: ubuntu-latest
  permissions:
    contents: read
    security-events: write
  steps:
    - name: Checkout
      uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0

    - name: Build local Docker image
      run: docker build -t remotecache:publish-check .

    - name: Start Docker container
      run: docker run -d --name remotecache-publish-check -e ADMIN_TOKEN=ci-smoke-admin-token-0123456789 -p 3000:3000 remotecache:publish-check

    - name: Wait for server
      run: |
        for attempt in {1..30}; do
          if curl -fsS http://127.0.0.1:3000/health > /tmp/remotecache-health.txt; then
            cat /tmp/remotecache-health.txt
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
```

Then change every `needs: preflight` (`publish`, `publish-helm`, `publish-binaries`) to `needs: [checks, image-check]`.

- [ ] **Step 4: Validate the YAML**

Run: `bunx yaml-lint .github/workflows/checks.yml .github/workflows/ci.yml .github/workflows/publish-image.yml || bun -e "for (const f of ['checks','ci','publish-image']) { Bun.YAML.parse(await Bun.file('.github/workflows/'+f+'.yml').text()); console.log(f, 'ok'); }"`
Expected: all three parse. (Full behavior verification happens on the PR run in Task 11.)

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/checks.yml .github/workflows/ci.yml .github/workflows/publish-image.yml
git commit -m "ci: extract shared checks into a reusable workflow"
```

---

### Task 5: MinIO-backed S3 e2e in CI

The S3 strategy has unit tests with mocked clients but has never been run against a real S3 API in CI. Add an env-gated e2e spec plus a CI job that boots MinIO.

**Files:**

- Create: `e2e/s3-minio.e2e.spec.ts` (port 4016)
- Modify: `.github/workflows/ci.yml` (new `s3-e2e` job)

**Interfaces:**

- Consumes: `spawnServer(port, env?)`, `E2E_ADMIN_TOKEN` from `e2e/spawn-server.ts`.
- Produces: env contract `S3_E2E_ENDPOINT` (spec skips when unset), optional `S3_E2E_BUCKET`/`S3_E2E_ACCESS_KEY`/`S3_E2E_SECRET_KEY` (default `remotecache-e2e`/`minioadmin`/`minioadmin`).

- [ ] **Step 1: Write the spec**

Create `e2e/s3-minio.e2e.spec.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { E2E_ADMIN_TOKEN, spawnServer, type SpawnedServer } from './spawn-server';

// Skipped unless S3_E2E_ENDPOINT is set. Run locally with:
//   docker run -d --name minio -p 9000:9000 \
//     -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin \
//     minio/minio:RELEASE.2025-10-15T17-29-55Z server /data
//   AWS_ACCESS_KEY_ID=minioadmin AWS_SECRET_ACCESS_KEY=minioadmin \
//     aws --endpoint-url http://127.0.0.1:9000 --region us-east-1 s3 mb s3://remotecache-e2e
//   S3_E2E_ENDPOINT=http://127.0.0.1:9000 bun test e2e/s3-minio.e2e.spec.ts
const ENDPOINT = Bun.env.S3_E2E_ENDPOINT;
const PORT = 4016;
// Unique per run: bucket contents persist across runs and writes are
// append-only, so a fixed hash would 409 on the second run.
const nonce = crypto.randomUUID().replaceAll('-', '').slice(0, 12);

const authHeaders = { Authorization: `Bearer ${E2E_ADMIN_TOKEN}` };

describe.skipIf(!ENDPOINT)('s3 storage e2e (MinIO)', () => {
  let server: SpawnedServer;

  beforeAll(async () => {
    server = await spawnServer(PORT, {
      STORAGE_STRATEGY: 's3',
      S3_BUCKET: Bun.env.S3_E2E_BUCKET ?? 'remotecache-e2e',
      S3_REGION: 'us-east-1',
      S3_ENDPOINT: ENDPOINT as string,
      S3_ACCESS_KEY_ID: Bun.env.S3_E2E_ACCESS_KEY ?? 'minioadmin',
      S3_SECRET_ACCESS_KEY: Bun.env.S3_E2E_SECRET_KEY ?? 'minioadmin',
    });
  });

  afterAll(async () => {
    await server.stop();
  });

  it('round-trips a multipart-sized artifact intact', async () => {
    const hash = `s3multipart${nonce}`;
    // 6 MiB crosses the 5 MiB part boundary: multipart upload + flush batching.
    const body = new Uint8Array(6 * 1024 * 1024).map((_, i) => i % 251);

    const put = await fetch(`${server.baseUrl}/v1/cache/${hash}`, {
      method: 'PUT',
      headers: authHeaders,
      body,
    });
    expect(put.status).toBe(200);

    const get = await fetch(`${server.baseUrl}/v1/cache/${hash}`, { headers: authHeaders });
    expect(get.status).toBe(200);
    expect(get.headers.get('Content-Length')).toBe(String(body.length));
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(body);
  }, 60000);

  it('returns 409 for a second upload of the same hash', async () => {
    const hash = `s3conflict${nonce}`;
    const body = new Uint8Array(1024).fill(1);

    const first = await fetch(`${server.baseUrl}/v1/cache/${hash}`, {
      method: 'PUT',
      headers: authHeaders,
      body,
    });
    expect(first.status).toBe(200);

    const second = await fetch(`${server.baseUrl}/v1/cache/${hash}`, {
      method: 'PUT',
      headers: authHeaders,
      body,
    });
    expect(second.status).toBe(409);
  }, 30000);

  it('returns 404 for a missing hash', async () => {
    const res = await fetch(`${server.baseUrl}/v1/cache/s3missing${nonce}`, {
      headers: authHeaders,
    });
    expect(res.status).toBe(404);
  });

  it('aborts the multipart upload when the client disconnects mid-body', async () => {
    const hash = `s3truncated${nonce}`;
    const declared = 6 * 1024 * 1024;
    // Raw socket: declare 6 MiB, send 1 MiB, hang up. The strategy must abort
    // the multipart upload so no truncated object is ever committed.
    const socket = await Bun.connect({
      hostname: '127.0.0.1',
      port: PORT,
      socket: { data() {}, close() {}, error() {} },
    });
    socket.write(
      `PUT /v1/cache/${hash} HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${PORT}\r\n` +
        `Authorization: Bearer ${E2E_ADMIN_TOKEN}\r\n` +
        `Content-Length: ${declared}\r\n` +
        `Connection: close\r\n\r\n`,
    );
    socket.write(new Uint8Array(1024 * 1024).fill(2));
    await Bun.sleep(200);
    socket.end();
    await Bun.sleep(1000);

    const res = await fetch(`${server.baseUrl}/v1/cache/${hash}`, { headers: authHeaders });
    expect(res.status).toBe(404);
  }, 30000);
});
```

- [ ] **Step 2: Verify the skip path, then the live path**

Run: `bun test e2e/s3-minio.e2e.spec.ts`
Expected: all tests skip (no `S3_E2E_ENDPOINT`).

Then run the three `docker run` / `aws s3 mb` / `S3_E2E_ENDPOINT=… bun test` commands from the spec's header comment.
Expected: 4 pass. Clean up with `docker rm -f minio`.

- [ ] **Step 3: Add the CI job**

Append to `jobs:` in `.github/workflows/ci.yml`:

```yaml
s3-e2e:
  runs-on: ubuntu-latest
  steps:
    - name: Checkout
      uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0

    - name: Set up Bun
      uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0
      with:
        bun-version: 1.3.14 # keep in sync with @types/bun

    - name: Install dependencies
      run: bun install --frozen-lockfile

    - name: Start MinIO
      run: |
        docker run -d --name minio -p 9000:9000 \
          -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin \
          minio/minio:RELEASE.2025-10-15T17-29-55Z server /data
        for attempt in {1..30}; do
          if curl -fsS http://127.0.0.1:9000/minio/health/live; then exit 0; fi
          sleep 1
        done
        docker logs minio
        exit 1

    - name: Create bucket
      env:
        AWS_ACCESS_KEY_ID: minioadmin
        AWS_SECRET_ACCESS_KEY: minioadmin
      run: aws --endpoint-url http://127.0.0.1:9000 --region us-east-1 s3 mb s3://remotecache-e2e

    - name: Run S3 e2e
      env:
        S3_E2E_ENDPOINT: http://127.0.0.1:9000
      run: bun test e2e/s3-minio.e2e.spec.ts

    - name: Stop MinIO
      if: always()
      run: docker rm -f minio || true
```

- [ ] **Step 4: Commit**

```bash
git add e2e/s3-minio.e2e.spec.ts .github/workflows/ci.yml
git commit -m "test(e2e): exercise the S3 strategy against MinIO in CI"
```

---

### Task 6: Helm test hook, kubeconform validation, and a kind install test

`helm template` proves the chart renders; nothing proves the manifests are schema-valid or that the chart actually deploys. Add all three layers.

**Files:**

- Create: `charts/remotecache/templates/tests/test-connection.yaml`
- Modify: `.github/workflows/ci.yml` (`helm` job + new `helm-install` job)
- Modify: `docs-site/src/content/docs/deploy/kubernetes.md`, `docs-site/src/content/docs/contributing/releases.md:43`

**Interfaces:**

- Consumes: `remotecache.fullname`, `remotecache.labels` helpers (`_helpers.tpl`); Service port `http` (`service.yaml`).
- Produces: `helm test <release>` hook. CI jobs `helm` (extended) and `helm-install`.

- [ ] **Step 1: Add the test hook pod**

Create `charts/remotecache/templates/tests/test-connection.yaml`:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: {{ include "remotecache.fullname" . }}-test-connection
  labels:
    {{- include "remotecache.labels" . | nindent 4 }}
  annotations:
    helm.sh/hook: test
    helm.sh/hook-delete-policy: before-hook-creation,hook-succeeded
spec:
  restartPolicy: Never
  containers:
    - name: health-check
      image: busybox:1.37
      command:
        - wget
        - '-q'
        - '-O-'
        {{- if .Values.tls.enabled }}
        - '--no-check-certificate'
        {{- end }}
        - '{{ if .Values.tls.enabled }}https{{ else }}http{{ end }}://{{ include "remotecache.fullname" . }}:{{ .Values.service.port }}/health'
```

Run: `helm template rc charts/remotecache --set adminToken=ci-admin-token-0123456789 | grep -A5 test-connection`
Expected: the pod renders with the hook annotation.

- [ ] **Step 2: Add kubeconform to the `helm` job**

Append these steps to the `helm` job in `.github/workflows/ci.yml` (after the last `Helm template` step):

```yaml
- name: Install kubeconform
  run: curl -sSL https://github.com/yannh/kubeconform/releases/download/v0.8.0/kubeconform-linux-amd64.tar.gz | tar xz kubeconform

- name: Validate manifests with kubeconform
  run: |
    for values in charts/remotecache/ci/*.yaml; do
      echo "--- $values"
      helm template rc charts/remotecache -f "$values" \
        | ./kubeconform -strict -summary -ignore-missing-schemas
    done
```

(`-ignore-missing-schemas` is for CRDs without upstream JSON schemas — Task 8's ServiceMonitor needs it.)

- [ ] **Step 3: Add the kind install job**

Append to `jobs:` in `.github/workflows/ci.yml`:

```yaml
helm-install:
  runs-on: ubuntu-latest
  needs: helm
  steps:
    - name: Checkout
      uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0

    - name: Build image
      run: docker build -t remotecache:kind-ci .

    - name: Create kind cluster
      uses: helm/kind-action@ef37e7f390d99f746eb8b610417061a60e82a6cc # v1.14.0

    - name: Load image into kind
      run: kind load docker-image remotecache:kind-ci --name chart-testing

    - name: Install chart
      run: |
        helm install rc charts/remotecache \
          --set adminToken=ci-admin-token-0123456789 \
          --set image.repository=remotecache \
          --set image.tag=kind-ci \
          --set image.pullPolicy=Never \
          --wait --timeout 180s

    - name: Run chart test hook
      run: helm test rc --logs

    - name: Diagnose failure
      if: failure()
      run: |
        kubectl get pods,pvc -o wide
        kubectl describe pods
        kubectl logs -l app.kubernetes.io/instance=rc --tail=100 || true
```

- [ ] **Step 4: Update docs (same commit)**

`docs-site/src/content/docs/deploy/kubernetes.md` — after the install instructions, add:

```md
Verify a deployed release with `helm test <release>` — it runs an in-cluster pod that curls the service's `/health` endpoint.
```

`docs-site/src/content/docs/contributing/releases.md` line 43 — replace "PR CI runs `helm lint` and `helm template` against the chart in `charts/remotecache/` (filesystem, S3, and TLS value sets)." with:

```md
PR CI runs `helm lint`, `helm template` (filesystem, S3, and TLS value sets), kubeconform schema validation, and a full `helm install` + `helm test` against a kind cluster for the chart in `charts/remotecache/`.
```

- [ ] **Step 5: Verify and commit**

Run: `helm lint charts/remotecache --set adminToken=ci-admin-token-0123456789 && bun run format --check`
Expected: chart lints clean.

```bash
git add charts/remotecache/templates/tests/test-connection.yaml .github/workflows/ci.yml docs-site/src/content/docs/deploy/kubernetes.md docs-site/src/content/docs/contributing/releases.md
git commit -m "ci(helm): add kubeconform validation, a helm test hook, and a kind install test"
```

---

### Task 7: Binary smoke matrix on native runners

Releases ship five binaries but only linux-x64 is ever executed. Smoke all five on native runners (GitHub provides free arm64 Linux and Apple Silicon runners for public repos — no QEMU needed).

**Files:**

- Modify: `.github/workflows/publish-image.yml` (split `publish-binaries` into `build-binaries` → `smoke-binaries` matrix → `publish-binaries`)
- Modify: `docs-site/src/content/docs/contributing/releases.md`

**Interfaces:**

- Consumes: `scripts/build-binaries.sh <version>` (existing); jobs `checks`, `image-check` from Task 4.
- Produces: artifact `binaries` (the `dist/` directory) shared across the three jobs.

- [ ] **Step 1: Restructure the jobs**

In `.github/workflows/publish-image.yml`, replace the single `publish-binaries` job with three:

```yaml
build-binaries:
  runs-on: ubuntu-latest
  needs: [checks, image-check]
  if: startsWith(github.ref, 'refs/tags/v')
  permissions:
    contents: read
  steps:
    - name: Checkout
      uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0

    - name: Set up Bun
      uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0
      with:
        bun-version: 1.3.14 # keep in sync with @types/bun

    - name: Install dependencies
      run: bun install --frozen-lockfile

    - name: Build binaries
      run: bash scripts/build-binaries.sh "${GITHUB_REF_NAME#v}"

    - name: Upload binaries artifact
      uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
      with:
        name: binaries
        path: dist/
        if-no-files-found: error

smoke-binaries:
  needs: build-binaries
  if: startsWith(github.ref, 'refs/tags/v')
  permissions:
    contents: read
  strategy:
    matrix:
      include:
        - os: ubuntu-latest
          suffix: linux-x64
        - os: ubuntu-24.04-arm
          suffix: linux-arm64
        - os: macos-15-intel
          suffix: darwin-x64
        - os: macos-15
          suffix: darwin-arm64
        - os: windows-latest
          suffix: windows-x64
          ext: .exe
  runs-on: ${{ matrix.os }}
  steps:
    - name: Download binaries
      uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1
      with:
        name: binaries
        path: dist

    - name: Smoke test binary
      shell: bash
      run: |
        BIN="dist/remotecache-${GITHUB_REF_NAME#v}-${{ matrix.suffix }}${{ matrix.ext }}"
        chmod +x "$BIN"
        ADMIN_TOKEN=smoke-admin-token-0123456789 "$BIN" &
        SERVER_PID=$!
        for attempt in {1..30}; do
          if curl -fsS http://127.0.0.1:3000/health; then
            echo " <- health OK"
            kill "$SERVER_PID" || true
            exit 0
          fi
          sleep 1
        done
        echo "binary failed health check"
        kill "$SERVER_PID" || true
        exit 1

publish-binaries:
  runs-on: ubuntu-latest
  needs: [build-binaries, smoke-binaries]
  if: startsWith(github.ref, 'refs/tags/v')
  permissions:
    contents: write
    id-token: write
    attestations: write
  steps:
    - name: Download binaries
      uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1
      with:
        name: binaries
        path: dist

    - name: Upload release assets
      env:
        GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      run: |
        TAG="${GITHUB_REF_NAME}"
        VERSION="${TAG#v}"
        PRERELEASE=""
        case "$VERSION" in *-*) PRERELEASE="--prerelease" ;; esac
        if ! gh release view "$TAG" >/dev/null 2>&1; then
          gh release create "$TAG" --title "$TAG" --generate-notes $PRERELEASE
        fi
        gh release upload "$TAG" dist/remotecache-* dist/checksums.txt --clobber

    - name: Attest binary provenance
      uses: actions/attest-build-provenance@0f67c3f4856b2e3261c31976d6725780e5e4c373 # v4.1.1
      with:
        subject-path: 'dist/remotecache-*'
```

(The old job's checkout/bun/build/single-smoke steps are gone; `gh release` needs a checkout-free `GH_TOKEN` invocation, which works because `gh` infers the repo from `GITHUB_REPOSITORY`. If the run fails with "not a git repository", add the pinned checkout step to `publish-binaries` first.)

- [ ] **Step 2: Update docs (same commit)**

`docs-site/src/content/docs/contributing/releases.md`, Publishing section — after the sentence about attaching binaries, add:

```md
Before upload, every binary is smoke-tested against `/health` on a native runner for its platform (linux x64/arm64, macOS x64/arm64, Windows x64).
```

- [ ] **Step 3: Validate YAML and commit**

Run: `bun -e "Bun.YAML.parse(await Bun.file('.github/workflows/publish-image.yml').text()); console.log('ok')"`

```bash
git add .github/workflows/publish-image.yml docs-site/src/content/docs/contributing/releases.md
git commit -m "ci(release): smoke test all release binaries on native runners"
```

---

### Task 8: Helm extras — ServiceMonitor, PDB, Ingress, read-only root filesystem

**Files:**

- Create: `charts/remotecache/templates/servicemonitor.yaml`, `charts/remotecache/templates/pdb.yaml`, `charts/remotecache/templates/ingress.yaml`, `charts/remotecache/ci/extras-values.yaml`
- Modify: `charts/remotecache/values.yaml`, `charts/remotecache/templates/deployment.yaml`, `.github/workflows/ci.yml` (`helm` job template step)
- Modify: `docs-site/src/content/docs/deploy/kubernetes.md`

**Interfaces:**

- Consumes: `remotecache.fullname`, `remotecache.labels`, `remotecache.selectorLabels` (`_helpers.tpl`); Service port name `http` (`service.yaml:13`).
- Produces: values keys `metrics.serviceMonitor.*`, `podDisruptionBudget.*`, `ingress.*`; `securityContext.readOnlyRootFilesystem: true` default.

- [ ] **Step 1: Add values**

In `charts/remotecache/values.yaml`, insert after the `service:` block (line 88):

```yaml
metrics:
  serviceMonitor:
    # Requires the Prometheus Operator CRDs (e.g. kube-prometheus-stack).
    enabled: false
    interval: 30s
    additionalLabels: {}

podDisruptionBudget:
  enabled: false
  maxUnavailable: 1

ingress:
  enabled: false
  className: ''
  # For large cache artifacts behind ingress-nginx, raise the body-size cap:
  #   nginx.ingress.kubernetes.io/proxy-body-size: '0'
  annotations: {}
  # hosts:
  #   - host: cache.example.com
  #     paths:
  #       - path: /
  #         pathType: Prefix
  hosts: []
  # tls:
  #   - secretName: cache-example-tls
  #     hosts: [cache.example.com]
  tls: []
```

And flip the default on line 118: `readOnlyRootFilesystem: false` → `readOnlyRootFilesystem: true`.

- [ ] **Step 2: Mount a writable /tmp**

In `charts/remotecache/templates/deployment.yaml`, add as the first entry under `volumeMounts:` (line 141):

```yaml
# Bun and SQLite need a writable /tmp once the root FS is read-only.
- name: tmp
  mountPath: /tmp
```

And as the first entry under `volumes:` (line 156):

```yaml
- name: tmp
  emptyDir: {}
```

- [ ] **Step 3: Add the three templates**

Create `charts/remotecache/templates/servicemonitor.yaml`:

```yaml
{{- if .Values.metrics.serviceMonitor.enabled }}
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: {{ include "remotecache.fullname" . }}
  labels:
    {{- include "remotecache.labels" . | nindent 4 }}
    {{- with .Values.metrics.serviceMonitor.additionalLabels }}
    {{- toYaml . | nindent 4 }}
    {{- end }}
spec:
  selector:
    matchLabels:
      {{- include "remotecache.selectorLabels" . | nindent 6 }}
  endpoints:
    - port: http
      path: /metrics
      interval: {{ .Values.metrics.serviceMonitor.interval }}
      scheme: {{ if .Values.tls.enabled }}https{{ else }}http{{ end }}
      {{- if .Values.tls.enabled }}
      tlsConfig:
        insecureSkipVerify: true
      {{- end }}
{{- end }}
```

Create `charts/remotecache/templates/pdb.yaml`:

```yaml
{{- if .Values.podDisruptionBudget.enabled }}
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: {{ include "remotecache.fullname" . }}
  labels:
    {{- include "remotecache.labels" . | nindent 4 }}
spec:
  maxUnavailable: {{ .Values.podDisruptionBudget.maxUnavailable }}
  selector:
    matchLabels:
      {{- include "remotecache.selectorLabels" . | nindent 6 }}
{{- end }}
```

Create `charts/remotecache/templates/ingress.yaml`:

```yaml
{{- if .Values.ingress.enabled }}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ include "remotecache.fullname" . }}
  labels:
    {{- include "remotecache.labels" . | nindent 4 }}
  {{- with .Values.ingress.annotations }}
  annotations:
    {{- toYaml . | nindent 4 }}
  {{- end }}
spec:
  {{- with .Values.ingress.className }}
  ingressClassName: {{ . }}
  {{- end }}
  {{- with .Values.ingress.tls }}
  tls:
    {{- toYaml . | nindent 4 }}
  {{- end }}
  rules:
    {{- range .Values.ingress.hosts }}
    - host: {{ .host | quote }}
      http:
        paths:
          {{- range .paths }}
          - path: {{ .path }}
            pathType: {{ .pathType }}
            backend:
              service:
                name: {{ include "remotecache.fullname" $ }}
                port:
                  number: {{ $.Values.service.port }}
          {{- end }}
    {{- end }}
{{- end }}
```

- [ ] **Step 4: Add a CI values set that exercises all three**

Create `charts/remotecache/ci/extras-values.yaml`:

```yaml
adminToken: ci-admin-token-0123456789
metrics:
  serviceMonitor:
    enabled: true
podDisruptionBudget:
  enabled: true
ingress:
  enabled: true
  hosts:
    - host: cache.example.com
      paths:
        - path: /
          pathType: Prefix
```

In `.github/workflows/ci.yml`'s `helm` job, add after the `Helm template (tls)` step:

```yaml
- name: Helm template (extras)
  run: helm template rc charts/remotecache -f charts/remotecache/ci/extras-values.yaml
```

(The kubeconform loop from Task 6 globs `ci/*.yaml`, so it picks this file up automatically.)

- [ ] **Step 5: Verify rendering**

Run:

```bash
helm lint charts/remotecache --set adminToken=ci-admin-token-0123456789
helm template rc charts/remotecache -f charts/remotecache/ci/extras-values.yaml | grep -E 'kind: (ServiceMonitor|PodDisruptionBudget|Ingress)'
helm template rc charts/remotecache -f charts/remotecache/ci/filesystem-values.yaml | grep readOnlyRootFilesystem
```

Expected: lint clean; all three kinds render; `readOnlyRootFilesystem: true`.

- [ ] **Step 6: Update docs (same commit)**

`docs-site/src/content/docs/deploy/kubernetes.md` — add rows to the values table:

```md
| `metrics.serviceMonitor.enabled` | Create a Prometheus Operator `ServiceMonitor` scraping `/metrics` (default `false`; requires the CRDs). |
| `podDisruptionBudget.enabled` | Create a `PodDisruptionBudget` (default `false`; with one replica it can block node drains — prefer tolerating the brief `Recreate` gap). |
| `ingress.enabled` | Create an `Ingress`. For ingress-nginx set `nginx.ingress.kubernetes.io/proxy-body-size: "0"` (or ≥ your `MAX_UPLOAD_BYTES`) or large uploads get `413` at the proxy. |
```

And add a note near the security-context docs:

```md
The container now runs with `readOnlyRootFilesystem: true` by default; `/tmp` is an `emptyDir` and all writes go to the mounted data/cache volumes. Set `securityContext.readOnlyRootFilesystem: false` if a sidecar or wrapper needs to write elsewhere.
```

- [ ] **Step 7: Commit**

```bash
git add charts/remotecache/values.yaml charts/remotecache/templates/deployment.yaml charts/remotecache/templates/servicemonitor.yaml charts/remotecache/templates/pdb.yaml charts/remotecache/templates/ingress.yaml charts/remotecache/ci/extras-values.yaml .github/workflows/ci.yml docs-site/src/content/docs/deploy/kubernetes.md
git commit -m "feat(chart): add ServiceMonitor, PDB, Ingress, and read-only root filesystem"
```

---

### Task 9: Doc drift sweep — OpenAPI 500s, S3 first-write race, cache growth runbook

Research already settled the open question: **Bun's S3 client has no conditional-write (`If-None-Match`) support** (verified against Bun 1.3 docs and source — no option on `S3Options`, `write()`, or `writer()`), so the S3 TOCTOU is documented, not fixed.

**Files:**

- Modify: `nx-cache-server.openapi.json`
- Modify: `docs-site/src/content/docs/guides/security.md` (Append-only section)
- Modify: `docs-site/src/content/docs/guides/storage-strategies.md`

- [ ] **Step 1: OpenAPI — add 500 responses**

In `nx-cache-server.openapi.json`, add to `components.responses` (alongside `BadRequest`):

```json
"InternalServerError": {
  "description": "Unexpected server-side failure (storage or database error). The body is a plain-text error message.",
  "content": {
    "text/plain": {
      "schema": {
        "type": "string"
      }
    }
  }
}
```

Then add to the `responses` object of each of these operations — `put` and `get` on `/v1/cache/{hash}`, `post` on `/v1/admin/tokens`, `delete` on `/v1/admin/tokens/{id}` (these are the four handlers that return `internalServerError`; `GET /v1/admin/tokens` degrades to an empty list instead):

```json
"500": {
  "$ref": "#/components/responses/InternalServerError"
}
```

Validate: `bun -e "JSON.parse(await Bun.file('nx-cache-server.openapi.json').text()); console.log('valid json')"` and `cd docs-site && bun run build` (the API reference regenerates from the spec).

- [ ] **Step 2: security.md — document the S3 residual race**

In `docs-site/src/content/docs/guides/security.md`, append to the "Append-only writes" section (after the filesystem paragraph, line 26):

```md
The S3 strategy checks existence before writing but cannot commit atomically: Bun's S3 client has
no conditional-write (`If-None-Match`) support, so two uploads of the same hash that both pass the
existence check race last-writer-wins at the bucket. The window is one round-trip wide, both
writers must already hold `full` tokens, and Nx derives the hash from the task's inputs — the same
hash means the same artifact in practice. The residual risk is an overwrite with equivalent
content, not a poisoning vector beyond what the token model already gates. The filesystem strategy
has no such window.
```

- [ ] **Step 3: storage-strategies.md — S3 caveat + growth runbook**

In `docs-site/src/content/docs/guides/storage-strategies.md`, append to the S3 section intro (line 18, after "Provide credentials one of two ways."):

```md
Unlike the filesystem strategy, the S3 append-only check is not atomic — see [Security](/guides/security/#append-only-writes) for the (narrow) residual race.
```

Then insert a new section before "## Custom storage strategy":

````md
## Cache growth and pruning

The server never deletes cache entries — there is no built-in eviction yet. Left alone, the cache
grows without bound, so schedule pruning that fits your backend.

**Filesystem.** Entries are plain files named by hash under `CACHE_DIR`. Deleting one just makes
the next request for that hash a cache miss, and writes are atomic, so pruning while the server is
running is safe. A cron job that removes entries not accessed in 30 days:

```sh
find "$CACHE_DIR" -maxdepth 1 -type f -atime +30 -delete
```
````

Filesystems mounted `noatime` don't track access times — fall back to `-mtime` (age since upload).
Watch `du -sh "$CACHE_DIR"` (or the volume-usage metric in Kubernetes) and size the schedule so the
disk never fills.

**S3.** Use a bucket lifecycle rule; the server is not involved:

```json
{
  "Rules": [
    {
      "ID": "expire-nx-cache",
      "Status": "Enabled",
      "Filter": {},
      "Expiration": { "Days": 30 }
    }
  ]
}
```

Apply with `aws s3api put-bucket-lifecycle-configuration --bucket <bucket> --lifecycle-configuration file://lifecycle.json`; MinIO supports the same API (`mc ilm rule add`).

````

- [ ] **Step 4: Build docs and commit**

Run: `cd docs-site && bun run build && cd ..`
Expected: builds clean.

```bash
git add nx-cache-server.openapi.json docs-site/src/content/docs/guides/security.md docs-site/src/content/docs/guides/storage-strategies.md
git commit -m "docs: document 500 responses, the S3 first-write race, and cache pruning"
````

---

### Task 10: Release polish — chart version automation, SBOM, GitHub App token

**Files:**

- Modify: `release-please-config.json`, `charts/remotecache/Chart.yaml`
- Modify: `.github/workflows/publish-image.yml` (`build-binaries` job), `.github/workflows/release.yml`
- Modify: `docs-site/src/content/docs/contributing/releases.md`

- [ ] **Step 1: Wire Chart.yaml into release-please**

In `release-please-config.json`, add to the `"."` package config:

```json
"extra-files": [
  {
    "type": "generic",
    "path": "charts/remotecache/Chart.yaml"
  }
]
```

In `charts/remotecache/Chart.yaml`, annotate the version line (release-please's generic updater rewrites annotated lines):

```yaml
version: 2.0.0 # x-release-please-version
```

(Set it to the current released version from `.release-please-manifest.json` — `2.0.0` at plan time; use whatever the manifest says when you implement. The chart version now tracks the app version; `appVersion: 'edge'` stays as is — `helm package --app-version` pins it at publish time.)

Update the comment block above `version:` in Chart.yaml to note the automation:

```yaml
# Kept in sync with the release version by release-please (x-release-please-version).
```

- [ ] **Step 2: Attach a source SBOM to releases**

In `.github/workflows/publish-image.yml`, in the `build-binaries` job, add after the `Build binaries` step:

```yaml
- name: Generate source SBOM
  uses: anchore/sbom-action@e22c389904149dbc22b58101806040fa8d37a610 # v0.24.0
  with:
    path: .
    format: spdx-json
    output-file: dist/sbom.spdx.json
    upload-artifact: false
    upload-release-assets: false

- name: Refresh checksums with SBOM
  run: cd dist && sha256sum remotecache-* sbom.spdx.json > checksums.txt
```

And in the `publish-binaries` job, change the upload line to include it:

```
gh release upload "$TAG" dist/remotecache-* dist/sbom.spdx.json dist/checksums.txt --clobber
```

- [ ] **Step 3: Manual — create the GitHub App (repo owner does this once)**

1. GitHub → Settings → Developer settings → GitHub Apps → **New GitHub App**. Name: `remotecache-release`. Homepage: the repo URL. Uncheck **Webhook → Active**.
2. Repository permissions: **Contents: Read and write**, **Pull requests: Read and write**, **Issues: Read and write** (Metadata: Read is added automatically). Where can it be installed: **Only on this account**.
3. Create, note the **App ID**, then **Generate a private key** (downloads a `.pem`).
4. Install the app on `thilak-rao/remotecache` only.
5. Repo → Settings → Secrets and variables → Actions: add `RELEASE_PLEASE_APP_ID` (the App ID) and `RELEASE_PLEASE_APP_PRIVATE_KEY` (the full `.pem` contents).
6. Keep `RELEASE_PLEASE_TOKEN` until Step 4 is verified on `main`, then delete the secret and revoke the PAT.

- [ ] **Step 4: Switch release.yml to the App token**

In `.github/workflows/release.yml`, replace the `release-please` job's steps with:

```yaml
steps:
  - name: Mint an installation token
    id: app-token
    uses: actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1 # v3.2.0
    with:
      app-id: ${{ secrets.RELEASE_PLEASE_APP_ID }}
      private-key: ${{ secrets.RELEASE_PLEASE_APP_PRIVATE_KEY }}

  - name: Run Release Please
    id: release
    uses: googleapis/release-please-action@45996ed1f6d02564a971a2fa1b5860e934307cf7 # v5.0.0
    with:
      token: ${{ steps.app-token.outputs.token }}
      config-file: release-please-config.json
      manifest-file: .release-please-manifest.json
```

- [ ] **Step 5: Update docs (same commit)**

`docs-site/src/content/docs/contributing/releases.md`:

- In the intro list of files release-please updates, add `- charts/remotecache/Chart.yaml (chart version)`.
- Replace the "Maintainer setup" section body with:

```md
The release workflow authenticates as a GitHub App (`remotecache-release`) via
`actions/create-github-app-token`, using the `RELEASE_PLEASE_APP_ID` and
`RELEASE_PLEASE_APP_PRIVATE_KEY` repository secrets. The app needs Contents,
Pull requests, and Issues read/write on this repository only.

Do not use the default `GITHUB_TOKEN` for Release Please. GitHub suppresses follow-on workflow runs
for events created by `GITHUB_TOKEN`, which means release PRs and tags may not trigger the normal
CI and publishing workflows.

The repository must also allow GitHub Actions to create pull requests.
```

- In the Publishing section, after the checksums sentence, add: `Each release also carries a source SBOM (sbom.spdx.json, SPDX format), listed in checksums.txt.`

- [ ] **Step 6: Validate and commit**

Run: `bun -e "JSON.parse(await Bun.file('release-please-config.json').text()); console.log('ok')" && helm lint charts/remotecache --set adminToken=ci-admin-token-0123456789`

```bash
git add release-please-config.json charts/remotecache/Chart.yaml .github/workflows/publish-image.yml .github/workflows/release.yml docs-site/src/content/docs/contributing/releases.md
git commit -m "build(release): automate chart versioning, attach SBOMs, use a GitHub App token"
```

---

### Task 11: Final verification and release

- [ ] **Step 1: Full local gate, twice**

Run: `bun test && bun test && bun run typecheck && bun run lint && bun run format --check`
Expected: identical pass counts both runs (flake check), 0 fail.

- [ ] **Step 2: Full chart gate**

```bash
helm lint charts/remotecache --set adminToken=ci-admin-token-0123456789
for f in charts/remotecache/ci/*.yaml; do helm template rc charts/remotecache -f "$f" > /dev/null && echo "$f ok"; done
```

- [ ] **Step 3: Local MinIO run (proves the CI job's contract before pushing)**

Run the three commands from the header comment of `e2e/s3-minio.e2e.spec.ts`; expect 4 pass; `docker rm -f minio`.

- [ ] **Step 4: PR and CI watch**

```bash
git push -u origin HEAD
gh pr create --fill
gh pr checks --watch
```

Confirm the new jobs run and pass: `test` (reusable call), `s3-e2e`, `helm` (with kubeconform), `helm-install` (kind), `docker-smoke`, `security`.

- [ ] **Step 5: Post-merge release checks**

After merging and the release-please PR appears:

- The release PR diff must bump `charts/remotecache/Chart.yaml` `version` alongside `version.txt` — this proves Task 10 Step 1.
- The `release.yml` run's actor should be the `remotecache-release` app bot — this proves the App token. Then delete `RELEASE_PLEASE_TOKEN` and revoke the PAT.
- After tagging: all five `smoke-binaries` matrix legs green; the release has `sbom.spdx.json` and a `checksums.txt` that includes it; the chart pushed to `oci://ghcr.io/thilak-rao/charts/remotecache` with the new version.

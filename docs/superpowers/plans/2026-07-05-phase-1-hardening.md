# Phase 1 — Credibility Hardening (P0 + P1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the correctness bugs that contradict remotecache's documented security guarantees (filesystem TOCTOU, unrevocable tokens, silent upload cap), plus the cheap high-value hygiene items, so the project can be promoted without a credibility-killing first review.

**Architecture:** All changes are surgical fixes inside the existing thin-handler / pure-function / pluggable-storage architecture. One new concept is introduced: storage strategies signal a lost first-writer race with a typed `CacheEntryExistsError`, which `writeCache` maps to the existing 409 path. E2E tests move from a shared in-process server (import-order dependent) to per-spec spawned child processes.

**Tech Stack:** Bun 1.3.14 (runtime, `bun:test`, `bun:sqlite`, `Bun.serve`), TypeScript (new `tsc --noEmit` gate), Helm, GitHub Actions.

## Global Constraints

- Runtime is Bun, not Node: `Bun.serve` routes, `bun:sqlite`, `bun:test`, `Bun.env`, `bun install`. No new runtime dependencies.
- Never call `console`; import `logger` from `src/logger.ts` (`no-console` lint error). No `any` (`no-explicit-any` lint error). Single quotes (oxfmt).
- Every HTTP response comes from a factory in `src/responses.ts`; never `new Response` in handlers.
- Cache writes are append-only: an existing hash returns `409`, never an overwrite.
- Docs are part of the change: HTTP API changes → `nx-cache-server.openapi.json`; env vars/config → `docs-site/src/content/docs/guides/configuration.md`; behavior/security → the matching guide in `docs-site/`. Same commit.
- Unit tests colocate as `*.spec.ts`; e2e tests live in `e2e/`. Run everything with `bun test` (no test script).
- Before committing: `bun run format` (CI gates on `format --check`), `bun run lint`.
- Commits follow Conventional Commits. Breaking changes use `!` (release-please drives versioning from these).
- E2E port allocations (must stay unique): health 4010, metrics 4011, token 4012, upload-limits 4013, startup-validation 4014, tls 402x (existing), graceful-shutdown 4030/4031 (existing).
- Every task ends with: `bun run format && bun run lint && bun test` all passing.

---

### Task 1: Isolated e2e harness (spawned servers)

The health, metrics, and token e2e specs currently `import('../src/main')` and share one in-process server on port 4010 — whichever spec imports first wins, env set by the others is silently ignored, and `token.e2e.spec.ts:27` cleans up a stale DB path (`nx-cache-server-tokens.sqlite` in the repo root) while the server actually uses `./data/nx-cache-server-tokens.sqlite`. Convert all three to spawn `src/main.ts` as a child process with an isolated temp dir, the same pattern `e2e/graceful-shutdown.e2e.spec.ts` already uses.

**Files:**

- Create: `e2e/spawn-server.ts` (helper — not `*.spec.ts`, so `bun test` won't collect it)
- Modify: `e2e/health.e2e.spec.ts` (full rewrite, 29 lines)
- Modify: `e2e/metrics.e2e.spec.ts` (full rewrite, 85 lines)
- Modify: `e2e/token.e2e.spec.ts` (full rewrite, 77 lines)

**Interfaces:**

- Produces: `spawnServer(port: number, env?: Record<string, string>): Promise<SpawnedServer>` where `SpawnedServer = { baseUrl: string; dir: string; stop: () => Promise<void> }`, and `E2E_ADMIN_TOKEN: string` (32 chars — Task 5 enforces a 16-char minimum, so the helper is future-proof). Tasks 3, 4, and 5 consume this helper.

- [ ] **Step 1: Write the helper**

```typescript
// e2e/spawn-server.ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const E2E_ADMIN_TOKEN = 'e2e-admin-token-0123456789abcdef';

export interface SpawnedServer {
  baseUrl: string;
  dir: string;
  stop: () => Promise<void>;
}

/**
 * Starts `src/main.ts` in a child process with an isolated temp dir for the
 * cache and token DB. Each spec gets its own server and port, so specs never
 * share module state or depend on import order.
 */
export async function spawnServer(
  port: number,
  env: Record<string, string> = {},
): Promise<SpawnedServer> {
  const dir = mkdtempSync(join(tmpdir(), 'rc-e2e-'));
  const proc = Bun.spawn(['bun', 'src/main.ts'], {
    env: {
      ...Bun.env,
      ADMIN_TOKEN: E2E_ADMIN_TOKEN,
      PORT: String(port),
      CACHE_DIR: join(dir, 'cache'),
      TOKENS_DB_PATH: join(dir, 'tokens.sqlite'),
      ...env,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const baseUrl = `http://127.0.0.1:${port}`;

  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${baseUrl}/health`)).ok) {
        return {
          baseUrl,
          dir,
          stop: async () => {
            proc.kill();
            await proc.exited;
            rmSync(dir, { recursive: true, force: true });
          },
        };
      }
    } catch {}
    await Bun.sleep(100);
  }
  proc.kill();
  throw new Error(`remotecache did not become healthy on port ${port}`);
}
```

- [ ] **Step 2: Rewrite `e2e/health.e2e.spec.ts`**

Replace the whole file with:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { spawnServer, type SpawnedServer } from './spawn-server';

describe('health endpoint e2e', () => {
  let server: SpawnedServer;

  beforeAll(async () => {
    server = await spawnServer(4010);
  });

  afterAll(async () => {
    await server.stop();
  });

  it('returns OK without authentication', async () => {
    const response = await fetch(`${server.baseUrl}/health`);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/plain');
    expect(await response.text()).toBe('OK');
  });
});
```

- [ ] **Step 3: Rewrite `e2e/metrics.e2e.spec.ts`**

Replace the whole file with (same assertions as today; only the server bootstrap changes — the "shared server" comment block and `mock.module` go away):

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { E2E_ADMIN_TOKEN, spawnServer, type SpawnedServer } from './spawn-server';

let server: SpawnedServer;

const randomHash = () => randomUUID().replace(/-/g, '');

const withAdmin = (path: string, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${E2E_ADMIN_TOKEN}`);
  return fetch(`${server.baseUrl}${path}`, { ...init, headers });
};

function metricValue(text: string, series: string): number {
  const line = text.split('\n').find((l) => l.startsWith(series));
  return line ? Number(line.slice(series.length).trim()) : 0;
}

describe('metrics endpoint e2e', () => {
  beforeAll(async () => {
    server = await spawnServer(4011);
  });

  afterAll(async () => {
    await server.stop();
  });

  it('counts hits, misses, stores, CREEP-blocked writes, and uploaded bytes', async () => {
    const hash = randomHash();
    const body = 'hello-metrics';

    const miss = await withAdmin(`/v1/cache/${hash}`);
    expect(miss.status).toBe(404);

    // An unauthenticated write is rejected the same way a read-only (CREEP)
    // token is — both increment the PUT "forbidden" counter.
    const blocked = await fetch(`${server.baseUrl}/v1/cache/${randomHash()}`, {
      method: 'PUT',
      headers: { 'Content-Length': '4' },
      body: 'evil',
    });
    expect(blocked.status).toBe(403);

    const store = await withAdmin(`/v1/cache/${hash}`, {
      method: 'PUT',
      headers: { 'Content-Length': String(Buffer.byteLength(body)) },
      body,
    });
    expect(store.status).toBe(200);

    const hit = await withAdmin(`/v1/cache/${hash}`);
    expect(hit.status).toBe(200);

    const res = await fetch(`${server.baseUrl}/metrics`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/plain');
    const text = await res.text();

    expect(
      metricValue(text, 'nx_cache_requests_total{method="GET",result="hit"}'),
    ).toBeGreaterThanOrEqual(1);
    expect(
      metricValue(text, 'nx_cache_requests_total{method="GET",result="miss"}'),
    ).toBeGreaterThanOrEqual(1);
    expect(
      metricValue(text, 'nx_cache_requests_total{method="PUT",result="stored"}'),
    ).toBeGreaterThanOrEqual(1);
    expect(
      metricValue(text, 'nx_cache_requests_total{method="PUT",result="forbidden"}'),
    ).toBeGreaterThanOrEqual(1);
    expect(metricValue(text, 'nx_cache_uploaded_bytes_total')).toBeGreaterThanOrEqual(
      Buffer.byteLength(body),
    );
  });
});
```

- [ ] **Step 4: Rewrite `e2e/token.e2e.spec.ts`**

Replace the whole file with (delete still by value here — Task 4 changes that):

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { E2E_ADMIN_TOKEN, spawnServer, type SpawnedServer } from './spawn-server';

let server: SpawnedServer;

const requestWithAuth = (path: string, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  if (!headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${E2E_ADMIN_TOKEN}`);
  }
  return fetch(`${server.baseUrl}${path}`, { ...init, headers });
};

describe('token management e2e', () => {
  beforeAll(async () => {
    server = await spawnServer(4012);
  });

  afterAll(async () => {
    await server.stop();
  });

  it('lists empty, adds token, lists with token, deletes, and lists empty again', async () => {
    // Initial list should be empty
    const listEmpty = await requestWithAuth('/v1/admin/tokens');
    expect(listEmpty.status).toBe(200);
    const initial = await listEmpty.json();
    expect(initial).toEqual({ tokens: [] });

    // Add token
    const tokenId = `token-${randomUUID()}`;
    const addRes = await requestWithAuth('/v1/admin/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: tokenId, permission: 'readonly' }),
    });
    expect(addRes.status).toBe(200);
    const added = await addRes.json();
    expect(added.id).toBe(tokenId);
    expect(added.permission).toBe('readonly');
    expect(typeof added.value).toBe('string');

    const tokenValue = added.value as string;

    // List returns id + permission only; the token value is never exposed
    const listAfterAdd = await requestWithAuth('/v1/admin/tokens');
    expect(listAfterAdd.status).toBe(200);
    const afterAdd = await listAfterAdd.json();
    expect(afterAdd.tokens).toHaveLength(1);
    expect(afterAdd.tokens[0]).toEqual({ id: tokenId, permission: 'readonly' });

    // Delete token using the real token value
    const delRes = await requestWithAuth(`/v1/admin/tokens/${encodeURIComponent(tokenValue)}`, {
      method: 'DELETE',
    });
    expect(delRes.status).toBe(204);

    // List should be empty again
    const listAfterDelete = await requestWithAuth('/v1/admin/tokens');
    expect(listAfterDelete.status).toBe(200);
    const finalList = await listAfterDelete.json();
    expect(finalList).toEqual({ tokens: [] });
  });
});
```

- [ ] **Step 5: Run the full suite**

Run: `bun test`
Expected: all specs PASS. Run it twice in a row to confirm the token spec no longer depends on leftover state: `bun test && bun test`.

- [ ] **Step 6: Format, lint, commit**

```bash
bun run format && bun run lint
git add e2e/
git commit -m "test(e2e): isolate health, metrics, and token specs in spawned servers"
```

---

### Task 2: Atomic first-writer-wins filesystem commit

`FileSystemStrategy.writeStream` writes every concurrent upload of the same hash to the identical `${hash}.tmp` (chunks interleave into a corrupt artifact) and commits with `rename()`, which silently replaces an existing destination — so the documented "409, never overwritten" guarantee is last-writer-wins under concurrency. Fix: unique temp name per write, commit with `link()` (fails `EEXIST` when the destination exists), map the loss to the existing 409.

**Files:**

- Modify: `src/cache/storage-strategy/storage-strategy.interface.ts` (add `CacheEntryExistsError`)
- Modify: `src/cache/storage-strategy/file-system.ts:12-53`
- Modify: `src/cache/write-cache.ts:99-111` (map the error to 409)
- Create: `src/cache/storage-strategy/file-system.spec.ts`
- Modify: `src/cache/write-cache.spec.ts` (one new case)
- Modify: `docs-site/src/content/docs/guides/security.md` (append-only section)

**Interfaces:**

- Produces: `class CacheEntryExistsError extends Error` exported from `src/cache/storage-strategy/storage-strategy.interface.ts`, constructed as `new CacheEntryExistsError(hash)`. Any `CacheStorageStrategy.writeStream` implementation throws it when the hash already has a committed entry (the S3 strategy adopts it in Phase 2).
- Consumes: existing `conflictError(message: string)` from `src/responses.ts`.

- [ ] **Step 1: Write the failing race test**

```typescript
// src/cache/storage-strategy/file-system.spec.ts
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemStrategy } from './file-system';
import { CacheEntryExistsError } from './storage-strategy.interface';

// Slow, chunked stream so two concurrent writes genuinely interleave.
const streamOf = (payload: string, chunkSize = 8) =>
  new ReadableStream<Uint8Array>({
    async start(controller) {
      const bytes = new TextEncoder().encode(payload);
      for (let i = 0; i < bytes.length; i += chunkSize) {
        controller.enqueue(bytes.slice(i, i + chunkSize));
        await Bun.sleep(1);
      }
      controller.close();
    },
  });

describe('FileSystemStrategy concurrent writes', () => {
  it('keeps exactly one intact artifact when two writers race the same hash', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rc-fs-race-'));
    const strategy = new FileSystemStrategy(dir);
    const hash = 'racehash01';
    const payloadA = 'A'.repeat(256);
    const payloadB = 'B'.repeat(256);

    const results = await Promise.allSettled([
      strategy.writeStream(hash, streamOf(payloadA)),
      strategy.writeStream(hash, streamOf(payloadB)),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(CacheEntryExistsError);

    // The committed artifact is one writer's payload intact — never interleaved.
    const stored = await Bun.file(join(dir, hash)).text();
    expect([payloadA, payloadB]).toContain(stored);

    rmSync(dir, { recursive: true, force: true });
  });

  it('cleans up its temp file after a successful write', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rc-fs-tmp-'));
    const strategy = new FileSystemStrategy(dir);
    await strategy.writeStream('tmphash01', streamOf('data'));

    const leftovers = [...new Bun.Glob('*.tmp').scanSync(dir)];
    expect(leftovers).toEqual([]);

    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test src/cache/storage-strategy/file-system.spec.ts`
Expected: FAIL — first `CacheEntryExistsError` is not exported (compile error); after adding the class stub, the race test fails because both writes fulfill.

- [ ] **Step 3: Add the error type**

Append to `src/cache/storage-strategy/storage-strategy.interface.ts`:

```typescript
/**
 * Thrown by writeStream when the hash already has a committed entry.
 * Cache writes are append-only: writeCache maps this to a 409 response.
 */
export class CacheEntryExistsError extends Error {
  constructor(hash: string) {
    super(`Cache entry already exists: ${hash}`);
  }
}
```

- [ ] **Step 4: Rewrite the write path in `src/cache/storage-strategy/file-system.ts`**

Replace the imports, `getTempPath`, and `writeStream`:

```typescript
import { join } from 'node:path';
import { CacheEntryExistsError, CacheStorageStrategy } from './storage-strategy.interface';
import { link, mkdir, rm } from 'node:fs/promises';

export class FileSystemStrategy implements CacheStorageStrategy {
  constructor(public readonly cacheDir: string) {}

  private getPath(hash: string) {
    return join(this.cacheDir, hash);
  }

  private getTempPath(hash: string) {
    // Unique per write: concurrent uploads of the same hash must never share
    // a temp file, or their chunks interleave into a corrupt artifact.
    return join(this.cacheDir, `${hash}.${crypto.randomUUID()}.tmp`);
  }

  async exists(hash: string): Promise<boolean> {
    return Bun.file(this.getPath(hash)).exists();
  }

  async getStream(hash: string): Promise<ReadableStream> {
    const file = Bun.file(this.getPath(hash));
    return file.stream();
  }

  async getSize(hash: string): Promise<number> {
    const file = Bun.file(this.getPath(hash));
    if (!(await file.exists())) return 0;
    return file.size;
  }

  async writeStream(hash: string, stream: ReadableStream<Uint8Array>): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true });

    const finalPath = this.getPath(hash);
    const tempPath = this.getTempPath(hash);
    const writer = Bun.file(tempPath).writer();

    try {
      for await (const chunk of stream) {
        writer.write(chunk);
      }
      await writer.end();
      // rename() silently replaces an existing destination, so two concurrent
      // writers of one hash would be last-writer-wins. link() fails with
      // EEXIST instead, making first-writer-wins an atomic invariant; the
      // losing writer surfaces as a 409.
      try {
        await link(tempPath, finalPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new CacheEntryExistsError(hash);
        }
        throw error;
      }
    } catch (error) {
      try {
        await writer.end();
      } catch {}
      throw error;
    } finally {
      try {
        await rm(tempPath, { force: true });
      } catch {}
    }
  }
}
```

Note `isValidHash` (`[A-Za-z0-9_-]{1,128}`, no dots) still guarantees no client-chosen hash can collide with a `*.tmp` name.

- [ ] **Step 5: Run the strategy spec**

Run: `bun test src/cache/storage-strategy/file-system.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Write the failing 409-mapping test**

Add to `src/cache/write-cache.spec.ts` (match the file's existing mock style for `cacheFile`):

```typescript
import { CacheEntryExistsError } from './storage-strategy/storage-strategy.interface';

it('returns 409 when the storage commit loses a first-writer race', async () => {
  const cacheFile = {
    valid: () => true,
    exists: () => Promise.resolve(false),
    writeStream: () => Promise.reject(new CacheEntryExistsError('racehash')),
  };

  const response = await writeCache(cacheFile, 'full', new Blob(['data']).stream(), '4', 1000);

  expect(response.status).toBe(409);
  expect(await response.text()).toBe('Cannot override an existing record');
});
```

Run: `bun test src/cache/write-cache.spec.ts`
Expected: the new test FAILS with status 500.

- [ ] **Step 7: Map the error in `src/cache/write-cache.ts`**

Add the import and extend the final catch block (lines 99-111):

```typescript
import { CacheEntryExistsError } from './storage-strategy/storage-strategy.interface';
```

```typescript
try {
  await cacheFile.writeStream(countedStream);
  return okResponse({ message: null });
} catch (error) {
  if (error instanceof CacheEntryExistsError) {
    return conflictError('Cannot override an existing record');
  }
  if (error instanceof ContentLengthExceededError || error instanceof ContentLengthMismatchError) {
    return badRequest('Invalid Content-Length header');
  }
  logger.error(error);
  return internalServerError('Failed to write to cache');
}
```

- [ ] **Step 8: Run all tests**

Run: `bun test`
Expected: PASS.

- [ ] **Step 9: Update the security guide**

In `docs-site/src/content/docs/guides/security.md`, replace the "Append-only writes" section body (currently "Once written, cache entries don't change. A `PUT` targeting an existing hash returns `409` without touching storage.") with:

```markdown
Once written, cache entries don't change. A `PUT` targeting an existing hash returns `409` without
touching storage. On the filesystem strategy this is enforced atomically: each upload streams to a
unique temp file and commits with `link(2)`, which fails when the destination exists — so even two
simultaneous uploads of the same hash resolve to exactly one intact, first-committed artifact and
one `409`.
```

- [ ] **Step 10: Format, lint, commit**

```bash
bun run format && bun run lint && bun test
git add src/cache docs-site/src/content/docs/guides/security.md
git commit -m "fix(cache): make filesystem writes atomically first-writer-wins"
```

---

### Task 3: Honor `MAX_UPLOAD_BYTES` above Bun's 128 MiB default

`Bun.serve` defaults `maxRequestBodySize` to 128 MiB (verified against Bun's `ServerConfig`: the limit is enforced up-front on `Content-Length` and during streaming, returning Bun's own 413). `src/main.ts:95` never sets it, so the default `MAX_UPLOAD_BYTES` of 500 MiB is unreachable — uploads between 128 MiB and the configured cap fail with an undocumented rejection.

**Files:**

- Modify: `src/main.ts:95-98`
- Create: `e2e/upload-limits.e2e.spec.ts`
- Modify: `docs-site/src/content/docs/guides/configuration.md` (MAX_UPLOAD_BYTES row/paragraph)

**Interfaces:**

- Consumes: `spawnServer` / `E2E_ADMIN_TOKEN` from Task 1.

- [ ] **Step 1: Write the failing e2e test**

```typescript
// e2e/upload-limits.e2e.spec.ts
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { E2E_ADMIN_TOKEN, spawnServer, type SpawnedServer } from './spawn-server';

const PORT = 4013;
const MAX = 150 * 1024 * 1024; // 150 MiB — above Bun's 128 MiB default cap

describe('upload limits e2e', () => {
  let server: SpawnedServer;

  beforeAll(async () => {
    server = await spawnServer(PORT, { MAX_UPLOAD_BYTES: String(MAX) });
  });

  afterAll(async () => {
    await server.stop();
  });

  it('accepts an upload between 128 MiB and MAX_UPLOAD_BYTES', async () => {
    const body = new Uint8Array(140 * 1024 * 1024);
    const res = await fetch(`${server.baseUrl}/v1/cache/largeuploadhash01`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${E2E_ADMIN_TOKEN}` },
      body,
    });
    expect(res.status).toBe(200);
  }, 30000);

  it('rejects a declared Content-Length above MAX_UPLOAD_BYTES with 413', async () => {
    // Raw socket: declare the oversize length without allocating a body —
    // the server must reject on the header alone.
    let responseText = '';
    let resolveResponse: (v: string) => void;
    const responsePromise = new Promise<string>((resolve) => {
      resolveResponse = resolve;
    });
    const socket = await Bun.connect({
      hostname: '127.0.0.1',
      port: PORT,
      socket: {
        data(_s, data) {
          responseText += new TextDecoder().decode(data);
          if (responseText.includes('\r\n')) resolveResponse(responseText);
        },
        close() {
          resolveResponse(responseText);
        },
        error() {
          resolveResponse(responseText);
        },
      },
    });
    socket.write(
      `PUT /v1/cache/oversizedeclare01 HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${PORT}\r\n` +
        `Authorization: Bearer ${E2E_ADMIN_TOKEN}\r\n` +
        `Content-Length: ${MAX + 1}\r\n` +
        `Connection: close\r\n\r\n`,
    );

    const response = await Promise.race([
      responsePromise,
      Bun.sleep(5000).then(() => '__TIMEOUT__'),
    ]);
    socket.end();
    expect(response.split('\r\n')[0]).toContain('413');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test e2e/upload-limits.e2e.spec.ts`
Expected: the 140 MiB upload FAILS (Bun's 128 MiB default rejects it — status is not 200).

- [ ] **Step 3: Pass the cap to `Bun.serve` in `src/main.ts`**

```typescript
export const server = Bun.serve({
  port: PORT,
  hostname: HOSTNAME,
  // Bun's default maxRequestBodySize is 128 MiB and rejects larger bodies
  // before the route handler runs, silently overriding MAX_UPLOAD_BYTES.
  // +1 keeps writeCache's own 413 (with the documented message) authoritative
  // at the boundary; Bun still backstops anything larger.
  maxRequestBodySize: MAX_UPLOAD_BYTES + 1,
  ...(tls ? { tls } : {}),
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test e2e/upload-limits.e2e.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Update the configuration doc**

In `docs-site/src/content/docs/guides/configuration.md`, extend the `MAX_UPLOAD_BYTES` explanation paragraph (line ~47) to:

```markdown
`MAX_UPLOAD_BYTES` caps `PUT /v1/cache/:hash` uploads. Anything over the limit returns `413` before
the body hits storage. The server sizes its HTTP request-body limit from this value, so caps above
Bun's 128 MiB default work as configured.
```

- [ ] **Step 6: Format, lint, full test, commit**

```bash
bun run format && bun run lint && bun test
git add src/main.ts e2e/upload-limits.e2e.spec.ts docs-site/src/content/docs/guides/configuration.md
git commit -m "fix(server): honor MAX_UPLOAD_BYTES above Bun's 128 MiB default body cap"
```

---

### Task 4: Delete tokens by `id` instead of value (BREAKING)

`DELETE /v1/admin/tokens/:token` requires the plaintext token value — which leaks into proxy/access logs via the URL, and makes a token unrevocable once its value is lost (the store only holds hashes). Delete by the non-secret `id` instead.

**Files:**

- Modify: `src/token/token-storage.ts:93-103` (`removeToken` → `removeTokenById`)
- Modify: `src/token/token-storage.spec.ts` (the test calling `removeToken('value-1')` at ~line 52)
- Modify: `src/token/delete-token.ts`
- Modify: `src/token/delete-token.spec.ts` (full rewrite of the mock + messages)
- Modify: `src/main.ts:137-143` (route param)
- Modify: `e2e/token.e2e.spec.ts` (delete step)
- Modify: `nx-cache-server.openapi.json` (`/v1/admin/tokens/{token}` path)
- Modify: `docs-site/src/content/docs/guides/tokens.md` (delete section)

**Interfaces:**

- Produces: `TokenStorage.removeTokenById(id: string): DatabaseOperation<UnknownError>` (replaces `removeToken(value: string)` — no callers of the old name may remain).
- Produces: HTTP route `DELETE /v1/admin/tokens/:id` (404 for unknown id, 204 on success, 403 without admin rights).

- [ ] **Step 1: Update the storage spec to the new contract**

In `src/token/token-storage.spec.ts`, replace the test that calls `storage.removeToken('value-1')` (~line 52) with:

```typescript
it('removes a token by its id', async () => {
  const dbPath = await freshDbPath();
  const storage = new TokenStorage(dbPath);
  storage.addToken({ id: 't1', value: 'value-1', permission: 'readonly' });

  expect(storage.removeTokenById('t1')).toEqual({ result: true, error: null });
  expect(storage.findToken('value-1')).toBeNull();
  expect(storage.removeTokenById('t1')).toEqual({ result: false, error: null });
});
```

Run: `bun test src/token/token-storage.spec.ts`
Expected: FAIL — `removeTokenById is not a function`.

- [ ] **Step 2: Implement `removeTokenById` in `src/token/token-storage.ts`**

Replace the `removeToken` method (lines 93-103) with:

```typescript
  removeTokenById(id: string): DatabaseOperation<UnknownError> {
    const deleteStatement = this.#db.query('DELETE FROM tokens WHERE id = $id');

    try {
      const deleted = deleteStatement.run({ id });
      return { result: deleted.changes > 0, error: null };
    } catch (error) {
      logger.error(error);
      return { result: false, error: 'unknownError' };
    }
  }
```

Run: `bun test src/token/token-storage.spec.ts`
Expected: PASS.

- [ ] **Step 3: Update the handler and its spec**

`src/token/delete-token.ts`:

```typescript
import {
  accessForbidden,
  badRequest,
  internalServerError,
  noContentResponse,
  notFoundError,
} from '../responses';
import { TokenStorage } from './token-storage';

export async function deleteToken(
  hasAdminRights: boolean,
  tokenStorage: Pick<TokenStorage, 'removeTokenById'>,
  idToDelete: string,
) {
  if (!hasAdminRights) {
    return accessForbidden();
  }

  if (!idToDelete) {
    return badRequest('id is required');
  }
  const { result, error } = tokenStorage.removeTokenById(idToDelete);

  if (error) {
    return internalServerError('An error occurred while deleting the token');
  }

  if (!result) {
    return notFoundError('Token not found');
  }
  return noContentResponse();
}
```

`src/token/delete-token.spec.ts` — update the mock factory and the two changed expectations; the five test bodies otherwise keep their existing shape:

```typescript
const makeStorage = ({ result, error }: ReturnType<TokenStorage['removeTokenById']>) => ({
  removeTokenById: mock().mockReturnValue({ result, error }),
});
```

- every `storage.removeToken` assertion becomes `storage.removeTokenById`
- the 400 test's expected body becomes `'id is required'`

Run: `bun test src/token/delete-token.spec.ts`
Expected: PASS.

- [ ] **Step 4: Update the route in `src/main.ts`**

```typescript
    '/v1/admin/tokens/:id': {
      DELETE: ({ params, headers }) => {
        const hasAdminRights = isAdmin(getAuthToken(headers));
        return deleteToken(hasAdminRights, tokenStorage, params.id);
      },
    },
```

- [ ] **Step 5: Update the e2e delete step**

In `e2e/token.e2e.spec.ts`, delete the `const tokenValue = added.value as string;` line and replace the delete block with:

```typescript
// Delete token by its id — the value is never needed (or wanted) in a URL
const delRes = await requestWithAuth(`/v1/admin/tokens/${encodeURIComponent(tokenId)}`, {
  method: 'DELETE',
});
expect(delRes.status).toBe(204);

// Deleting the same id again is a 404
const delAgain = await requestWithAuth(`/v1/admin/tokens/${encodeURIComponent(tokenId)}`, {
  method: 'DELETE',
});
expect(delAgain.status).toBe(404);
```

Run: `bun test e2e/token.e2e.spec.ts`
Expected: PASS.

- [ ] **Step 6: Update the OpenAPI spec**

In `nx-cache-server.openapi.json`, rename the path key `"/v1/admin/tokens/{token}"` to `"/v1/admin/tokens/{id}"` and replace its `delete` operation's `description` and `parameters`:

```json
"description": "Delete a token by its id. Requires the ADMIN_TOKEN bearer token. Deleting by id (never by value) keeps token values out of URLs and access logs, and lets an admin revoke a token whose value has been lost.",
"parameters": [
  {
    "name": "id",
    "in": "path",
    "required": true,
    "description": "The id of the token to delete, as returned by the list endpoint.",
    "schema": {
      "type": "string"
    }
  }
]
```

(Keep `operationId: adminDeleteToken` and the 204/400/403/404 responses as they are.)

- [ ] **Step 7: Update the tokens guide**

In `docs-site/src/content/docs/guides/tokens.md`, replace the "Delete a token" section with:

```markdown
### Delete a token
```

DELETE /v1/admin/tokens/:id

```

Pass the token's `id` (as returned by the list endpoint) in the URL path — never the token value.
Deleting by id keeps secrets out of URLs and access logs, and means a token can always be revoked
even after its value has been lost.
```

- [ ] **Step 8: Format, lint, full test, commit**

```bash
bun run format && bun run lint && bun test
git add src/token src/main.ts e2e/token.e2e.spec.ts nx-cache-server.openapi.json docs-site/src/content/docs/guides/tokens.md
git commit -m "feat(tokens)!: delete tokens by id instead of plaintext value

BREAKING CHANGE: DELETE /v1/admin/tokens/:token (by value) is now
DELETE /v1/admin/tokens/:id. Deleting by id keeps token values out of
URLs and access logs and makes revocation possible after a value is lost."
```

---

### Task 5: Minimum `ADMIN_TOKEN` strength (BREAKING) + purge `change-me`

`ADMIN_TOKEN` is the root of trust (token minting + full cache write) with no strength check, no rate limiting, and `change-me` in every doc example. Refuse to start below 16 characters and make every example generate a random token.

**Files:**

- Modify: `src/main.ts:38-41`
- Create: `e2e/startup-validation.e2e.spec.ts`
- Modify: `e2e/graceful-shutdown.e2e.spec.ts` (two `ADMIN_TOKEN: 'admin-token'` env values — 11 chars, now too short)
- Modify: `e2e/tls.e2e.spec.ts` (same sweep if it spawns with a short token — check with grep)
- Modify: `.github/workflows/ci.yml:61` (`ADMIN_TOKEN=test-token` in docker-smoke)
- Modify: `.github/workflows/publish-image.yml` (the copy-pasted docker-smoke env in `preflight`, and `ADMIN_TOKEN=smoke-token` at line ~218)
- Modify: `README.md` (Quickstart + Docker sections)
- Modify: `docs-site/src/content/docs/getting-started/quickstart.md`, `docs-site/src/content/docs/deploy/docker.md`, `docs-site/src/content/docs/guides/configuration.md` (ADMIN_TOKEN row), `CONTRIBUTING.md` (any `change-me`)

**Interfaces:**

- Produces: startup invariant — the process exits 1 with `Error: ADMIN_TOKEN must be at least 16 characters.` when the token is shorter than 16 chars. Every spawned test/CI server must use a ≥16-char token (Task 1's `E2E_ADMIN_TOKEN` already is).

- [ ] **Step 1: Write the failing startup test**

```typescript
// e2e/startup-validation.e2e.spec.ts
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('startup validation e2e', () => {
  it('refuses to start when ADMIN_TOKEN is shorter than 16 characters', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rc-startup-'));
    const proc = Bun.spawn(['bun', 'src/main.ts'], {
      env: {
        ...Bun.env,
        ADMIN_TOKEN: 'short',
        PORT: '4014',
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
    expect(stderr).toContain('at least 16 characters');
  });
});
```

Run: `bun test e2e/startup-validation.e2e.spec.ts`
Expected: FAIL — the server starts happily with a 5-char token (test times out or exitCode differs).

- [ ] **Step 2: Add the check in `src/main.ts`**

Directly after the existing `if (!ADMIN_TOKEN)` block:

```typescript
if (ADMIN_TOKEN.length < 16) {
  logger.error(
    'Error: ADMIN_TOKEN must be at least 16 characters. Generate one with: openssl rand -hex 32',
  );
  process.exit(1);
}
```

Run: `bun test e2e/startup-validation.e2e.spec.ts`
Expected: PASS.

- [ ] **Step 3: Sweep every short token in tests and CI**

Run: `grep -rn "ADMIN_TOKEN" e2e/ .github/workflows/ | grep -vE 'E2E_ADMIN_TOKEN|secretKeyRef'`

Update every value shorter than 16 chars:

- `e2e/graceful-shutdown.e2e.spec.ts`: both `ADMIN_TOKEN: 'admin-token'` → `ADMIN_TOKEN: 'e2e-admin-token-0123456789abcdef'` (and the two `Authorization: Bearer admin-token` request headers in the same file to match)
- `e2e/tls.e2e.spec.ts`: same substitution if present
- `.github/workflows/ci.yml:61`: `-e ADMIN_TOKEN=test-token` → `-e ADMIN_TOKEN=ci-smoke-admin-token-0123456789`
- `.github/workflows/publish-image.yml`: the duplicated docker-smoke line in `preflight` (same substitution) and `ADMIN_TOKEN=smoke-token` in `publish-binaries` → `ADMIN_TOKEN=smoke-admin-token-0123456789`

Run: `bun test`
Expected: PASS (every spawned server now boots).

- [ ] **Step 4: Replace `change-me` everywhere**

Run: `grep -rn "change-me" README.md CONTRIBUTING.md docs-site/src/content/docs/`

In `README.md`, replace the Quickstart block with:

````markdown
```sh
bun install
export ADMIN_TOKEN="$(openssl rand -hex 32)"
bun run serve
```

The server starts on `http://localhost:3000`. Create a **full** token (can read/write cache):

```sh
curl -sS -X POST \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  "http://localhost:3000/v1/admin/tokens" \
  -d '{"id":"CI","permission":"full"}'
```
````

and the Docker block's env line with:

```sh
  -e ADMIN_TOKEN="$(openssl rand -hex 32)" \
```

Apply the same `export ADMIN_TOKEN="$(openssl rand -hex 32)"` pattern to every remaining `change-me` occurrence in `docs-site/` and `CONTRIBUTING.md`.

- [ ] **Step 5: Document the requirement**

In `docs-site/src/content/docs/guides/configuration.md`, extend the `ADMIN_TOKEN` row/paragraph with: `Must be at least 16 characters (the server refuses to start otherwise); generate one with "openssl rand -hex 32". There is no rate limiting on authentication — treat this value like a root credential.`

- [ ] **Step 6: Format, lint, full test, commit**

```bash
bun run format && bun run lint && bun test
git add src/main.ts e2e/ .github/workflows/ README.md CONTRIBUTING.md docs-site/
git commit -m "feat(server)!: require ADMIN_TOKEN of at least 16 characters

BREAKING CHANGE: the server now exits at startup when ADMIN_TOKEN is
shorter than 16 characters. Docs examples generate tokens with
openssl rand -hex 32 instead of the guessable change-me."
```

---

### Task 6: Helm — `Recreate` strategy, multi-replica guard, default resources

The chart is a Deployment with ReadWriteOnce PVCs and the default RollingUpdate strategy: upgrades deadlock because the new pod can't attach the volume the old pod holds. `replicaCount > 1` is broken regardless of storage strategy (the SQLite token store is single-writer, and the RWO data PVC can't be shared). And `resources: {}` ships BestEffort QoS for a server accepting 500 MB uploads.

**Files:**

- Modify: `charts/remotecache/templates/deployment.yaml:1-17`
- Modify: `charts/remotecache/values.yaml:3,97`
- Modify: `docs-site/src/content/docs/deploy/kubernetes.md` (scaling note)

**Interfaces:**

- Produces: `.Values.deploymentStrategy` (rendered verbatim under `spec.strategy`), default `{type: Recreate}`; template `fail` when `replicaCount > 1`.

- [ ] **Step 1: Add the guard and strategy to `charts/remotecache/templates/deployment.yaml`**

Add a fourth guard after the existing three `fail` blocks (lines 1-9):

```yaml
{{- if gt (int .Values.replicaCount) 1 }}
{{- fail "remotecache: replicaCount > 1 is not supported: the SQLite token store and data PVC are single-writer. Track multi-replica support in the project roadmap." }}
{{- end }}
```

And under `spec:` (after `replicas:`):

```yaml
spec:
  replicas: { { .Values.replicaCount } }
  strategy: { { - toYaml .Values.deploymentStrategy | nindent 4 } }
```

- [ ] **Step 2: Add defaults to `charts/remotecache/values.yaml`**

After `replicaCount: 1`:

```yaml
# Rolling updates deadlock with ReadWriteOnce PVCs: the replacement pod can't
# attach a volume the old pod still holds. Recreate is the safe default; only
# switch to RollingUpdate when no RWO PVC is mounted (e.g. S3 storage with
# persistence.data disabled).
deploymentStrategy:
  type: Recreate
```

Replace `resources: {}` with:

```yaml
resources:
  requests:
    cpu: 100m
    memory: 256Mi
  limits:
    memory: 512Mi
```

(No CPU limit on purpose — CPU throttling hurts upload latency more than it protects neighbors; memory is the OOM risk.)

- [ ] **Step 3: Verify with helm template**

```bash
helm lint charts/remotecache --set adminToken=ci-admin-token
helm template rc charts/remotecache -f charts/remotecache/ci/filesystem-values.yaml | grep -A2 'strategy:'
helm template rc charts/remotecache -f charts/remotecache/ci/filesystem-values.yaml --set replicaCount=2 2>&1 | grep 'not supported' && echo GUARD-OK
```

Expected: lint passes; templated output contains `type: Recreate`; the `replicaCount=2` render fails with the guard message and prints `GUARD-OK`.

- [ ] **Step 4: Document the constraint**

Add to `docs-site/src/content/docs/deploy/kubernetes.md` (new section near the values documentation):

```markdown
## Scaling

remotecache currently runs as a single replica: the SQLite token store is a single-writer local
database, and the chart's `data`/`cache` volumes are `ReadWriteOnce`. The chart refuses to render
`replicaCount > 1`. The Deployment uses the `Recreate` strategy by default so upgrades don't
deadlock on the RWO volumes — expect a brief gap during rollouts (Nx treats an unreachable cache
as a miss, so builds keep working). Scale vertically, or use the S3 storage strategy to keep
artifacts off the pod entirely.
```

- [ ] **Step 5: Commit**

```bash
bun run format --check
git add charts/remotecache docs-site/src/content/docs/deploy/kubernetes.md
git commit -m "fix(chart): default to Recreate, guard replicaCount > 1, set default resources"
```

---

### Task 7: Strict TypeScript gate in CI

CI never type-checks (`tsconfig.json` is 2 lines, no `tsc` anywhere), so type lies are structurally uncatchable — two are known: `getTokenPermission` (`src/main.ts:71`) declares `TokenPermission` but returns `null`/`undefined`, and `toReadableStream` (`src/cache/write-cache.ts:23`) declares non-null but returns `null`.

**Files:**

- Modify: `tsconfig.json`
- Modify: `package.json` (typescript devDependency + `typecheck` script)
- Modify: `src/main.ts:71-77`, `src/cache/write-cache.ts:23-29` (+ anything else `tsc` surfaces)
- Modify: `.github/workflows/ci.yml` (new step), `.github/workflows/publish-image.yml` (same step in `preflight`)

**Interfaces:**

- Produces: `bun run typecheck` (runs `tsc --noEmit`) as a CI gate; `getTokenPermission(headers: Headers): TokenPermission | null`.

- [ ] **Step 1: Install TypeScript and wire the script**

Check the current latest first (per repo convention): `npm view typescript version`, then:

```bash
bun add --dev --exact typescript
```

Add to `package.json` scripts: `"typecheck": "tsc --noEmit"`.

- [ ] **Step 2: Strict tsconfig**

Replace `tsconfig.json` with:

```json
{
  "compilerOptions": {
    "module": "esnext",
    "target": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "types": ["bun"],
    "skipLibCheck": true
  },
  "include": ["src", "e2e"]
}
```

- [ ] **Step 3: Run and fix what surfaces**

Run: `bun run typecheck`
Expected: errors at least at the two known sites. Fix them:

`src/main.ts`:

```typescript
const getTokenPermission = (headers: Headers): TokenPermission | null => {
  const tokenValue = getAuthToken(headers);
  if (isAdmin(tokenValue)) {
    return 'full';
  }
  if (!tokenValue) return null;
  return tokenStorage.findToken(tokenValue)?.permission ?? null;
};
```

`src/cache/write-cache.ts`:

```typescript
const toReadableStream = (
  body: ReadableStream<Uint8Array> | Blob | null,
): ReadableStream<Uint8Array> | null => {
  if (body instanceof ReadableStream) return body;
  if (body instanceof Blob) return body.stream();
  return null;
};
```

Fix any further errors minimally (narrowing, `?? null`, explicit types) — no behavior changes, no refactors. Re-run until clean: `bun run typecheck` → exit 0.

- [ ] **Step 4: Gate it in CI**

In `.github/workflows/ci.yml`, after the Lint step:

```yaml
- name: Typecheck
  run: bun run typecheck
```

Add the identical step in the `preflight` job of `.github/workflows/publish-image.yml` at the same position (the pipeline is currently duplicated; Phase 2 de-duplicates it).

- [ ] **Step 5: Verify, commit**

```bash
bun run typecheck && bun run format && bun run lint && bun test
git add tsconfig.json package.json bun.lock src .github/workflows
git commit -m "build: add strict typecheck gate to CI and fix unsound return types"
```

---

### Task 8: S3 multipart flush batching

`src/cache/storage-strategy/s3.ts:92-95` awaits `writer.flush()` after **every** chunk — one network round-trip per HTTP body chunk, defeating the configured `partSize: 5 MiB` / `queueSize: 10` batching (the Bun `FileSink` docs pattern flushes only around large writes). Flush at part boundaries instead; that keeps memory bounded (backpressure) without serializing the upload.

**Files:**

- Modify: `src/cache/storage-strategy/s3.ts:86-106`

**Interfaces:** unchanged (`writeStream(hash, stream): Promise<void>`).

- [ ] **Step 1: Rewrite `writeStream`**

```typescript
  async writeStream(hash: string, stream: ReadableStream<Uint8Array>): Promise<void> {
    const client = await this.#getClient();
    const file = client.file(hash);
    const partSize = 5 * 1024 * 1024;
    const writer = file.writer({ retry: 3, queueSize: 10, partSize });

    try {
      // Flush at part boundaries, not per chunk: a per-chunk flush serializes
      // the multipart upload into one round-trip per HTTP body chunk. Flushing
      // every partSize bytes bounds buffered memory without the round-trips.
      let buffered = 0;
      for await (const chunk of stream) {
        writer.write(chunk);
        buffered += chunk.byteLength;
        if (buffered >= partSize) {
          await writer.flush();
          buffered = 0;
        }
      }
      await writer.end();
    } catch (error) {
      // Pass the error to end() so Bun aborts the multipart upload instead of
      // committing the flushed parts as a truncated object. Cache writes are
      // append-only, so a corrupt entry would 409 every future write to this hash.
      try {
        await writer.end(error instanceof Error ? error : new Error(String(error)));
      } catch {}
      throw error;
    }
  }
```

- [ ] **Step 2: Verify and commit**

No behavioral S3 test exists yet (Phase 2 adds a MinIO harness that will cover this path end-to-end). Verify nothing regresses:

```bash
bun run typecheck && bun test
git add src/cache/storage-strategy/s3.ts
git commit -m "perf(s3): flush multipart uploads at part boundaries instead of per chunk"
```

---

### Task 9: Static invalid-JSON message

`src/token/add-token.ts:48` builds `badRequest('Invalid JSON' + JSON.stringify(body))` — a missing separator (`Invalid JSONnull`) and a needless reflection of attacker-controlled input.

**Files:**

- Modify: `src/token/add-token.ts:48`
- Modify: `src/token/add-token.spec.ts` (the two assertions at ~lines 28 and 40 that expect the concatenated string)

- [ ] **Step 1: Update the two spec assertions first**

In `src/token/add-token.spec.ts`, change both assertions that expect an `'Invalid JSON...'` body to:

```typescript
expect(await response.text()).toBe('Invalid JSON body');
```

Run: `bun test src/token/add-token.spec.ts`
Expected: those two tests FAIL.

- [ ] **Step 2: Fix the message**

```typescript
if (!body || typeof body !== 'object') {
  return badRequest('Invalid JSON body');
}
```

Run: `bun test src/token/add-token.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
bun run format && bun run lint
git add src/token/add-token.ts src/token/add-token.spec.ts
git commit -m "fix(tokens): return a static invalid-JSON message instead of reflecting the body"
```

---

### Task 10: Workflow + supply-chain hygiene

Five independent one-line-class fixes flagged by the CI/CD audit (Scorecard Token-Permissions and Pinned-Dependencies, wasted CI minutes, unpatched docs-site lockfile).

**Files:**

- Modify: `.github/workflows/ci.yml` (bun pin, concurrency)
- Modify: `.github/workflows/docs.yml` (bun pin)
- Modify: `.github/workflows/publish-image.yml` (bun pins ×2, permissions scoping)
- Modify: `.github/workflows/release.yml` (permissions scoping)
- Modify: `.github/workflows/codeql.yml` (top-level permissions, concurrency)
- Modify: `.github/dependabot.yml` (docs-site ecosystem, grouping)

- [ ] **Step 1: Pin Bun everywhere**

Replace every `bun-version: latest` with `bun-version: 1.3.14` (matches `@types/bun` 1.3.14): `ci.yml:21`, `docs.yml:34`, `publish-image.yml:31` and `publish-image.yml:207`. Dependabot's github-actions updates won't bump this — note in each file with a trailing comment `# keep in sync with @types/bun`.

- [ ] **Step 2: Concurrency groups**

`ci.yml`, after the `on:` block:

```yaml
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}
```

`codeql.yml`, same position:

```yaml
concurrency:
  group: codeql-${{ github.ref }}
  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}
```

- [ ] **Step 3: Least-privilege permissions**

`codeql.yml`: add a top-level block (the `analyze` job keeps its own):

```yaml
permissions:
  contents: read
```

`publish-image.yml`: change the top-level block to `contents: read` only, and give each job exactly what its steps use:

```yaml
permissions:
  contents: read
```

```yaml
preflight:
  runs-on: ubuntu-latest
  permissions:
    contents: read
    security-events: write
```

```yaml
publish:
  runs-on: ubuntu-latest
  needs: preflight
  permissions:
    contents: read
    packages: write
```

(`publish-helm` and `publish-binaries` already carry correct job-level permissions — leave them.)

`release.yml`: change the top-level block to `permissions: {}` and move the writes onto the job (release-please authenticates with the PAT anyway; this scopes the ambient `GITHUB_TOKEN`):

```yaml
permissions: {}
```

```yaml
jobs:
  release-please:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      issues: write
      pull-requests: write
```

- [ ] **Step 4: Dependabot — docs-site + grouping**

Replace `.github/dependabot.yml` with:

```yaml
version: 2
updates:
  - package-ecosystem: 'bun'
    directory: '/'
    schedule:
      interval: 'weekly'
    groups:
      minor-and-patch:
        update-types: ['minor', 'patch']
  - package-ecosystem: 'bun'
    directory: '/docs-site'
    schedule:
      interval: 'weekly'
    groups:
      minor-and-patch:
        update-types: ['minor', 'patch']
  - package-ecosystem: 'github-actions'
    directory: '/'
    schedule:
      interval: 'weekly'
    groups:
      actions:
        patterns: ['*']
  - package-ecosystem: 'docker'
    directory: '/'
    schedule:
      interval: 'weekly'
```

- [ ] **Step 5: Validate and commit**

```bash
bun x action-validator .github/workflows/*.yml 2>/dev/null || bun x yaml-lint .github/workflows/*.yml .github/dependabot.yml 2>/dev/null || python3 -c "import sys,yaml;[yaml.safe_load(open(f)) for f in sys.argv[1:]]" .github/workflows/*.yml .github/dependabot.yml && echo YAML-OK
git add .github
git commit -m "ci: pin bun, scope workflow permissions, add concurrency groups, extend dependabot"
```

Expected: `YAML-OK`. The real verification is the next PR's CI run — watch that all jobs still pass with the scoped permissions (`gh run watch`).

---

## Final verification (whole phase)

- [ ] `bun run typecheck && bun run format --check && bun run lint && bun test` — all green, twice in a row
- [ ] `helm lint charts/remotecache --set adminToken=ci-admin-token` — passes
- [ ] Manual smoke: `export ADMIN_TOKEN="$(openssl rand -hex 32)" && bun run serve`, then mint a token, PUT a blob, GET it back, PUT the same hash again → 409, DELETE the token by id → 204
- [ ] Push a PR and confirm every CI job passes with the scoped permissions and pinned Bun
- [ ] Release note: Tasks 4 and 5 are breaking (`!` commits) — release-please will cut a major version; sanity-check the generated CHANGELOG before publishing

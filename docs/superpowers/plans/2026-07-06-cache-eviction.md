# Filesystem Cache Eviction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opt-in eviction for the filesystem cache — an LRU size cap (`CACHE_MAX_BYTES`) and a last-access TTL (`CACHE_TTL_HOURS`) enforced by a stateless background sweeper — so a remotecache deployment never fills its disk.

**Architecture:** Recency lives in the filesystem itself: every cache hit bumps the entry's mtime, and a periodic sweeper re-derives sizes and recency from a directory scan (no index, no new state store). The sweeper deletes TTL-expired entries first, then least-recently-used entries until the total fits the cap. Everything is off unless a policy variable is set. Spec: `docs/superpowers/specs/2026-07-06-cache-eviction-design.md`.

**Tech Stack:** Bun built-ins only (`Bun.Glob`, `bun:test`, `Bun.spawn`), `node:fs/promises` (`stat`, `rm`, `utimes`), Helm chart.

## Global Constraints

- Bun runtime only: `Bun.env` not `process.env`, `bun:test` not Jest, no new dependencies.
- Never call `console`; import `logger` from `src/logger.ts` (`no-console` lint is an error). `logger.error` always prints; `logger.info` only with `VERBOSE=1`.
- No `any` (`no-explicit-any` is an error). Single quotes (oxfmt). Run `bun run format` before every commit — the CI gate is `bun run format --check`.
- Cache writes stay append-only; eviction deletes committed entries but never touches `*.tmp` in-flight upload buffers. Committed hashes can never contain dots (`isValidHash` rejects them), so the `.tmp` suffix check is exact.
- Docs ship in the same commit as the behavior they describe: env vars → `docs-site/src/content/docs/guides/configuration.md`; behavior → the matching guide; chart values → `docs-site/src/content/docs/deploy/kubernetes.md`. No OpenAPI change (HTTP surface untouched).
- Conventional Commits: `type(scope): subject`, imperative, lowercase.
- E2E port registry: 4010–4017 taken after this plan; the eviction spec uses **4017**. Each e2e spec gets its own port and spawned server via `e2e/spawn-server.ts`.
- All three new env vars are opt-in; absent means today's behavior (no eviction, no timer).
- Metric names carry the existing `nx_cache_` prefix.

---

### Task 1: Eviction sweeper module

**Files:**

- Create: `src/cache/eviction.ts`
- Test: `src/cache/eviction.spec.ts`

**Interfaces:**

- Consumes: `logger` from `src/logger.ts`.
- Produces (Tasks 3 and 4 rely on these exact names):

```ts
export interface SweepResult {
  scannedEntries: number;
  totalBytes: number; // committed size after the sweep
  evictedEntries: number;
  evictedBytes: number;
}

export interface CacheEvictor {
  sweep(): Promise<SweepResult>;
  start(): void;
  stop(): void;
}

export function createCacheEvictor(options: {
  cacheDir: string;
  maxBytes?: number;
  ttlMs?: number;
  intervalMs: number;
  onSweep?: (result: SweepResult) => void;
}): CacheEvictor;
```

- [ ] **Step 1: Write the failing tests**

Create `src/cache/eviction.spec.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCacheEvictor } from './eviction';

const HOUR_MS = 3_600_000;

function makeCacheDir(): string {
  return mkdtempSync(join(tmpdir(), 'rc-evict-'));
}

/** Write `bytes` zero bytes at `dir/name` and backdate its mtime by `ageMs`. */
function makeEntry(dir: string, name: string, bytes: number, ageMs: number): string {
  const path = join(dir, name);
  writeFileSync(path, new Uint8Array(bytes));
  const seconds = (Date.now() - ageMs) / 1000;
  utimesSync(path, seconds, seconds);
  return path;
}

const exists = (path: string): Promise<boolean> => Bun.file(path).exists();

describe('createCacheEvictor sweep', () => {
  it('deletes entries older than the TTL and keeps younger ones', async () => {
    const dir = makeCacheDir();
    const stale = makeEntry(dir, 'stalehash01', 100, 3 * HOUR_MS);
    const fresh = makeEntry(dir, 'freshhash01', 100, 1 * HOUR_MS);
    const evictor = createCacheEvictor({ cacheDir: dir, ttlMs: 2 * HOUR_MS, intervalMs: 60_000 });

    const result = await evictor.sweep();

    expect(await exists(stale)).toBe(false);
    expect(await exists(fresh)).toBe(true);
    expect(result).toEqual({
      scannedEntries: 2,
      totalBytes: 100,
      evictedEntries: 1,
      evictedBytes: 100,
    });
    rmSync(dir, { recursive: true, force: true });
  });

  it('evicts least-recently-used entries until the total fits the cap', async () => {
    const dir = makeCacheDir();
    const oldest = makeEntry(dir, 'oldesthash01', 1000, 3 * HOUR_MS);
    const middle = makeEntry(dir, 'middlehash01', 1000, 2 * HOUR_MS);
    const newest = makeEntry(dir, 'newesthash01', 1000, 1 * HOUR_MS);
    const evictor = createCacheEvictor({ cacheDir: dir, maxBytes: 2000, intervalMs: 60_000 });

    const result = await evictor.sweep();

    // 3000 > 2000: only the oldest goes; deletion stops once total <= cap.
    expect(await exists(oldest)).toBe(false);
    expect(await exists(middle)).toBe(true);
    expect(await exists(newest)).toBe(true);
    expect(result).toEqual({
      scannedEntries: 3,
      totalBytes: 2000,
      evictedEntries: 1,
      evictedBytes: 1000,
    });
    rmSync(dir, { recursive: true, force: true });
  });

  it('runs the TTL pass before the size pass', async () => {
    // TTL removes the stale entry; the survivors then fit the cap, so the
    // LRU pass deletes nothing even though the pre-TTL total exceeded it.
    const dir = makeCacheDir();
    const stale = makeEntry(dir, 'stalehash02', 1500, 5 * HOUR_MS);
    const fresh = makeEntry(dir, 'freshhash02', 1000, 1 * HOUR_MS);
    const evictor = createCacheEvictor({
      cacheDir: dir,
      maxBytes: 2000,
      ttlMs: 2 * HOUR_MS,
      intervalMs: 60_000,
    });

    const result = await evictor.sweep();

    expect(await exists(stale)).toBe(false);
    expect(await exists(fresh)).toBe(true);
    expect(result.totalBytes).toBe(1000);
    expect(result.evictedEntries).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it('never touches in-flight .tmp upload buffers', async () => {
    const dir = makeCacheDir();
    const tmp = makeEntry(dir, `somehash01.${crypto.randomUUID()}.tmp`, 5000, 10 * HOUR_MS);
    const evictor = createCacheEvictor({
      cacheDir: dir,
      maxBytes: 1000,
      ttlMs: HOUR_MS,
      intervalMs: 60_000,
    });

    const result = await evictor.sweep();

    expect(await exists(tmp)).toBe(true);
    expect(result).toEqual({
      scannedEntries: 0,
      totalBytes: 0,
      evictedEntries: 0,
      evictedBytes: 0,
    });
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns an empty result when the cache dir does not exist yet', async () => {
    const evictor = createCacheEvictor({
      cacheDir: join(tmpdir(), `rc-evict-missing-${crypto.randomUUID()}`),
      maxBytes: 1,
      intervalMs: 60_000,
    });

    const result = await evictor.sweep();

    expect(result).toEqual({
      scannedEntries: 0,
      totalBytes: 0,
      evictedEntries: 0,
      evictedBytes: 0,
    });
  });

  it('skips entries it cannot delete and keeps reporting their size', async () => {
    const dir = makeCacheDir();
    makeEntry(dir, 'undeletable01', 100, 3 * HOUR_MS);
    chmodSync(dir, 0o500); // deleting requires write permission on the directory
    const evictor = createCacheEvictor({ cacheDir: dir, ttlMs: HOUR_MS, intervalMs: 60_000 });

    const result = await evictor.sweep();

    chmodSync(dir, 0o700);
    expect(result.evictedEntries).toBe(0);
    // The undeletable entry still counts toward the reported size.
    expect(result.totalBytes).toBe(100);
    rmSync(dir, { recursive: true, force: true });
  });
});
```

(The delete-failure test relies on POSIX directory permissions; CI runs as a non-root user, matching the existing `assertWritableDir` test in `src/cache/create-cache-storage.spec.ts`. The expected `logger.error` output is noise on stderr, not a failure.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/cache/eviction.spec.ts`
Expected: FAIL — `Cannot find module './eviction'` (or equivalent resolve error).

- [ ] **Step 3: Implement the sweeper**

Create `src/cache/eviction.ts`:

```ts
import { existsSync } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../logger';

export interface SweepResult {
  scannedEntries: number;
  /** Committed cache size in bytes after the sweep. */
  totalBytes: number;
  evictedEntries: number;
  evictedBytes: number;
}

export interface CacheEvictor {
  /** One eviction pass. Exposed for tests; `start()` runs it on a timer. */
  sweep(): Promise<SweepResult>;
  start(): void;
  stop(): void;
}

interface Entry {
  path: string;
  size: number;
  mtimeMs: number;
}

/**
 * Stateless filesystem cache evictor. Recency is the entry's mtime — bumped
 * on every cache hit by FileSystemStrategy — so no index is kept: each sweep
 * re-derives sizes and recency from a directory scan. Deployment is
 * single-writer (the chart fail-guards replicaCount > 1), so a scan cannot
 * race another evictor. A sweep never throws: per-file failures are logged
 * and retried naturally on the next pass.
 */
export function createCacheEvictor(options: {
  cacheDir: string;
  maxBytes?: number;
  ttlMs?: number;
  intervalMs: number;
  onSweep?: (result: SweepResult) => void;
}): CacheEvictor {
  const { cacheDir, maxBytes, ttlMs, intervalMs, onSweep } = options;
  let timer: ReturnType<typeof setInterval> | undefined;

  async function evict(entry: Entry, result: SweepResult): Promise<boolean> {
    try {
      await rm(entry.path, { force: true });
      result.evictedEntries++;
      result.evictedBytes += entry.size;
      return true;
    } catch (error) {
      logger.error(error);
      return false;
    }
  }

  async function sweep(): Promise<SweepResult> {
    const result: SweepResult = {
      scannedEntries: 0,
      totalBytes: 0,
      evictedEntries: 0,
      evictedBytes: 0,
    };
    if (!existsSync(cacheDir)) return result;
    const now = Date.now();

    const entries: Entry[] = [];
    for await (const name of new Bun.Glob('*').scan({ cwd: cacheDir, onlyFiles: true })) {
      // `${hash}.<uuid>.tmp` write buffers are in-flight uploads, never
      // eviction candidates. Committed hashes cannot contain dots
      // (isValidHash), so the suffix check is exact.
      if (name.endsWith('.tmp')) continue;
      const path = join(cacheDir, name);
      try {
        const stats = await stat(path);
        entries.push({ path, size: stats.size, mtimeMs: stats.mtimeMs });
      } catch {
        // Deleted between scan and stat — skip.
      }
    }
    result.scannedEntries = entries.length;

    const survivors: Entry[] = [];
    for (const entry of entries) {
      if (ttlMs !== undefined && now - entry.mtimeMs > ttlMs) {
        if (!(await evict(entry, result))) survivors.push(entry);
      } else {
        survivors.push(entry);
      }
    }

    let totalBytes = survivors.reduce((sum, entry) => sum + entry.size, 0);
    if (maxBytes !== undefined && totalBytes > maxBytes) {
      survivors.sort((a, b) => a.mtimeMs - b.mtimeMs);
      for (const entry of survivors) {
        if (totalBytes <= maxBytes) break;
        if (await evict(entry, result)) totalBytes -= entry.size;
      }
    }
    result.totalBytes = totalBytes;
    return result;
  }

  return {
    sweep,
    start(): void {
      if (timer !== undefined) return;
      timer = setInterval(() => {
        sweep()
          .then(onSweep)
          .catch((error) => logger.error(error));
      }, intervalMs);
    },
    stop(): void {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/cache/eviction.spec.ts`
Expected: 6 pass, 0 fail.

- [ ] **Step 5: Format, lint, typecheck, commit**

```bash
bun run format && bun run lint && bun run typecheck
git add src/cache/eviction.ts src/cache/eviction.spec.ts
git commit -m "feat(cache): add stateless mtime-based eviction sweeper"
```

---

### Task 2: mtime bump on filesystem cache hits

**Files:**

- Modify: `src/cache/storage-strategy/file-system.ts` (the `getStream` method and the `node:fs/promises` import)
- Test: `src/cache/storage-strategy/file-system.spec.ts` (append one test)

**Interfaces:**

- Consumes: nothing new.
- Produces: the recency signal Task 1's sweeper reads — a committed entry's mtime now means "last accessed".

- [ ] **Step 1: Write the failing test**

Append to the existing `describe` block in `src/cache/storage-strategy/file-system.spec.ts` (reuse the file's existing imports/helpers where they exist; add `statSync`, `utimesSync` to the `node:fs` import if missing):

```ts
it('bumps mtime on getStream so eviction sees the entry as recently used', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rc-fs-recency-'));
  const strategy = new FileSystemStrategy(dir);
  const body = new Response(new Uint8Array(10)).body as ReadableStream<Uint8Array>;
  await strategy.writeStream('recencyhash01', body);

  const path = join(dir, 'recencyhash01');
  const past = (Date.now() - 3_600_000) / 1000;
  utimesSync(path, past, past);

  await (await strategy.getStream('recencyhash01')).getReader().read();

  // The bump is fire-and-forget; poll briefly instead of racing it.
  const cutoff = Date.now() - 60_000;
  let mtimeMs = statSync(path).mtimeMs;
  for (let i = 0; i < 50 && mtimeMs <= cutoff; i++) {
    await Bun.sleep(10);
    mtimeMs = statSync(path).mtimeMs;
  }
  expect(mtimeMs).toBeGreaterThan(cutoff);
  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/cache/storage-strategy/file-system.spec.ts`
Expected: the new test FAILS on the `toBeGreaterThan` assertion (mtime stays one hour in the past); existing tests still pass.

- [ ] **Step 3: Implement the bump**

In `src/cache/storage-strategy/file-system.ts`, add `utimes` to the promises import:

```ts
import { link, mkdir, rm, utimes } from 'node:fs/promises';
```

and replace the `getStream` method:

```ts
async getStream(hash: string): Promise<ReadableStream> {
  const path = this.getPath(hash);
  // Eviction recency: mtime means "last accessed" (see src/cache/eviction.ts).
  // Fire-and-forget — a failed bump must never fail the read; the entry just
  // keeps its older mtime and stays more evictable.
  const now = new Date();
  utimes(path, now, now).catch(() => {});
  return Bun.file(path).stream();
}
```

(The failure path is enforced by construction — the promise is detached and its rejection swallowed — rather than unit-tested: `utimes` cannot be made to fail portably for a file the test just created, and the direct named import can't be stubbed in `bun:test`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/cache/storage-strategy/file-system.spec.ts`
Expected: all pass, including the new test.

- [ ] **Step 5: Format, lint, typecheck, commit**

```bash
bun run format && bun run lint && bun run typecheck
git add src/cache/storage-strategy/file-system.ts src/cache/storage-strategy/file-system.spec.ts
git commit -m "feat(cache): treat mtime as last-access by bumping it on reads"
```

---

### Task 3: Eviction metrics

**Files:**

- Modify: `src/metrics/metrics-registry.ts`
- Modify: `README.md` (the Prometheus metrics feature bullet)
- Test: `src/metrics/metrics-registry.spec.ts` (append two tests)

**Interfaces:**

- Consumes: `SweepResult` from `src/cache/eviction.ts` (Task 1).
- Produces: `MetricsRegistry.recordSweep(result: SweepResult): void` — Task 4 wires the evictor's `onSweep` to it. Rendered series: `nx_cache_evicted_entries_total`, `nx_cache_evicted_bytes_total` (counters), `nx_cache_size_bytes` (gauge).

- [ ] **Step 1: Write the failing tests**

Append to `src/metrics/metrics-registry.spec.ts`:

```ts
it('renders eviction counters and the cache size gauge', () => {
  const registry = new MetricsRegistry();
  registry.recordSweep({
    scannedEntries: 5,
    totalBytes: 500,
    evictedEntries: 2,
    evictedBytes: 300,
  });
  registry.recordSweep({
    scannedEntries: 4,
    totalBytes: 400,
    evictedEntries: 1,
    evictedBytes: 100,
  });

  const text = registry.render();

  expect(text).toContain('nx_cache_evicted_entries_total 3');
  expect(text).toContain('nx_cache_evicted_bytes_total 400');
  // Gauge, not counter: the latest sweep wins.
  expect(text).toContain('nx_cache_size_bytes 400');
  expect(text).toContain('# TYPE nx_cache_size_bytes gauge');
});

it('seeds eviction metrics at zero before any sweep', () => {
  const text = new MetricsRegistry().render();
  expect(text).toContain('nx_cache_evicted_entries_total 0');
  expect(text).toContain('nx_cache_evicted_bytes_total 0');
  expect(text).toContain('nx_cache_size_bytes 0');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/metrics/metrics-registry.spec.ts`
Expected: FAIL — `recordSweep is not a function`.

- [ ] **Step 3: Implement recordSweep and the new series**

In `src/metrics/metrics-registry.ts`, add the type import at the top:

```ts
import type { SweepResult } from '../cache/eviction';
```

add three private fields after `private uploadedBytes = 0;`:

```ts
private evictedEntries = 0;
private evictedBytes = 0;
private cacheSizeBytes = 0;
```

add the method after `recordCacheRequest`:

```ts
/** Record an eviction sweep. Counters accumulate; the gauge is the latest sweep's total. */
recordSweep(result: SweepResult): void {
  this.evictedEntries += result.evictedEntries;
  this.evictedBytes += result.evictedBytes;
  this.cacheSizeBytes = result.totalBytes;
}
```

and in `render()`, after the existing `nx_cache_uploaded_bytes_total` push and before the `return`:

```ts
lines.push(
  '# HELP nx_cache_evicted_entries_total Cache entries deleted by the eviction sweeper.',
  '# TYPE nx_cache_evicted_entries_total counter',
  `nx_cache_evicted_entries_total ${this.evictedEntries}`,
  '# HELP nx_cache_evicted_bytes_total Bytes reclaimed by the eviction sweeper.',
  '# TYPE nx_cache_evicted_bytes_total counter',
  `nx_cache_evicted_bytes_total ${this.evictedBytes}`,
  '# HELP nx_cache_size_bytes Committed cache size in bytes as of the last eviction sweep.',
  '# TYPE nx_cache_size_bytes gauge',
  `nx_cache_size_bytes ${this.cacheSizeBytes}`,
);
```

- [ ] **Step 4: Update the README metrics bullet (same commit — docs rule)**

In `README.md`, change:

```md
- Prometheus metrics at `GET /metrics` (unauthenticated; cache hit-rate, request counts, uploaded bytes)
```

to:

```md
- Prometheus metrics at `GET /metrics` (unauthenticated; cache hit-rate, request counts, uploaded bytes, eviction counters)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test src/metrics/`
Expected: all pass (registry and get-metrics specs).

- [ ] **Step 6: Format, lint, typecheck, commit**

```bash
bun run format && bun run lint && bun run typecheck
git add src/metrics/metrics-registry.ts src/metrics/metrics-registry.spec.ts README.md
git commit -m "feat(metrics): add eviction counters and cache size gauge"
```

---

### Task 4: Wire eviction into the server (config, validation, shutdown, docs)

**Files:**

- Modify: `src/main.ts`
- Modify: `docs-site/src/content/docs/guides/configuration.md`
- Modify: `docs-site/src/content/docs/guides/storage-strategies.md`
- Modify: `README.md` (features list)
- Test: `e2e/startup-validation.e2e.spec.ts` (append one test)

**Interfaces:**

- Consumes: `createCacheEvictor`, `CacheEvictor` from `src/cache/eviction.ts` (Task 1); `MetricsRegistry.recordSweep` (Task 3); `FileSystemStrategy` (exposes `public readonly cacheDir`).
- Produces: env vars `CACHE_MAX_BYTES`, `CACHE_TTL_HOURS`, `CACHE_SWEEP_INTERVAL_MS` (default `60000`); startup error containing `lifecycle rules` when eviction is set with a non-filesystem strategy.

- [ ] **Step 1: Write the failing e2e test**

Append to the `describe` block in `e2e/startup-validation.e2e.spec.ts`:

```ts
it('refuses to start when eviction is configured with the s3 strategy', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rc-startup-eviction-'));
  const proc = Bun.spawn(['bun', 'src/main.ts'], {
    env: {
      ...Bun.env,
      ADMIN_TOKEN: 'e2e-admin-token-0123456789abcdef',
      PORT: '4014',
      STORAGE_STRATEGY: 's3',
      S3_BUCKET: 'irrelevant',
      S3_REGION: 'us-east-1',
      CACHE_MAX_BYTES: '1000000',
      TOKENS_DB_PATH: join(dir, 'tokens.sqlite'),
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const exitCode = await proc.exited;
  const stderr = await new Response(proc.stderr).text();
  rmSync(dir, { recursive: true, force: true });

  expect(exitCode).toBe(1);
  expect(stderr).toContain('lifecycle rules');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test e2e/startup-validation.e2e.spec.ts`
Expected: the new test FAILS — the server starts (or exits for a different reason), so either the exit code isn't 1 within the timeout or stderr lacks `lifecycle rules`.

- [ ] **Step 3: Wire main.ts**

In `src/main.ts`:

**(a)** Add two imports:

```ts
import { createCacheEvictor, type CacheEvictor } from './cache/eviction';
import { FileSystemStrategy } from './cache/storage-strategy/file-system';
```

**(b)** After the `SHUTDOWN_DRAIN_TIMEOUT_MS` const, add:

```ts
const CACHE_MAX_BYTES = Bun.env.CACHE_MAX_BYTES ? Number(Bun.env.CACHE_MAX_BYTES) : undefined;
const CACHE_TTL_HOURS = Bun.env.CACHE_TTL_HOURS ? Number(Bun.env.CACHE_TTL_HOURS) : undefined;
const CACHE_SWEEP_INTERVAL_MS = Number(Bun.env.CACHE_SWEEP_INTERVAL_MS ?? '60000');
```

**(c)** After the existing `requirePositiveNumber('SHUTDOWN_DRAIN_TIMEOUT_MS', …)` line, add:

```ts
if (CACHE_MAX_BYTES !== undefined) requirePositiveNumber('CACHE_MAX_BYTES', CACHE_MAX_BYTES);
if (CACHE_TTL_HOURS !== undefined) requirePositiveNumber('CACHE_TTL_HOURS', CACHE_TTL_HOURS);
requirePositiveNumber('CACHE_SWEEP_INTERVAL_MS', CACHE_SWEEP_INTERVAL_MS);
```

**(d)** After the `ADMIN_TOKEN` length check (before the TLS block), add:

```ts
const evictionEnabled = CACHE_MAX_BYTES !== undefined || CACHE_TTL_HOURS !== undefined;
let evictor: CacheEvictor | undefined;
if (evictionEnabled) {
  if (!(storage instanceof FileSystemStrategy)) {
    logger.error(
      'Error: CACHE_MAX_BYTES and CACHE_TTL_HOURS apply only to STORAGE_STRATEGY=filesystem. For S3, use bucket lifecycle rules instead — see the storage-strategies guide.',
    );
    process.exit(1);
  }
  evictor = createCacheEvictor({
    cacheDir: storage.cacheDir,
    maxBytes: CACHE_MAX_BYTES,
    ttlMs: CACHE_TTL_HOURS !== undefined ? CACHE_TTL_HOURS * 3_600_000 : undefined,
    intervalMs: CACHE_SWEEP_INTERVAL_MS,
    onSweep: (result) => metrics.recordSweep(result),
  });
}
```

**(e)** After `logger.info(\`Server running at ${server.url}\`);`, add:

```ts
evictor?.start();
```

**(f)** In `shutdown`, stop the timer first — a sweep firing mid-shutdown has nothing useful to do:

```ts
const shutdown = async (signal: string) => {
  evictor?.stop();
  logger.info(`Received ${signal}, draining ${activeUploads} in-flight upload(s)`);
  // …rest unchanged
```

- [ ] **Step 4: Run the e2e test to verify it passes**

Run: `bun test e2e/startup-validation.e2e.spec.ts`
Expected: 3 pass (the two existing tests plus the new one).

- [ ] **Step 5: Document the env vars (same commit — docs rule)**

**`docs-site/src/content/docs/guides/configuration.md`** — add three rows to the table directly after the `CACHE_DIR` row (match the existing column alignment; oxfmt normalizes it):

```md
| `CACHE_MAX_BYTES` | no | — | Opt-in size cap for the filesystem cache; a background sweep evicts least-recently-used entries until the cache fits. Filesystem strategy only. |
| `CACHE_TTL_HOURS` | no | — | Opt-in TTL for the filesystem cache; the sweep deletes entries not accessed within the window. Filesystem strategy only. |
| `CACHE_SWEEP_INTERVAL_MS` | no | `60000` | Eviction sweep period. The sweeper only runs when a cap or TTL is set. |
```

and append this paragraph to the `## Notes` section:

```md
`CACHE_MAX_BYTES` and `CACHE_TTL_HOURS` enable built-in eviction for the filesystem strategy; each works alone and they compose (TTL runs first, then the size cap). "Accessed" means read or written — every cache hit refreshes an entry's recency, so artifacts in active use survive the TTL and are the last candidates for the size cap. Size the cap well above your largest artifact: a smaller cap evicts that artifact on the next sweep. Setting either variable with `STORAGE_STRATEGY=s3` is a startup error — use bucket lifecycle rules instead (see [Storage strategies](/guides/storage-strategies/)).
```

**`docs-site/src/content/docs/guides/storage-strategies.md`** — replace the `## Cache growth and pruning` section's opening (from `The server never deletes cache entries` through the `noatime` paragraph, keeping the `**S3.**` part unchanged) with:

````md
Set `CACHE_MAX_BYTES` and/or `CACHE_TTL_HOURS` to turn on built-in eviction for the filesystem
strategy: a background sweep evicts least-recently-used entries once the cache exceeds the cap and
deletes entries not accessed within the TTL window. Every cache hit refreshes an entry's recency,
so artifacts in active use stay. See [Configuration](/guides/configuration/) for the variables,
and watch `nx_cache_size_bytes` / `nx_cache_evicted_bytes_total` on `/metrics` to confirm eviction
keeps up with growth.

**Filesystem (manual fallback).** On releases without built-in eviction, prune with cron. Entries
are plain files named by hash under `CACHE_DIR`; deleting one just makes the next request for that
hash a cache miss, and writes are atomic, so pruning while the server is running is safe:

```sh
find "$CACHE_DIR" -maxdepth 1 -type f -mtime +30 -delete
```

(Current releases treat mtime as last-access — it's bumped on every read — so `-mtime` is the
right find test; `-atime` breaks on `noatime` mounts.)
````

**`README.md`** — in the Features list, add under the storage strategies bullet group:

```md
- Opt-in filesystem cache eviction (`CACHE_MAX_BYTES` LRU size cap, `CACHE_TTL_HOURS` last-access TTL)
```

- [ ] **Step 6: Full test run, format, lint, typecheck**

Run: `bun test && bun run format && bun run lint && bun run typecheck`
Expected: all tests pass (90+ pass, 6 MinIO skips locally), all gates clean.

- [ ] **Step 7: Commit**

```bash
git add src/main.ts e2e/startup-validation.e2e.spec.ts docs-site/src/content/docs/guides/configuration.md docs-site/src/content/docs/guides/storage-strategies.md README.md
git commit -m "feat(server): wire opt-in filesystem cache eviction"
```

---

### Task 5: End-to-end eviction proof over HTTP

**Files:**

- Test (create): `e2e/eviction.e2e.spec.ts`

**Interfaces:**

- Consumes: `spawnServer`, `E2E_ADMIN_TOKEN`, `SpawnedServer` from `e2e/spawn-server.ts`; env vars from Task 4; metric names from Task 3. Port **4017** (per the registry in Global Constraints).

- [ ] **Step 1: Write the e2e spec**

Create `e2e/eviction.e2e.spec.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { E2E_ADMIN_TOKEN, spawnServer, type SpawnedServer } from './spawn-server';

const PORT = 4017;

describe('cache eviction e2e', () => {
  let server: SpawnedServer;

  beforeAll(async () => {
    server = await spawnServer(PORT, {
      CACHE_MAX_BYTES: '2500',
      CACHE_SWEEP_INTERVAL_MS: '200',
    });
  });

  afterAll(async () => {
    await server.stop();
  });

  const put = (hash: string, bytes: number) =>
    fetch(`${server.baseUrl}/v1/cache/${hash}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${E2E_ADMIN_TOKEN}` },
      body: new Uint8Array(bytes),
    });
  const get = (hash: string) =>
    fetch(`${server.baseUrl}/v1/cache/${hash}`, {
      headers: { Authorization: `Bearer ${E2E_ADMIN_TOKEN}` },
    });

  it('evicts the least-recently-used entry once the cap is exceeded', async () => {
    expect((await put('evictolder01', 1000)).status).toBe(200);
    await Bun.sleep(50); // separate mtimes so LRU order is unambiguous
    expect((await put('evictstale02', 1000)).status).toBe(200);
    await Bun.sleep(50);
    // Freshen the first entry: a cache hit bumps recency, so the *second*
    // entry becomes the least recently used.
    expect((await get('evictolder01')).status).toBe(200);
    await Bun.sleep(50);
    // 3000 bytes total now exceeds the 2500-byte cap.
    expect((await put('evictnewer03', 1000)).status).toBe(200);

    // Poll /metrics for the sweep — polling the entry itself would bump its
    // recency and change the LRU order under test.
    let metricsText = '';
    for (let i = 0; i < 50; i++) {
      metricsText = await (await fetch(`${server.baseUrl}/metrics`)).text();
      if (metricsText.includes('nx_cache_evicted_entries_total 1')) break;
      await Bun.sleep(100);
    }
    expect(metricsText).toContain('nx_cache_evicted_entries_total 1');
    expect(metricsText).toContain('nx_cache_evicted_bytes_total 1000');
    expect(metricsText).toContain('nx_cache_size_bytes 2000');

    expect((await get('evictstale02')).status).toBe(404);
    expect((await get('evictolder01')).status).toBe(200);
    expect((await get('evictnewer03')).status).toBe(200);
  }, 15000);
});
```

- [ ] **Step 2: Run the e2e spec**

Run: `bun test e2e/eviction.e2e.spec.ts`
Expected: 1 pass. If it fails, the most likely cause is LRU-order flakiness from mtime resolution — re-check that no code path GETs `evictstale02` before the eviction assertion.

- [ ] **Step 3: Run the full suite twice (flake check)**

Run: `bun test && bun test`
Expected: identical pass counts, 0 fail both times.

- [ ] **Step 4: Format, lint, commit**

```bash
bun run format && bun run lint && bun run typecheck
git add e2e/eviction.e2e.spec.ts
git commit -m "test(e2e): prove LRU eviction and eviction metrics over HTTP"
```

---

### Task 6: Expose eviction in the Helm chart

**Files:**

- Modify: `charts/remotecache/values.yaml` (the `config:` block, lines 30–35)
- Modify: `charts/remotecache/templates/deployment.yaml` (fail-guards at the top; env under the filesystem block)
- Modify: `charts/remotecache/ci/extras-values.yaml`
- Modify: `docs-site/src/content/docs/deploy/kubernetes.md` (Key values table)

**Interfaces:**

- Consumes: env vars from Task 4. Value names come from the spec: `config.cacheMaxBytes`, `config.cacheTtlHours`, `config.sweepIntervalMs`.

- [ ] **Step 1: Add commented defaults to values.yaml**

Extend the `config:` block:

```yaml
config:
  port: 3000
  # bindAddress: "0.0.0.0" (default) or "::" for IPv6 / dual-stack pods.
  bindAddress: '0.0.0.0'
  maxUploadBytes: 524288000
  verbose: false
  # Opt-in filesystem cache eviction (filesystem strategy only). Leave unset
  # for today's behavior: no eviction.
  # cacheMaxBytes: 10737418240 # evict least-recently-used entries over this total
  # cacheTtlHours: 720 # evict entries not accessed within this window
  # sweepIntervalMs: 60000 # sweep period; only runs when a policy above is set
```

- [ ] **Step 2: Wire the deployment template**

In `charts/remotecache/templates/deployment.yaml`, add a fail-guard after the existing `replicaCount > 1` guard (line 15):

```yaml
{{- if and (ne .Values.storage.strategy "filesystem") (or .Values.config.cacheMaxBytes .Values.config.cacheTtlHours) }}
{{- fail "remotecache: config.cacheMaxBytes/cacheTtlHours require storage.strategy=filesystem (use S3 lifecycle rules instead)" }}
{{- end }}
```

and add the env wiring inside the `{{- if eq .Values.storage.strategy "filesystem" }}` block, directly after the `CACHE_DIR` entry:

```yaml
{{- with .Values.config.cacheMaxBytes }}
- name: CACHE_MAX_BYTES
  value: {{ . | int64 | quote }}
{{- end }}
{{- with .Values.config.cacheTtlHours }}
- name: CACHE_TTL_HOURS
  value: {{ . | quote }}
{{- end }}
{{- with .Values.config.sweepIntervalMs }}
- name: CACHE_SWEEP_INTERVAL_MS
  value: {{ . | quote }}
{{- end }}
```

(Indent to match the surrounding `env:` entries — 12 spaces for `- name:`.)

- [ ] **Step 3: Exercise it in chart CI values**

Append to `charts/remotecache/ci/extras-values.yaml` (Helm deep-merges, so this only adds keys to `config`):

```yaml
config:
  cacheMaxBytes: 10737418240
  cacheTtlHours: 720
```

- [ ] **Step 4: Verify the template**

```bash
helm lint charts/remotecache --set adminToken=ci-admin-token-0123456789
helm template rc charts/remotecache -f charts/remotecache/ci/extras-values.yaml --set adminToken=ci-admin-token-0123456789 | grep -A1 'CACHE_MAX_BYTES\|CACHE_TTL_HOURS'
helm template rc charts/remotecache -f charts/remotecache/ci/s3-values.yaml --set adminToken=ci-admin-token-0123456789 --set config.cacheMaxBytes=1000 2>&1 | grep 'lifecycle rules'
```

Expected: lint passes; the extras render shows `CACHE_MAX_BYTES` value `"10737418240"` and `CACHE_TTL_HOURS` value `"720"`; the s3 render fails with the lifecycle-rules message.

- [ ] **Step 5: Document the values (same commit — docs rule)**

In `docs-site/src/content/docs/deploy/kubernetes.md`, add to the Key values table after the `config.maxUploadBytes` row:

```md
| `config.cacheMaxBytes` / `config.cacheTtlHours` | Opt-in filesystem cache eviction: LRU size cap (bytes) and last-access TTL (hours). Filesystem strategy only. |
```

- [ ] **Step 6: Commit**

```bash
bun run format --check
git add charts/remotecache/values.yaml charts/remotecache/templates/deployment.yaml charts/remotecache/ci/extras-values.yaml docs-site/src/content/docs/deploy/kubernetes.md
git commit -m "feat(chart): expose cache eviction settings"
```

---

### Task 7: Final verification and roadmap update

**Files:**

- Modify: `docs/superpowers/plans/2026-07-05-remotecache-roadmap.md` (Phase 3 item 1)

- [ ] **Step 1: Full gate, fresh**

```bash
bun test && bun test
bun run typecheck && bun run lint && bun run format --check
helm lint charts/remotecache --set adminToken=ci-admin-token-0123456789
```

Expected: identical pass counts across both test runs, 0 fail; every gate clean.

- [ ] **Step 2: Docs build**

```bash
cd docs-site && bun install --frozen-lockfile && bun run build && cd ..
```

Expected: Astro build succeeds (catches broken doc links from Task 4/6 edits).

- [ ] **Step 3: Mark the roadmap**

In `docs/superpowers/plans/2026-07-05-remotecache-roadmap.md`, change Phase 3 item 1 to:

```md
1. **Cache eviction/GC** — shipped: opt-in `CACHE_MAX_BYTES` LRU cap + `CACHE_TTL_HOURS` sweep
   (spec: [`../specs/2026-07-06-cache-eviction-design.md`](../specs/2026-07-06-cache-eviction-design.md),
   plan: [`2026-07-06-cache-eviction.md`](./2026-07-06-cache-eviction.md)). The S3 lifecycle recipe
   already landed in Phase 2.
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-07-05-remotecache-roadmap.md
git commit -m "docs(superpowers): mark cache eviction shipped in the roadmap"
```

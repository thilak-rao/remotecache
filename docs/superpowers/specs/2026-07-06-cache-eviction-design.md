# Filesystem Cache Eviction — Design

> Approved 2026-07-06. First feature of Phase 3 in
> [`../plans/2026-07-05-remotecache-roadmap.md`](../plans/2026-07-05-remotecache-roadmap.md).
> GCS/Azure storage strategies and the deep `/ready` probe get their own
> brainstorm → spec → plan cycles after this ships.

**Goal:** Bound filesystem cache growth with an opt-in size cap (LRU) and an
opt-in TTL sweep, so a remotecache deployment never fills its disk and stale
artifacts age out — without changing behavior for anyone who sets nothing.

**Non-goals:** Eviction for the S3 strategy (object storage evicts natively;
the lifecycle-rule runbook in `docs-site` storage-strategies guide covers it),
per-entry pinning, high/low watermark hysteresis, and any persistent index
(SQLite or in-memory) of cache entries.

## Decisions made during brainstorming

1. **Scope:** eviction/GC only, its own spec/plan cycle (not a combined
   Phase 3 spec).
2. **Policies:** size cap (LRU) _and_ TTL, each independently opt-in, both
   composable, both off by default.
3. **Mechanism:** stateless sweeper keyed on file mtime — no accounting index.
   Rationale: zero new state, crash-safe, self-heals after manual deletions,
   and the chart's `replicaCount > 1` fail-guard makes directory scans
   race-free. Rejected: SQLite accounting table (second source of truth that
   drifts from disk, DB write on the GET hot path) and in-memory index (lost
   on restart, still needs the startup scan).
4. **TTL unit:** `CACHE_TTL_HOURS` — a deliberate deviation from the `_MS`
   suffix convention, approved because operators think in hours/days.

## Configuration

All opt-in; absent means today's behavior (no eviction, no sweeper timer).

| Env var                   | Meaning                                                                                        | Default        |
| ------------------------- | ---------------------------------------------------------------------------------------------- | -------------- |
| `CACHE_MAX_BYTES`         | Evict least-recently-used entries when the cache directory's total committed size exceeds this | unset (no cap) |
| `CACHE_TTL_HOURS`         | Delete entries whose last access is older than this window                                     | unset (no TTL) |
| `CACHE_SWEEP_INTERVAL_MS` | Sweeper period; the timer only starts when at least one policy is set                          | `60000`        |

Startup validation (fail loud, matching the Phase 2 fail-fast work):

- `CACHE_MAX_BYTES` or `CACHE_TTL_HOURS` set while `STORAGE_STRATEGY=s3` →
  `logger.error` + exit 1, message pointing at the S3 lifecycle-rules section
  of the storage-strategies guide.
- All three values validated with the existing `requirePositiveNumber`
  helper in `src/main.ts`.

## Architecture

Two small pieces; the `CacheStorageStrategy` interface does not change and the
S3 strategy is untouched.

### Recency signal — mtime bump on read

`FileSystemStrategy.getStream(hash)` fires-and-forgets
`utimes(path, now, now)` on every cache hit, so a committed entry's mtime
means "last accessed". Writes already leave a fresh mtime via the temp-file
commit. The bump must never fail a GET: errors are swallowed (the entry
simply keeps its older mtime and becomes more evictable).

### Sweeper — `src/cache/eviction.ts`

```ts
interface SweepResult {
  scannedEntries: number;
  totalBytes: number; // committed size after the sweep
  evictedEntries: number;
  evictedBytes: number;
}

function createCacheEvictor(options: {
  cacheDir: string;
  maxBytes?: number;
  ttlMs?: number; // CACHE_TTL_HOURS converted once at startup
  intervalMs: number;
  onSweep?: (result: SweepResult) => void; // main.ts wires metrics here
}): {
  sweep(): Promise<SweepResult>; // exported for unit tests
  start(): void; // setInterval(sweep, intervalMs)
  stop(): void; // clearInterval; safe to call twice
};
```

`sweep()` algorithm:

1. Scan `cacheDir` with `Bun.Glob`, **excluding `*.tmp`** (in-flight upload
   buffers are never eviction candidates).
2. `stat` every entry → `{ path, size, mtimeMs }`.
3. **TTL pass** (if `ttlMs` set): delete entries with
   `now - mtimeMs > ttlMs`.
4. **LRU pass** (if `maxBytes` set): if the surviving total exceeds
   `maxBytes`, sort by `mtimeMs` ascending and delete until total ≤
   `maxBytes`. No watermark hysteresis — deletes are cheap and nothing is
   rewritten, so sweeping at the cap is not thrash.
5. Return `SweepResult`; the caller records metrics.

`main.ts` wiring: construct the evictor only when `STORAGE_STRATEGY`
is `filesystem` and at least one policy is set; `start()` after the server
binds; `stop()` in the existing SIGTERM/SIGINT shutdown path before the
upload drain.

## Safety properties

- **In-flight uploads:** `*.tmp` excluded from the scan; the atomic
  `link()` commit means a hash is either absent or complete.
- **In-flight downloads:** POSIX unlink leaves open file handles readable;
  an evicted entry mid-stream finishes streaming.
- **Fresh entries:** a just-committed artifact has the newest mtime, so it is
  the last LRU candidate. Documented (not guarded) edge: a cap smaller than
  your largest artifact evicts that artifact on the next sweep — docs say to
  size `CACHE_MAX_BYTES` well above the largest artifact.
- **Failure isolation:** a sweep error is `logger.error`ed and the timer
  keeps running; a per-file delete failure is skipped (retried naturally next
  sweep). The sweeper can never crash the server.
- **`noatime` mounts:** irrelevant — recency is mtime, written explicitly by
  the server, not atime.

## Observability

Three additions to the existing `/metrics` Prometheus surface:

- `nx_cache_evicted_entries_total` (counter)
- `nx_cache_evicted_bytes_total` (counter)
- `nx_cache_size_bytes` (gauge, set from each `SweepResult.totalBytes`)

(Names carry the `nx_cache_` prefix to match the existing
`nx_cache_requests_total` / `nx_cache_uploaded_bytes_total` series.)

## Testing

- **Unit (`src/cache/eviction.spec.ts`):** run `sweep()` against fixture temp
  dirs with `utimesSync`-controlled mtimes — TTL deletions, LRU ordering, cap
  arithmetic (stops deleting once ≤ cap), `.tmp` exclusion, empty/missing
  dir, and delete-failure tolerance.
- **Unit (`file-system.spec.ts`):** `getStream` bumps mtime on hit. (The
  bump-failure path is enforced by construction — detached promise, swallowed
  rejection — not unit-tested: `utimes` can't be made to fail portably for a
  file the test just created.)
- **E2E (`e2e/eviction.e2e.spec.ts`, port 4017 — next free in the registry):**
  spawn a server with a tiny `CACHE_MAX_BYTES` and
  `CACHE_SWEEP_INTERVAL_MS=200`; PUT three entries, GET one to freshen it,
  wait past a sweep, assert the stale entry 404s and the freshened one
  survives; assert the new `/metrics` counters moved.
- **E2E (`e2e/startup-validation.e2e.spec.ts`):** `STORAGE_STRATEGY=s3` +
  `CACHE_MAX_BYTES` → exit 1 with the lifecycle-rules message.

## Docs & chart (same commits as the code)

- `docs-site` Configuration page: rows for the three new env vars.
- `docs-site` storage-strategies guide, "Cache growth and pruning": built-in
  eviction becomes the primary answer; the cron runbook remains as the
  fallback for older versions; S3 lifecycle section unchanged.
- Helm chart: `config.cacheMaxBytes`, `config.cacheTtlHours`,
  `config.sweepIntervalMs` in `values.yaml` (unset by default), wired as env
  vars in `deployment.yaml` under the existing
  `storage.strategy == "filesystem"` block.
- `README.md` features list: one eviction bullet.
- `CLAUDE.md`: no change (no new commands; env vars live in the docs-site
  Configuration page per the existing rule).
- No OpenAPI change — the HTTP surface is untouched.

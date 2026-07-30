# Adversarial test sweep

## Baseline

Measured on 2026-07-29 from commit `441dcce8ed150191eb59d6e9e6e51d97bb112631`
with Bun 1.3.14:

| Command                  | Result                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `bun test`               | 132 pass, 8 skip, 0 fail, 368 `expect()` calls, 140 tests across 30 files in 3.93s |
| `bun test --coverage`    | 90.63% functions and 92.18% lines; the same 132 pass and 8 skip completed in 3.73s |
| `bun run format --check` | Pass; all 128 matched files used the expected format                               |
| `bun run lint`           | Pass; no findings                                                                  |
| `bun run typecheck`      | Pass; `tsc --noEmit` reported no errors                                            |

The eight skips are the endpoint-gated cases in `e2e/s3-minio.e2e.spec.ts`;
they are expected when `S3_E2E_ENDPOINT` is unset, but they remain visible here
and were run without skips against the dedicated MinIO container during this
sweep. The supplied baseline took about 4.24s, while the fresh ordinary run took
3.93s with identical counts, a normal wall-clock variation.

## Bounded scope

This sweep covers local unit and end-to-end tests, temporary filesystem and
SQLite state, mocked GCS behavior, and the S3 path against the Docker MinIO
image pinned in CI. New stress cases stay bounded by the design: at most 32
clients, 8 MiB per request, 64 MiB of aggregate live payload, a 10-second case
timeout, and 20 repetitions for race-sensitive cases. The existing 140 MiB
upload test remains as the one distinct check above Bun's default body limit
and is not part of the repeated stress runs; Docker cases have a 60-second cap.

It does not contact live AWS or Google Cloud services, attempt unbounded
resource exhaustion, perform destructive operations on the host, or add
synthetic stress beyond that bounded contention and repetition. Permission
faults or other cases that depend on changing host-wide state are excluded when
an isolated temporary-directory test cannot reproduce them safely.

## Final evidence

Measured with Bun 1.3.14 after consolidation and the final whole-branch review
fixes:

| Command or run               | Result                                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Focused post-review checks   | Startup 14/14, `writeCache` 13/13, and raw request boundaries 4/4 passed; token tests created no net temporary residue |
| `bun test`                   | 152 pass, 9 skip, 0 fail, 480 `expect()` calls, 161 tests across 31 files                                              |
| `bun test --coverage`        | 92.59% functions and 94.78% lines; the same 152 pass, 9 skip, and 0 fail                                               |
| `writeCache` repetition      | 20 of 20 runs passed; 260 tests and 1,700 `expect()` calls completed with 0 failures                                   |
| Local race repetition        | 20 of 20 iterations passed; each ran 18 tests and 66 `expect()` calls, for 360 pass and 0 fail overall                 |
| Pinned MinIO repetition      | 20 of 20 iterations passed; each ran all 7 tests and 17 `expect()` calls with 0 skips, for 140 pass and 0 fail overall |
| Static, docs, and diff gates | Format, lint, typecheck, the 29-page docs build and link check, and `git diff --check` passed                          |

All nine ordinary-suite skips come from `describe.skipIf(!S3_E2E_ENDPOINT)` in
`e2e/s3-minio.e2e.spec.ts`: without the endpoint, Bun reports the seven
endpoint-dependent tests and the suite's two lifecycle hooks as skipped; with
the endpoint set, each dedicated run reported seven passes and no skips.

The sweep began at 132 passes, 368 assertions, 140 tests, 30 files, 90.63%
function coverage, and 92.18% line coverage. Immediately before pruning, the
suite had 148 passes, 431 assertions, and 157 tests. Consolidation removed three
duplicate wrapper tests, then two dense reader-lifetime contracts brought the
suite to 147 passes, 461 assertions, and 156 tests. Whole-branch review added
five focused regressions and strengthened existing lifecycle checks with eight
assertions. The final suite therefore has 152 passes, 480 assertions, and 161
tests: four more tests and 49 more assertions than the pre-consolidation suite,
with final coverage of 92.59% functions and 94.78% lines.

## Consolidation decisions

- `isValidHash` keeps separate valid-value, dot, traversal, empty/undefined,
  length-boundary, and charset contracts. One charset loop now checks a space,
  Unicode, a newline, a null byte, and an encoded separator.
- `addToken` keeps authorization, JSON parse failure, field and permission
  validation, both conflicts, unknown storage failure, and success-shape tests.
  Its former scalar-only case is now one six-value non-record JSON partition,
  backed by a single storage mock that must remain untouched.
- `hashToken` now has one exact UTF-8 SHA-256 vector instead of four wrapper
  properties, while `TokenStorage` still proves that the raw token is absent at
  rest, so the non-disclosure contract was not lost.

## Defects fixed with permanent regressions

1. Upload cleanup had three related gaps. Rejected writes could leave their
   request source live; terminal paths retained a standard reader lock; and
   Bun's direct HTTP reader can omit or throw from `releaseLock()`, turning a
   successful MinIO write into a 500. `writeCache` now starts cancellation once
   without letting a non-settling cleanup promise delay the 400, 409, or 500,
   and performs idempotent best-effort lock release. Focused tests cover
   overrun, underrun, storage rejection, conflict, ordinary success, a
   non-settling cancellation gate, and a Bun-like release failure. A raw HTTP
   PUT-to-GET regression and the real MinIO suite cover Bun's routed body shape.
2. Token migration could violate the primary key when one plaintext token
   equaled another token's future hash. The migration now reads every record,
   clears the table, and reinserts hashed values in one transaction, while the
   SQLite regression checks that both credentials still resolve.
3. Readiness queried SQLite itself rather than the token table, and its first
   correction threw synchronously despite returning `Promise<void>`;
   `checkReady()` now probes the runtime columns inside a true promise chain, so
   dropping `tokens` makes `await expect(...).rejects` observe the failure.
4. Byte counts and timeouts accepted fractions or values beyond JavaScript's
   safe-integer range, so startup regressions cover fractional `PORT`,
   `MAX_UPLOAD_BYTES`, `SHUTDOWN_DRAIN_TIMEOUT_MS`, `CACHE_MAX_BYTES`, and
   `CACHE_SWEEP_INTERVAL_MS`, plus an unsafe upload limit. A safe integer above
   `2,147,483,647` was still unsafe for Bun timers: the runtime clamped it to
   1 ms and could turn eviction into a continuous scan loop. Startup now rejects
   that value, accepts the exact ceiling, and also rejects a finite
   `CACHE_TTL_HOURS` whose millisecond conversion becomes infinite. Fractional
   positive TTL values remain valid by design.
5. A filesystem entry removed after `exists()` could produce a 200 whose body
   then failed. `getStream()` now primes the reader, so disappearance maps to a
   500 before response construction. Two serial regressions now hold the source
   lock while the response is open, then verify one exact `releaseLock()` on
   initial-read rejection, natural EOF, later-read rejection, successful
   consumer cancellation, and rejected consumer cancellation. The read cases
   preserve exact bytes or the original error; both cancellation cases forward
   the exact reason and preserve a rejection. Both contracts failed against the
   pre-release implementation because it never released the source reader, then
   passed with the correction; marking them `it.serial` keeps their temporary
   global `Bun.file` replacement safe under concurrent test execution.

## Review-caught test and harness defects

- The startup helper originally created temporary state outside the protected
  spawn/teardown region; nested `try`/`finally` cleanup now removes it even when
  spawning or process cleanup fails.
- The 32-client contention test initially accepted any uniform artifact, but it
  now identifies the sole 200 response and compares stored bytes with that exact
  request body.
- The request-boundary suite initially reused eviction's port 4017, so it now
  owns port 4019.
- The duplicate-length helper and its test both had a five-second timeout,
  allowing the test runner to win the race and hide the helper's diagnostic;
  the helper stays at five seconds and the test timeout is ten seconds.
- The new 32-client test had drifted to a 20-second timeout despite the
  10-second design bound; its timeout is back to ten seconds and passed 20
  independent runs.
- `TokenStorage` tests leaked one temporary database directory per case. An
  `afterEach` now removes every directory owned by the test; the focused run
  went from eight leaked directories to zero net residue, and an independent
  160-run audit also had zero drift.
- The visible readiness guide described the operational token-column probe, but
  its FAQ metadata and one test title still described a generic query. Both now
  name the behavior they document.
- The MinIO failed-upload race awaited the contender before aborting the
  incomplete request, so it relied on MinIO's internal timeout. The test now
  keeps both requests live briefly, aborts the incomplete one, rejects its own
  timeout sentinel, and then verifies the exact winning bytes. Its focused
  runtime fell from roughly 13 seconds to under half a second.

## Final risk dispositions

### Runtime units

| Unit                                                       | Meaningful adversarial risk                                                                                           | Final evidence and disposition                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main.ts`                                              | Numeric parsing, timer overflow, authentication boundaries, and shutdown races.                                       | **Covered:** safe-integer rejection, the exact timer ceiling and its first invalid value, finite TTL conversion, raw authorization boundaries, route behavior, graceful drain, in-flight drain, and forced timeout; fractional positive TTL remains valid.                                                                                                |
| `src/cache/cache-file.interface.ts`                        | Type-only handler/storage seam.                                                                                       | **No added test:** handlers and concrete strategies exercise every operation.                                                                                                                                                                                                                                                                             |
| `src/cache/create-cache-storage.ts`                        | Partial credentials, conflicting GCS sources, unknown strategies, or unusable filesystem configuration.               | **Covered:** configuration partitions and unwritable directories; **Excluded:** live cloud credential-chain resolution requires external identity state, while provider behavior is mocked.                                                                                                                                                               |
| `src/cache/eviction.ts`                                    | TTL/size ordering, failed or missing deletes, temporary files, and overlapping sweeps.                                | **Covered:** focused state tests, live LRU e2e, and 20 overlap repetitions; the e2e sweeper exercises timer start/stop, so an isolated duplicate would add no signal.                                                                                                                                                                                     |
| `src/cache/get-cache.ts`                                   | Authorization must not touch storage; files can disappear between storage operations.                                 | **Covered:** auth, validation, miss, rejection, success, and a real disappearance regression that returns 500 before building a 200 when the file disappears before stream acquisition.                                                                                                                                                                   |
| `src/cache/is-valid-hash.ts`                               | Unicode, controls, encoded separators, dots, traversal, and excessive length.                                         | **Covered:** focused compact partitions plus encoded traversal through Bun's HTTP boundary.                                                                                                                                                                                                                                                               |
| `src/cache/storage-strategy/file-system.ts`                | Concurrent commit integrity, partial artifacts, readiness, recency, read races, and reader lifetime.                  | **Covered:** atomic first-writer behavior, exact artifacts, temp cleanup, orphan sweep, readiness, recency, disappearance, and 20 race repetitions. Two serial contracts cover initial-read rejection, EOF, later-read rejection, and successful or rejected cancellation with one exact release, original errors, and cancellation reasons preserved.    |
| `src/cache/storage-strategy/gcs.ts`                        | Streaming, conditional conflicts, metadata, cancellation, and readiness.                                              | **Covered:** fake-client streaming, size metadata, two observed 412 shapes, cancellation, and readiness; **Excluded:** live GCS needs external credentials, billable mutable state, and network reliability outside this bounded run.                                                                                                                     |
| `src/cache/storage-strategy/s3.ts`                         | Credential stampedes/recovery, conditional writes, aborts, and backend capability errors.                             | **Covered:** 32-call provider coalescing invokes the provider once; a failed provider is retried; HTTP 501 rejects conditional writes; pinned MinIO covers readiness, integrity, append-only conflicts, aborts, misses, and races; **Excluded:** live AWS for the same external-state reasons.                                                            |
| `src/cache/storage-strategy/storage-strategy.interface.ts` | Strategies must preserve append-only commits and classify collisions.                                                 | **Covered:** filesystem, GCS, S3, and `writeCache` contracts; the remaining declarations are type-only.                                                                                                                                                                                                                                                   |
| `src/cache/write-cache.ts`                                 | Length syntax, absent/erroring/short/long bodies, early destination failure, reader lifetime, and first-writer races. | **Covered:** one decimal-positive-integer partition, size cap, mismatch, non-blocking single cancellation, standard lock release, Bun-direct release failure, success, storage failure, and conflict mapping.                                                                                                                                             |
| `src/health/get-health.ts`                                 | Liveness must remain unauthenticated, cheap, and stable.                                                              | **Covered:** focused response and real HTTP smoke tests; dependency failures belong to readiness.                                                                                                                                                                                                                                                         |
| `src/logger.ts`                                            | Verbose noise or hidden operator errors.                                                                              | **Covered:** startup and lifecycle e2e observe contractual stderr; **No added test:** global console mocks would introduce shared-state risk without a distinct runtime contract.                                                                                                                                                                         |
| `src/metrics/get-metrics.ts`                               | Wrong media type or registry output.                                                                                  | **Covered:** focused response and HTTP scrape tests.                                                                                                                                                                                                                                                                                                      |
| `src/metrics/metrics-registry.ts`                          | Label, counter, byte, eviction, or gauge drift.                                                                       | **Covered:** mapping, seeding, counters, unknown results, upload bytes, eviction metrics, and HTTP integration.                                                                                                                                                                                                                                           |
| `src/ready/get-ready.ts`                                   | Dependency failures can be masked or sequenced incorrectly.                                                           | **Covered:** token and storage failure branches, damaged SQLite rejection, local readiness, and real MinIO readiness.                                                                                                                                                                                                                                     |
| `src/responses.ts`                                         | Handler status, body, and headers can diverge.                                                                        | **Covered:** every factory has indirect handler coverage and 100% line/function coverage; factory-only tests would restate implementation.                                                                                                                                                                                                                |
| `src/safe-equal.ts`                                        | Empty, unequal-length, or unequal-value secrets.                                                                      | **Covered:** all equality partitions.                                                                                                                                                                                                                                                                                                                     |
| `src/tls/load-tls-config.ts`                               | Partial, missing, unreadable, or invalid TLS handoff.                                                                 | **Covered:** neither/one/both/missing-file partitions and real HTTPS; **Excluded:** host-permission mutation is platform-sensitive and adds no stable signal beyond missing/unreadable startup failure.                                                                                                                                                   |
| `src/token/add-token.ts`                                   | Malformed JSON shapes, validation, duplicate state, and secret disclosure.                                            | **Covered:** authorization, parse failure, six non-record JSON values, field and permission validation, both conflicts, unknown storage failure, and success shape.                                                                                                                                                                                       |
| `src/token/delete-token.ts`                                | Unauthorized or empty IDs, storage failure, and missing IDs.                                                          | **Covered:** authorization, validation, error, not-found, and success without mutation leaks.                                                                                                                                                                                                                                                             |
| `src/token/hash-token.ts`                                  | Digest encoding can break lookup or at-rest compatibility.                                                            | **Covered:** exact UTF-8 SHA-256 vector plus the SQLite at-rest non-disclosure test.                                                                                                                                                                                                                                                                      |
| `src/token/list-tokens.ts`                                 | Unauthorized access or response shaping can disclose values.                                                          | **Covered:** authorization, `id`/`permission` shape, and full token lifecycle e2e.                                                                                                                                                                                                                                                                        |
| `src/token/token-interfaces.ts`                            | Type-only token declarations.                                                                                         | **No added test:** handlers and SQLite tests exercise concrete records.                                                                                                                                                                                                                                                                                   |
| `src/token/token-storage.ts`                               | Migration collision/rollback, corruption, uniqueness mapping, and plaintext leakage.                                  | **Covered:** creation, hashed-at-rest lookup, deletion, value-free listing, plaintext migration, collision-safe transactional migration, healthy probe, and damaged-table promise rejection; the handler seam asserts both duplicate classifications, while a direct mapper test would pin Bun's SQLite error wording without adding a response contract. |

### End-to-end and storage boundaries

| Path                                 | Boundary risk                                                                                  | Final evidence and disposition                                                                                                                                                                                                                                |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `e2e/spawn-server.ts`                | Ambient environment, startup hangs, and temporary-state leaks can invalidate all e2e evidence. | **Covered:** isolated environment/directories, bounded health polling, and cleanup on startup failure and normal stop; startup validation has a bounded helper protected around spawn and teardown, while a direct helper test would duplicate its consumers. |
| `e2e/health.e2e.spec.ts`             | Unauthenticated process liveness.                                                              | **Covered:** real status, media type, and body.                                                                                                                                                                                                               |
| `e2e/ready.e2e.spec.ts`              | Dependency readiness through the live route.                                                   | **Covered:** local filesystem/SQLite success; damaged SQLite is focused at the dependency seam, and MinIO verifies the live S3 route.                                                                                                                         |
| `e2e/metrics.e2e.spec.ts`            | Handler results can diverge from exported request and byte metrics.                            | **Covered:** hit, miss, store, blocked write, and uploaded bytes.                                                                                                                                                                                             |
| `e2e/token.e2e.spec.ts`              | Secret disclosure or broken add/list/delete transitions.                                       | **Covered:** complete lifecycle, repeat-delete 404, and value-free lists.                                                                                                                                                                                     |
| `e2e/upload-limits.e2e.spec.ts`      | Bun's body cap can override configuration or oversized declarations can allocate.              | **Covered:** a 140 MiB accepted upload and header-only 413; another large allocation would add no distinct boundary.                                                                                                                                          |
| `e2e/startup-validation.e2e.spec.ts` | Invalid settings can start a server or leave a test hanging.                                   | **Covered:** token/backend/bucket/eviction failures, fractional and unsafe-integer partitions, timer overflow and exact ceiling, and derived TTL overflow through a bounded, cleanup-safe helper.                                                             |
| `e2e/tls.e2e.spec.ts`                | TLS material can load but fail at the listener.                                                | **Covered:** generated certificate and real HTTPS request.                                                                                                                                                                                                    |
| `e2e/graceful-shutdown.e2e.spec.ts`  | Shutdown can drop active uploads, accept new work, or wait forever.                            | **Covered:** idle exit, in-flight completion, refusal of new work, and forced timeout; repeated signals need intrusive isolation but protect no additional storage invariant.                                                                                 |
| `e2e/eviction.e2e.spec.ts`           | Timer-driven LRU can evict the wrong entry or report false metrics.                            | **Covered:** live route, recency, timed sweep, retained/evicted objects, counters, and gauge.                                                                                                                                                                 |
| `e2e/concurrency.e2e.spec.ts`        | Same-hash writes can interleave and disconnects can commit truncation.                         | **Covered:** two interleaved writers, a 32-client burst with one 200/31 conflicts and exact winner bytes, partial disconnect, and 20 clean repetitions.                                                                                                       |
| `e2e/s3-minio.e2e.spec.ts`           | Real S3 readiness, streaming, abort, append-only conflict, and races can differ from mocks.    | **Covered:** every one of the seven cases passed 20 times with zero skips against the pinned MinIO image; the failed-upload race rejects timeout drift and preserves exact winner bytes. Ordinary skips are endpoint gating, not missing evidence.            |
| `e2e/request-boundaries.e2e.spec.ts` | Bun's parser and direct request readers can differ from unit-created streams.                  | **Covered:** malformed authorization, encoded traversal, conflicting lengths, and a complete raw PUT followed by an exact GET; the suite owns a dedicated port and ordered helper/test timeouts.                                                              |

## Repetition, cleanup, and remaining uncertainty

Repetition was deliberately process-isolated rather than delegated to Bun's
in-process rerun flag for the local integration set. Each iteration therefore
rebuilt server and storage state, exercised the same externally observable
concurrency contract, and underwent independent teardown verification. This
distinction matters because a passing loop that reuses contaminated process
state can conceal descriptor leaks, stale locks, cached credentials, or timing
dependencies that appear only during clean startup and termination.

Stress results were accepted only when status distribution, persisted byte
identity, bounded completion, and teardown invariants all held simultaneously.
That composite oracle prevents a superficially successful response from masking
truncated storage, a residual process, a leaked temporary directory, an
unobserved cancellation, or a backend consistency delay.

The local command
`bun test e2e/concurrency.e2e.spec.ts src/cache/eviction.spec.ts src/cache/storage-strategy/file-system.spec.ts`
ran exactly 20 times. Every iteration reported 18 pass, 66 `expect()` calls, no
failure, and no skip, for 360 passes and 1,320 assertions overall. The post-loop
audit found no `src/main.ts` process,
listener on port 4015, or matching `rc-e2e-*`, `rc-evict-*`, or `rc-fs-*`
directory.

The MinIO preflight found both the exact container name
`remotecache-adv-review-final-20260729` and TCP 9000 free. Docker started only
`minio/minio:RELEASE.2025-09-07T16-13-09Z`, returned container ID
`b7b89438df09724fefe718eb4464e745a28192865624cae3f438a7f1ef2fd3e3`, and
reported live health on poll 1. After the bundled `mc` created
`remotecache-e2e`, exactly 20 endpoint-enabled runs each reported 7 pass, 17
assertions, 0 fail, and 0 skip. Teardown removed only the captured ID; the exact
name was absent afterward, TCP 9000 was free, and no e2e server process or
matching recent temporary directory remained.

Two discarded local repetition wrappers failed before counting because of a
zsh reserved variable and an overly strict summary parser. Both were corrected,
and all required iterations restarted from zero under Bash. Failed harness
experiments also left one diagnostic server and six temporary artifacts; the
cleanup audit resolved their exact PID and paths, removed only those targets,
then confirmed no matching process, listener, container, or recent test
directory remained.

Live AWS and GCS remain outside the evidence because both require external
credentials, mutable cloud state, network availability, and potentially
billable operations; mocked provider/SDK contracts plus pinned MinIO give
deterministic coverage of the code-owned behavior without those dependencies.
Unbounded exhaustion, destructive host stress, and host-wide permission
mutation also remain excluded because they risk developer or CI state and add
no concrete contract beyond the bounded 32-client, payload, timeout, and 20-run
checks.

## Completion criteria

1. The focused, ordinary, coverage, format, lint, type, and diff gates pass with
   no suppressed failure.
2. The only ordinary skips are the nine explained MinIO gate entries; all seven
   real MinIO tests pass with zero skips in every endpoint-enabled run.
3. Every production defect above has a permanent focused regression, including
   the follow-up promise, timer, conversion, cancellation, and reader-lifetime
   corrections found during review.
4. Both race-sensitive groups complete all 20 iterations without status,
   integrity, count, cleanup, or timeout drift.
5. Coverage was used to inspect gaps, not optimize a percentage. Every material
   risk is covered above or has a concrete bounded-environment rationale.

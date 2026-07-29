# Adversarial test sweep design

## Purpose

This sweep will challenge the assumptions behind remotecache's runtime behavior, not chase a coverage percentage. It covers malformed requests, boundary values, interrupted streams, storage failures, corrupted state, startup validation, and bounded races. Each retained test must protect a distinct contract or failure mode.

The starting point is clean: 132 tests pass, eight MinIO tests are skipped without an endpoint, and format, lint, and typecheck pass. Bun reports 90.63% function coverage and 92.18% line coverage. Those percentages help locate gaps, but they are not completion targets.

## Scope

The review covers the runtime modules under `src/`, the end-to-end harness, and the existing test suite. It includes the filesystem and SQLite implementations, mocked GCS behavior, and S3 behavior against the pinned MinIO image used by CI.

The sweep will not contact AWS or Google Cloud, add test-only packages, apply unbounded load, or pressure resources outside the test processes and their temporary directories. Existing public behavior remains authoritative unless an adversarial test demonstrates that it is unsafe, internally inconsistent, or contrary to the documented API.

## Approach

The sweep is contract-first. For each runtime unit, the review will identify its inputs, observable outputs, state transitions, concurrency boundaries, and failure dependencies. Every material risk gets one of three dispositions:

- an existing test already protects it;
- a focused new test is needed; or
- the scenario is impractical in this bounded environment, with the reason recorded.

Coverage data will guide inspection after the contract map exists. It will not justify tests that merely execute a line. Random generation may help discover parser cases, but permanent tests will use the smallest deterministic reproducer.

## Attack matrix

### HTTP, authentication, and parsing

Tests will cover missing and malformed bearer credentials, meaningful whitespace and casing variants, duplicate headers where Bun exposes them, and authorization failures that must not touch storage. Cache hashes will be checked at their length limits and against Unicode, control characters, encoded separators, and traversal syntax.

Request-body tests will exercise malformed JSON, non-object JSON values, empty and unusual token IDs, and invalid permissions. Upload validation will cover missing, zero, signed, fractional, exponential, overflowed, mismatched, and duplicate `Content-Length` values. Unsupported routes and methods must return stable responses without changing state.

### Streams and storage

Upload tests will use null, short, long, and erroring sources. They will also fail the destination before consumption and partway through a write, then verify cancellation, cleanup, and the absence of readable partial artifacts. Successful responses must describe the bytes that were actually committed.

Filesystem tests will challenge atomic same-hash commits, disappearing files, orphaned temporary files, invalid cache paths, readiness failures, and eviction races. SQLite tests will cover duplicate values, migration collisions, transactional rollback, corrupt or incompatible schemas, and readiness behavior after state damage.

S3 and GCS tests will cover error translation, abnormal metadata, failed reads, response-body cleanup, credential refresh coalescing, provider failure and retry, and conditional-write conflicts. MinIO will verify the real S3 request path for append-only writes, aborts, integrity, readiness, and same-hash races. If production code that calls a third-party package changes, its API will be checked with `ctx7` and compared with current open-source usage on GitHub before implementation.

### Configuration and lifecycle

Startup tests will exercise finite, integer, range, and overflow boundaries for ports, upload limits, cache limits, TTLs, sweep intervals, and shutdown timeouts. They will also cover invalid storage values, partial credentials, inaccessible TLS material, startup failure cleanup, repeated termination signals, graceful drain, and forced shutdown.

Failure-path assertions will include status, response body, headers, logs where they are part of the operator contract, metrics, and state. A test is incomplete if it only checks the status while missing a consequential side effect.

### Bounded exhaustion and concurrency

New local stress cases may use at most 32 concurrent clients, an 8 MiB payload per request, 64 MiB of aggregate live payload, and a 10-second timeout per case. Race-sensitive cases will run 20 times during verification. Existing coverage for uploads above Bun's 128 MiB default remains in place; the sweep will not add another allocation of that size without a distinct reason.

Docker tests will use `minio/minio:RELEASE.2025-09-07T16-13-09Z`, the version pinned in CI. Each Docker test gets at most 60 seconds. The run will use a dedicated container and bucket, report setup failures directly, and remove the container when finished.

## Test quality and production fixes

A new test for already-correct behavior may pass on its first run when it closes a meaningful contract gap. Any production change must begin with a focused test that fails for the expected reason. The implementation will be the smallest change that makes that regression pass, followed by the relevant local suite.

Tests that protect the same contract with the same setup and failure signal will be merged. A test will be deleted only after its unique assertions are mapped to a retained test. Broad end-to-end coverage will not replace a focused unit test when the unit test provides a more precise failure.

Behavior or public API changes require matching JSDoc and canonical documentation in the same change. Unrelated refactors and speculative abstractions are out of scope.

## Completion criteria

The sweep is complete when:

1. Every runtime module has a recorded risk disposition and no meaningful gap is silently skipped.
2. Every discovered production bug has a permanent regression test that was observed failing before the fix.
3. The ordinary suite passes, with only the endpoint-gated MinIO skips reported and explained.
4. The Docker MinIO run executes its full file with zero skips, and race-sensitive tests pass for 20 repetitions.
5. Coverage is reviewed after the changes; each important uncovered path is tested or has a written reason not to test it.
6. `bun run format --check`, `bun run lint`, and `bun run typecheck` pass with no suppressed or unexplained failures.

The final report will distinguish production defects, test-suite improvements, removed redundancy, deliberately untested risks, and verification evidence.

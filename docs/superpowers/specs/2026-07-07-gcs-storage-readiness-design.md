# GCS Storage and Readiness - Design

> Approved 2026-07-07. Phase 3 follow-up to filesystem cache eviction in
> [`../plans/2026-07-05-remotecache-roadmap.md`](../plans/2026-07-05-remotecache-roadmap.md).

**Goal:** add Google Cloud Storage as the next cache backend and add a deep
`/ready` probe so operators can tell the difference between "the process is
alive" and "the configured backend is usable."

**Non-goals:** Azure Blob support, multi-replica support, generic object-store
abstractions beyond the existing `CacheStorageStrategy`, object-store eviction
inside the server, and any change to S3 environment variables or behavior.

## Decisions made during brainstorming

1. **Sequence:** implement GCS first and defer Azure. GCS proves one new cloud
   backend without taking on two SDKs, two auth models, and two integration
   surfaces in one change.
2. **Readiness:** add `/ready` in the same slice. A new storage backend should
   ship with a way to verify that the backend is reachable, not just that Bun
   accepted a socket.
3. **Append-only writes:** GCS writes must use a non-overwrite precondition.
   Google Cloud Storage supports generation preconditions for mutating requests;
   the implementation should use the "object does not yet exist" form
   (`ifGenerationMatch: 0`) for cache uploads.
4. **Azure follow-up:** Azure remains feasible because Azure Blob supports
   `If-None-Match: *` for writes that should fail when a blob exists. It gets a
   separate brainstorm/spec/plan cycle after GCS lands.
5. **Upload memory:** if the GCS SDK cannot stream with the non-overwrite
   precondition without buffering the full artifact, stop and revise this
   design. Large Nx artifacts are normal, so full buffering is not acceptable.

References checked during design:

- Google Cloud Storage request preconditions:
  <https://docs.cloud.google.com/storage/docs/request-preconditions>
- Azure Blob Storage conditional headers:
  <https://learn.microsoft.com/en-us/rest/api/storageservices/specifying-conditional-headers-for-blob-service-operations>

## HTTP behavior

`GET /health` stays shallow and unauthenticated. It returns `200 OK` when the
process is accepting HTTP requests.

`GET /ready` is new, also unauthenticated. It returns:

- `200 OK` when the token store is reachable and the configured cache backend
  passes its readiness check.
- `503 Service Unavailable` with a static body such as `Not Ready` when either
  check fails. Details go to logs, not the response body.

The route belongs in `src/main.ts` with the existing thin-handler pattern:
assemble dependencies in the route, delegate to a pure function, and build all
responses from `src/responses.ts`.

## Storage interface

Extend `CacheStorageStrategy` with one method:

```ts
checkReady(): Promise<void>;
```

Expected behavior:

- `FileSystemStrategy.checkReady()` verifies that `CACHE_DIR` can be created,
  written, and committed with the same hard-link probe used at startup.
- `S3Strategy.checkReady()` verifies bucket access with a cheap metadata or
  existence probe.
- `GcsStrategy.checkReady()` verifies bucket access with a cheap bucket or
  metadata probe.

The method throws on failure. The `/ready` handler catches, logs, and returns
`503`.

## GCS configuration

Add `STORAGE_STRATEGY=gcs`.

Minimum runtime config:

| Env var            | Required | Meaning                                     |
| ------------------ | -------- | ------------------------------------------- |
| `GCS_BUCKET`       | yes      | Bucket used for cache objects               |
| `GCS_PROJECT_ID`   | no       | Project id, when the SDK cannot infer it    |
| `GCS_KEY_FILENAME` | no       | Service account JSON file path              |
| `GCS_CREDENTIALS`  | no       | Service account JSON supplied from a secret |

Credential model:

- Prefer ambient Google credentials on GKE or other Google Cloud runtimes.
- Allow exactly one explicit credential source: `GCS_KEY_FILENAME` or
  `GCS_CREDENTIALS`. In Kubernetes, `GCS_CREDENTIALS` should come from a
  Secret, not a literal value in `values.yaml`.
- Fail at startup when `STORAGE_STRATEGY=gcs` has no bucket or conflicting
  explicit credential settings.

Before implementation, verify the current GCS SDK API with `ctx7` and compare
against production OSS usage on GitHub, per repository rules. If `ctx7` is not
available in the worker environment, record that and use current official
Google docs plus real OSS code as the fallback.

## GCS strategy behavior

Add `src/cache/storage-strategy/gcs.ts` implementing the existing cache storage
contract.

- `exists(hash)` checks whether the object exists.
- `getStream(hash)` streams object contents without loading the whole artifact
  into memory.
- `getSize(hash)` reads object metadata and returns the object size in bytes.
- `writeStream(hash, stream, contentLength)` uploads the stream with
  `ifGenerationMatch: 0`.
- A GCS precondition failure maps to `CacheEntryExistsError`, so `writeCache`
  returns the existing `409 Cannot override an existing record` response.
- Other backend errors log server-side and map to `500 Failed to write to cache`.

Do not add server-side eviction for GCS. Operators should use GCS lifecycle
rules, matching the S3 lifecycle guidance.

## Helm chart

Add chart support without changing the single-replica rule.

- Allow `storage.strategy: gcs`.
- Add a `gcs:` values block for bucket, project id, key filename, an existing
  Secret reference for JSON credentials, and Workload Identity annotations.
- Validate that `storage.strategy=gcs` has `gcs.bucket`.
- Validate mutually exclusive explicit credential sources.
- Keep liveness probes on `/health`.
- Move readiness probes to `/ready` after the endpoint exists.

GCS does not remove the SQLite token DB constraint, so `replicaCount > 1`
continues to fail chart rendering.

## Docs

Update docs in the same commits as behavior changes:

- `nx-cache-server.openapi.json`: add `GET /ready` with `200` and `503`
  responses.
- `docs-site/src/content/docs/guides/configuration.md`: document
  `STORAGE_STRATEGY=gcs` and the GCS env vars.
- `docs-site/src/content/docs/guides/storage-strategies.md`: add a GCS section
  covering credentials, append-only writes, and lifecycle pruning.
- `docs-site/src/content/docs/deploy/kubernetes.md`: add GKE Workload Identity
  guidance and explain that readiness uses `/ready`.
- `charts/remotecache/values.yaml`: document the new GCS values.
- `README.md`: update feature bullets only after the feature ships.

## Testing

Unit tests:

- Config resolution accepts `gcs` with the required bucket.
- Config resolution rejects missing bucket and conflicting credential sources.
- `GcsStrategy.writeStream()` maps precondition failure to
  `CacheEntryExistsError`.
- `GcsStrategy` methods pass through stream, size, and existence behavior using
  a mocked client boundary.
- `/ready` returns `200` when token storage and storage readiness pass.
- `/ready` returns `503` with a static body when either dependency fails.

E2E tests:

- Filesystem `/ready` path using the spawned-server harness.
- Startup validation for bad GCS config.

Integration tests:

- Add opt-in live GCS tests only if CI can run them safely with a temporary
  bucket and short-lived credentials.
- Otherwise, leave a documented local command and make the unit boundary strict
  enough to protect append-only behavior.

Required gates before completion:

```sh
bun test
bun run typecheck
bun run lint
bun run format --check
cd docs-site && bun run build
```

## Rollout and roadmap

Ship this as a non-breaking minor feature.

After implementation lands:

- Mark GCS shipped in the Phase 3 roadmap.
- Leave Azure Blob storage as the remaining storage-strategy item.
- Keep the optional `/ready` probe marked shipped.

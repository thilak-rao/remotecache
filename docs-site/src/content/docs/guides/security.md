---
title: Security model
description: Security design and token hashing.
---

## Token storage

Token values are hashed with SHA-256 before they hit the database (`src/token/hash-token.ts`). The store looks up tokens by hash and returns only `id` and `permission`; the original value is never recoverable. A lost token must be replaced.

## Constant-time comparison

`ADMIN_TOKEN` is compared against incoming request tokens with a constant-time equality check (`src/safe-equal.ts`) to prevent timing attacks.

## Input validation

Cache hash parameters are validated before any storage access (`src/cache/is-valid-hash.ts`), rejecting path traversal sequences and anything that doesn't match the expected hash format with `400`.

`PUT /v1/cache/:hash` requires a valid `Content-Length` header (a non-negative integer). Requests without one, or with a non-integer value, return `400`.

## Append-only writes

Once written, cache entries don't change. A `PUT` targeting an existing hash returns `409` without touching storage.

## Upload size cap

`PUT /v1/cache/:hash` enforces `MAX_UPLOAD_BYTES` (default 500 MiB). Anything over the limit returns `413` before the body reaches storage.

## Database migration

`TokenStorage` (`src/token/token-storage.ts`) detects and migrates pre-hash plaintext token databases on open, using `PRAGMA user_version` as the schema version gate. Existing deployments need no manual migration step.

## HTTP status reference

### `GET /v1/cache/:hash`

| Status | Meaning                                                    |
| ------ | ---------------------------------------------------------- |
| `200`  | Entry found; body is `application/octet-stream`            |
| `400`  | Hash is invalid (rejects path traversal / malformed input) |
| `403`  | Token lacks read permission                                |
| `404`  | Entry not found                                            |

### `PUT /v1/cache/:hash`

| Status | Meaning                                                 |
| ------ | ------------------------------------------------------- |
| `200`  | Entry written                                           |
| `400`  | `Content-Length` missing or invalid, or hash is invalid |
| `403`  | Token lacks write permission                            |
| `409`  | Entry already exists                                    |
| `413`  | Upload exceeds `MAX_UPLOAD_BYTES`                       |

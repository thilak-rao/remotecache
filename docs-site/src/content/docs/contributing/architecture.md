---
title: Architecture
description: 'How the Bun-based Nx remote cache server is built: thin handlers, pure functions, pluggable storage, and hashed token storage.'
---

This page covers the internal structure of the Bun-based Nx remote cache server. For local setup and contribution workflow, see [CONTRIBUTING.md](https://github.com/thilak-rao/remotecache/blob/main/CONTRIBUTING.md).

## HTTP layer

The server starts via `Bun.serve` with a `routes` object defined in `src/main.ts`. Each route handler is thin: it assembles the dependencies it needs (token permission, storage reference, request body) and calls a pure function that does the actual work.

The five core functions:

| Function      | Purpose                              |
| ------------- | ------------------------------------ |
| `getCache`    | Stream a cache entry to the client   |
| `writeCache`  | Accept and persist an upload         |
| `addToken`    | Create a new access token            |
| `listTokens`  | Return all token IDs and permissions |
| `deleteToken` | Remove a token by id                 |

Each takes its dependencies as parameters and returns a `Response`. That's what makes them unit-testable in isolation; the handlers have no logic of their own.

## Response factories

Every HTTP response comes from a factory exported by `src/responses.ts`:

```
okResponse  badRequest  conflictError  accessForbidden
notFoundError  payloadTooLargeError  internalServerError  noContentResponse
```

Handlers never call `new Response` directly. Status codes, content types, and body formatting all live in one place.

## Cache storage

Storage sits behind the `CacheStorageStrategy` interface in `src/cache/storage-strategy/`. `createCacheStorage` reads `STORAGE_STRATEGY` from the environment and returns the right implementation. Filesystem (default) writes to `CACHE_DIR` on disk. S3 writes to an S3-compatible bucket using `S3_*` env vars.

To add a new backend: implement `CacheStorageStrategy` and register it in `createCacheStorage`.

Cache writes are append-only. A hash that already exists returns `409` and is never overwritten.

## Token storage

Tokens live in SQLite via `bun:sqlite`. Values are hashed (SHA-256) at rest; the store only ever returns `id` and `permission`. The original value is never recoverable from the database. On open, `TokenStorage` runs a migration gated by `PRAGMA user_version` to upgrade any pre-hash plaintext databases.

## Testing

Unit tests colocate with their source file as `*.spec.ts`. End-to-end tests live under `e2e/`. Run both with:

```sh
bun test
```

There is no separate test script; invoke `bun test` directly.

For context on the design trade-offs and what this server targets, see [Why self-host?](/why/).

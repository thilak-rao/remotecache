---
title: Security model
description: 'Token hashing, constant-time admin compare, path-traversal validation, append-only writes, and using readonly/full tokens to enforce CI trust boundaries.'
---

## Token storage

Token values are hashed with SHA-256 before they hit the database (`src/token/hash-token.ts`). The store looks up tokens by hash and returns only `id` and `permission`; the original value is never recoverable. A lost token must be replaced.

## Constant-time comparison

`ADMIN_TOKEN` is compared against incoming request tokens with a constant-time equality check (`src/safe-equal.ts`) to prevent timing attacks.

## Input validation

Cache hash parameters are validated before any storage access against `[A-Za-z0-9_-]`, 1–128 characters (`src/cache/is-valid-hash.ts`). All dots are rejected — not just `..` — meaning a hash can never collide with the filesystem strategy's `${hash}.tmp` write path or resolve to the cache directory or its parent. Anything outside that allowlist, or longer than 128 characters, returns `400`.

`PUT /v1/cache/:hash` requires a valid `Content-Length` header (a positive integer). Requests without one, or with a non-integer or non-positive value, return `400`.

## Append-only writes

Once written, cache entries don't change. A `PUT` targeting an existing hash returns `409` without touching storage.

## Trust boundaries: containing cache poisoning

CVE-2025-36852 (CREEP) is an architectural flaw in single-credential cache plugins: a PR workflow
hashes to the same key as a trusted main build, uploads a poisoned artifact first, and every
subsequent cache hit ships the payload. See the [full explainer](/security/cve-2025-36852/) for the
attack chain.

This server's `readonly`/`full` token split is the primitive for containing that class:

- Issue **`full`** tokens only to trusted pipelines — main branch, deploy jobs.
- Issue **`readonly`** tokens to untrusted contexts — fork PRs, open-source contributor CI.

`readonly` tokens are rejected at `PUT` with `403` (`src/cache/write-cache.ts`, line 41:
`tokenPermission === 'full'` is the only path that can write). Untrusted runners can read the cache
but cannot write to it, so they cannot place a poisoned artifact.

:::caution[Honest limits]
**Append-only is first-writer-wins.** If you hand a `full` token to an untrusted context — fork PR
jobs, external contributor workflows — that context can still poison the cache before any trusted
build runs. The `readonly`/`full` split only works if you actually scope tokens to trust level.

**This is not Nx Cloud's cryptographic artifact-integrity verification.** Nx Cloud cryptographically
binds artifacts to their source; this server gives you the lever (token scoping), but correct
use of that lever is on you.
:::

## Upload size cap

`PUT /v1/cache/:hash` enforces `MAX_UPLOAD_BYTES` (default 500 MiB). Anything over the limit returns `413` before the body reaches storage.

## Database migration

`TokenStorage` (`src/token/token-storage.ts`) detects and migrates pre-hash plaintext token databases on open, using `PRAGMA user_version` as the schema version gate. Existing deployments need no manual migration step.

## HTTP status reference

The [API Reference](/api/) lists the exact status codes, request, and response shapes for every endpoint, generated from the OpenAPI specification.

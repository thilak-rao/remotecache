# nx-cache-server-bun

Self-hosted Nx Remote Cache server on the Bun runtime. Implements the Nx self-hosted remote cache HTTP API (`GET`/`PUT /v1/cache/:hash`) plus a token admin API (`/v1/admin/tokens`). See @README.md for the full API surface, environment variables, and deployment.

## Runtime: Bun, not Node

This project runs on Bun and uses Bun's built-ins. Do not add Node-only equivalents or extra dependencies for anything Bun already provides.

- HTTP: `Bun.serve` with the `routes` object in `src/main.ts` — not Express or Node `http`.
- SQLite: `bun:sqlite` — not `better-sqlite3`.
- Tests: `bun:test` — not Jest or Vitest.
- Env: `Bun.env` — not `process.env`.
- Install: `bun install` — not npm, pnpm, or yarn.

## Commands

- `bun run serve` — start the server. Requires `ADMIN_TOKEN`; it exits on startup without one.
- `bun test` — run all colocated `*.spec.ts` and `e2e/*.e2e.spec.ts`. There is no test script; invoke `bun test` directly.
- `bun run lint` — oxlint.
- `bun run format` — oxfmt (rewrites files). The CI gate is `bun run format --check`, so format before committing.

## Code style

- Never call `console` directly; import `logger` from `src/logger.ts`. Lint fails otherwise (`no-console` is an error). `logger.info`/`logger.log` only print when `VERBOSE=1`; `logger.error` always prints.
- No `any` — `no-explicit-any` is an error.
- Single quotes (oxfmt).

## Architecture

- Handlers in `src/main.ts` stay thin: they assemble dependencies and delegate to pure functions (`getCache`, `writeCache`, `addToken`, …) that take those dependencies as parameters and return a `Response`. That shape is what makes them unit-testable — keep new handlers the same way.
- Build every HTTP response from a factory in `src/responses.ts` (`okResponse`, `badRequest`, `conflictError`, …); don't construct `new Response` inside handlers.
- Cache storage is pluggable: implement `CacheStorageStrategy` (`src/cache/storage-strategy/`) and register it in `createCacheStorage`. Filesystem (default) and S3 already exist.
- Cache writes are append-only: an existing hash returns `409`, never an overwrite.
- Token values are hashed (SHA-256) at rest (`hashToken`); the store looks up by hash and only ever returns `id` + `permission`. `TokenStorage` migrates pre-hash plaintext databases on open, gated by `PRAGMA user_version`.

## Workflow

- Unit tests colocate beside their source as `*.spec.ts`; end-to-end tests live under `e2e/`.
- Commits follow Conventional Commits (`type(scope): subject`).
- CI runs format-check, lint, and test on every PR; all three must pass (`.github/workflows/ci.yml`). Pushing to `main` builds and pushes the GHCR image as `:latest` + `:sha-<short>`; pushing a `vX.Y.Z` tag publishes `:X.Y.Z` + `:X.Y` (`.github/workflows/publish-image.yml`).

# remotecache

Self-hosted Nx Remote Cache server on the Bun runtime. Implements the Nx self-hosted remote cache HTTP API (`GET`/`PUT /v1/cache/:hash`), `GET /metrics`, `GET /health`, and the token admin API (`/v1/admin/tokens`). See https://remotecache.dev/ for the full API surface, environment variables, and deployment; @README.md is the quickstart landing.

## Runtime: Bun, not Node

This project runs on Bun and uses Bun's built-ins. Do not add Node-only equivalents or extra dependencies for anything Bun already provides.

- HTTP: `Bun.serve` with the `routes` object in `src/main.ts` — not Express or Node `http`.
- SQLite: `bun:sqlite` — not `better-sqlite3`.
- Tests: `bun:test` — not Jest or Vitest.
- Env: `Bun.env` — not `process.env`.
- Install: `bun install` — not npm, pnpm, or yarn.
- Exception: `@aws-sdk/credential-providers` is the one approved runtime dependency, used for AWS provider chain / IRSA credential resolution; the Dockerfile runs `bun install --frozen-lockfile --production`.

## Commands

- `bun run serve` — start the server. Requires `ADMIN_TOKEN`; it exits on startup without one. Optional: `BIND_ADDRESS` (default `0.0.0.0:3000`), `TLS_CERT_PATH`/`TLS_KEY_PATH` for direct TLS, `S3_SESSION_TOKEN`; S3 access key/secret are optional when the AWS provider chain (IRSA, ECS, IMDS) resolves credentials. The server drains in-flight requests on `SIGTERM`/`SIGINT`.
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

## Docs stay in sync

Docs are part of the change, not a follow-up: any change to behavior, the HTTP API, env vars, or config must update the matching docs surface in the same commit — otherwise the change is incomplete.

- HTTP API (routes, status codes, request/response shapes) → `nx-cache-server.openapi.json`, the single source of truth. The `docs-site/` API Reference is generated from it; never hand-write API docs elsewhere.
- Env vars and configuration → the Configuration page in `docs-site/` (canonical); `README.md` only links to it.
- Behavior, storage, security, or architecture → the matching guide in `docs-site/`.

## Workflow

- Unit tests colocate beside their source as `*.spec.ts`; end-to-end tests live under `e2e/`.
- Commits follow Conventional Commits (`type(scope): subject`).
- CI runs format-check, lint, audits, tests, docs build, Docker smoke, Helm lint/template, and Trivy filesystem scan on every PR (`.github/workflows/ci.yml`). The Helm chart lives in `charts/remotecache/`. Pushing to `main` runs the Docker publish workflow after its preflight gate and publishes GHCR image tags `:edge` + `:sha-<short>`.
  Pushing a `vX.Y.Z` tag publishes `:latest`, `:X.Y.Z`, and `:X.Y` for `linux/amd64` and `linux/arm64` (`.github/workflows/publish-image.yml`).

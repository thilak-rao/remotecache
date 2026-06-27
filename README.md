# nx-cache-server-bun

A small, self-hosted **Nx Remote Cache** server built on **Bun**.

It implements the Nx “self-hosted remote cache” HTTP API and adds a tiny admin API to manage access tokens.

## Features

- Nx remote cache endpoints
  - `GET /v1/cache/:hash` (download)
  - `PUT /v1/cache/:hash` (upload)
- Token-based auth
  - **readonly** tokens can download
  - **full** tokens can download + upload
  - an **admin token** can manage tokens and also has **full** access
- Storage strategies
  - local filesystem (default)
  - S3-compatible storage (AWS S3, MinIO, etc.)
- SQLite-backed token store

## Quickstart

### 1) Start the server

```sh
bun install
ADMIN_TOKEN="change-me" bun run serve
```

The server starts on `http://localhost:3000` by default.

### 2) Create a token (admin API)

Create a **full** token (can read/write cache):

```sh
curl -sS -X POST \
  -H "Authorization: Bearer change-me" \
  -H "Content-Type: application/json" \
  "http://localhost:3000/v1/admin/tokens" \
  -d '{"id":"CI","permission":"full"}'
```

The response body contains the generated token value.

List tokens (values are **masked**):

```sh
curl -sS \
  -H "Authorization: Bearer change-me" \
  "http://localhost:3000/v1/admin/tokens"
```

Delete a token:

```sh
curl -sS -X DELETE \
  -H "Authorization: Bearer change-me" \
  "http://localhost:3000/v1/admin/tokens/<token-value>"
```

## Configure Nx

In your Nx workspace, set the following environment variables for the process that runs Nx (local dev, CI job, etc.):

- `NX_SELF_HOSTED_REMOTE_CACHE_SERVER` – base URL of this server
  - example: `https://cache.example.com`
- `NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN` – a token value with `readonly` or `full` permission

Example:

```sh
export NX_SELF_HOSTED_REMOTE_CACHE_SERVER="http://localhost:3000"
export NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN="<token-from-admin-api>"
```

Then run Nx normally (e.g. `nx build`, `nx test`, etc.).

## Environment variables

### Required

- `ADMIN_TOKEN`
  - Secret token used to authenticate to the admin API.
  - Anyone with this token can manage tokens and has full cache access.

### Optional

- `PORT` (default: `3000`)

- `TOKENS_DB_PATH` (default: `./data/nx-cache-server-tokens.sqlite`)
  - Filesystem path to the SQLite database that stores cache access tokens.
  - Tip: in production, mount/persist the `./data` directory (or set this to a persistent volume path).

- `MAX_UPLOAD_BYTES` (default: `524288000` / 500 MiB)
  - Safety limit for `PUT /v1/cache/:hash` uploads.

### Storage (filesystem – default)

If `STORAGE_STRATEGY` is not set (or is anything other than `s3`), the server stores cache entries on disk.

- `CACHE_DIR` (default: `./cache`)

### Storage (S3)

Set `STORAGE_STRATEGY=s3` to use S3-compatible object storage.

Required:

- `S3_REGION`
- `S3_BUCKET`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`

Optional:

- `S3_ENDPOINT`
  - Useful for MinIO / other S3-compatible providers.

Example:

```sh
export STORAGE_STRATEGY=s3
export S3_REGION=us-east-1
export S3_BUCKET=nx-cache
export S3_ACCESS_KEY_ID=...
export S3_SECRET_ACCESS_KEY=...
# Optional (MinIO, etc.)
export S3_ENDPOINT="http://localhost:9000"
```

## API

### Cache endpoints (used by Nx)

- `GET /v1/cache/:hash`
  - Auth: `Authorization: Bearer <token>` (`readonly` or `full`)
  - Responses:
    - `200` with `application/octet-stream`
    - `404` when the entry is missing
    - `403` when the token can’t read

- `PUT /v1/cache/:hash`
  - Auth: `Authorization: Bearer <token>` (**full** only)
  - Requires a valid `Content-Length` header (a non-negative integer)
  - Responses:
    - `200` on success
    - `409` if the entry already exists (no overwrites)
    - `400` if `Content-Length` is missing/invalid or the hash is invalid
    - `403` when the token can’t write
    - `413` when the upload exceeds `MAX_UPLOAD_BYTES`

### Admin endpoints

All admin endpoints require:

- `Authorization: Bearer <ADMIN_TOKEN>`

Endpoints:

- `GET /v1/admin/tokens` – list tokens (masked)
- `POST /v1/admin/tokens` – create a token
  - body: `{ "id": string, "permission": "readonly" | "full" }`
- `DELETE /v1/admin/tokens/:token` – delete by token value

## Development

Run tests:

```sh
bun test
```

Format / lint:

```sh
bun run format
bun run lint
```

---
title: Quickstart
description: Get the server running and wired into Nx.
---

Start the server, create an access token, point Nx at it. Five minutes, give or take.

## 1. Start the server

Install dependencies and start the server with an admin token:

```sh
bun install
ADMIN_TOKEN="change-me" bun run serve
```

Starts on `http://localhost:3000` by default. The [Configuration](/nx-cache-server-bun/guides/configuration/) page covers all the environment variables — port, storage, upload limits, and more.

## 2. Create an access token

Nx needs a token with `readonly` or `full` permission to talk to the cache. Create a `full` token (read + write):

```sh
curl -sS -X POST \
  -H "Authorization: Bearer change-me" \
  -H "Content-Type: application/json" \
  "http://localhost:3000/v1/admin/tokens" \
  -d '{"id":"CI","permission":"full"}'
```

The response body has the token value — this is the only time it appears. The server stores a SHA-256 hash, so it can't be recovered after this. Copy it now.

## 3. Point Nx at the server

Set these environment variables on the process that runs Nx (local shell, CI job, etc.):

```sh
export NX_SELF_HOSTED_REMOTE_CACHE_SERVER="http://localhost:3000"
export NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN="<token-from-admin-api>"
```

Run Nx as usual (`nx build`, `nx test`, etc.) and it will use the cache.

## Next steps

- [API Reference](/nx-cache-server-bun/api/) — full HTTP API details, status codes, and request/response shapes.
- [Configuration](/nx-cache-server-bun/guides/configuration/) — all environment variables, S3 storage setup, and production tips.

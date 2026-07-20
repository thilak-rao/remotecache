---
title: Quickstart
description: 'Get a self-hosted Nx remote cache running and wired into Nx in five minutes: start the server, create a token, point Nx at it.'
head:
  - tag: title
    content: 'Set Up a Self-Hosted Nx Remote Cache in 5 Minutes | remotecache'
---

Get a self-hosted Nx remote cache running in under five minutes — start the server, create an access token, point Nx at it.

## 1. Start the server

Install dependencies and start the server with an admin token:

```sh
bun install
export ADMIN_TOKEN="$(openssl rand -hex 32)"
bun run serve
```

Starts on `http://localhost:3000` by default. The [Configuration](/guides/configuration/) page covers all the environment variables — port, storage, upload limits, and more.

Verify it is up with the unauthenticated health check:

```sh
curl -fsS http://localhost:3000/health
```

## 2. Create an access token

Nx needs a token with `readonly` or `full` permission to talk to the cache. Create a `full` token (read + write):

```sh
curl -sS -X POST \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
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

- [Deploy](/deploy/docker/) — run it as a container, on Kubernetes, or as a standalone binary, with health checks and TLS.
- [CI recipes](/guides/ci-recipes/) — GitHub Actions and GitLab CI with `readonly` tokens for untrusted jobs.
- [Why self-host?](/why/) — the case for running your own Nx remote cache instead of Nx Cloud.
- [API Reference](/api/) — full HTTP API details, status codes, and request/response shapes.
- [Configuration](/guides/configuration/) — all environment variables, object storage setup, and production tips.

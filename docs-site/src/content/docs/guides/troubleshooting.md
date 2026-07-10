---
title: 'Troubleshooting'
description: 'Fixes for the errors the Nx remote cache server actually returns: 403 Access forbidden, 409 Cannot override an existing record, 503 Not Ready, and more.'
head:
  - tag: title
    content: 'Troubleshooting the Self-Hosted Nx Remote Cache | remotecache'
  - tag: script
    attrs: { type: application/ld+json }
    content: |
      {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[
        {"@type":"Question","name":"Why does the Nx remote cache return 403 Access forbidden?","acceptedAnswer":{"@type":"Answer","text":"The bearer token is missing, wrong, or lacks permission. A readonly token on an upload returns 403 by design: readonly tokens cannot write. Uploads need a token with full permission."}},
        {"@type":"Question","name":"Why does PUT return 409 Cannot override an existing record?","acceptedAnswer":{"@type":"Answer","text":"The cache is append-only. An entry for that hash already exists and is never overwritten. This is working as intended; treat it as success on retries."}},
        {"@type":"Question","name":"Why does /ready return 503 Not Ready?","acceptedAnswer":{"@type":"Answer","text":"The readiness probe checks the SQLite token database and the configured storage backend. One of them is unreachable; the specific dependency failure is written to the server logs."}},
        {"@type":"Question","name":"Why does the server exit immediately on startup?","acceptedAnswer":{"@type":"Answer","text":"ADMIN_TOKEN is missing or shorter than 16 characters, or the storage configuration is invalid, such as setting only one of the two TLS paths or enabling cache eviction with object storage. The startup error is printed to stderr."}},
        {"@type":"Question","name":"Why is Nx not using the remote cache at all?","acceptedAnswer":{"@type":"Answer","text":"NX_SELF_HOSTED_REMOTE_CACHE_SERVER and NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN must be set on the process that runs Nx. In CI, check they are exported in the job that invokes nx, not just defined elsewhere."}},
        {"@type":"Question","name":"Why is cache eviction not running?","acceptedAnswer":{"@type":"Answer","text":"Eviction is opt-in and filesystem-only. Set CACHE_MAX_BYTES or CACHE_TTL_HOURS to enable it. Setting either with S3 or GCS storage is a startup error; use bucket lifecycle rules instead."}}
      ]}
---

Every error below quotes the exact response body the server sends, so you can search for the message you saw.

## 403 `Access forbidden`

The bearer token is missing, wrong, or lacks permission for the operation.

- On `GET /v1/cache/:hash`: the token isn't valid at all. Check the `Authorization: Bearer <token>` header value against a token created via the [admin API](/guides/tokens/).
- On `PUT /v1/cache/:hash`: a valid `readonly` token is being rejected from writing. That is the write-trust boundary doing its job; uploads need `full` permission. If this shows up in CI, your trusted pipeline is holding the wrong token — see [CI recipes](/guides/ci-recipes/).
- On `/v1/admin/tokens`: only the `ADMIN_TOKEN` value works, not cache tokens.

The `nx_cache_requests_total{method="PUT",result="forbidden"}` metric counts readonly write rejections, so you can tell one misconfigured job from a probe or attack pattern.

## 409 `Cannot override an existing record`

The cache is append-only: an entry for that hash already exists and will not be overwritten. This is working as intended, not a failure — two builds raced to upload the same artifact and the first writer won. Nx treats the artifact as cached either way.

## 400 `Invalid hash`

The `:hash` path parameter failed validation. Hashes must match `[A-Za-z0-9_-]`, 1–128 characters; anything else (including dots) is rejected before touching storage. If you see this from Nx itself rather than a hand-written client, check that a proxy isn't rewriting the URL.

## 400 `Invalid Content-Length header`

`PUT /v1/cache/:hash` requires a `Content-Length` header with a positive integer. Chunked uploads without a length are rejected. If a proxy sits in front of the server, confirm it forwards the header instead of switching to chunked transfer encoding.

## 404 `The record was not found`

A cache miss. Normal on first builds and after eviction. If your hit rate is unexpectedly low, compare hashes between environments — different Node versions, environment variables in named inputs, or OS differences produce different task hashes.

## 413 `Upload exceeds the maximum allowed size of N bytes`

The artifact is larger than `MAX_UPLOAD_BYTES` (default 500 MiB). Raise the cap in the server's environment if the artifact is legitimate; see [Configuration](/guides/configuration/).

## 503 `Not Ready` from `/ready`

The readiness probe checks SQLite token storage and the configured cache backend, and one of them failed. The response body is static; the actual dependency error is in the server logs. Common causes: the `./data` volume isn't writable, the S3/GCS bucket or credentials are wrong, or the bucket isn't reachable from the container's network.

## The server exits immediately on startup

The server fails fast on invalid configuration and prints the reason to stderr:

- `ADMIN_TOKEN` missing or shorter than 16 characters.
- Only one of `TLS_CERT_PATH`/`TLS_KEY_PATH` set, or a file missing.
- `CACHE_MAX_BYTES`/`CACHE_TTL_HOURS` set together with `STORAGE_STRATEGY=s3` or `gcs` (eviction is filesystem-only).
- An unknown `STORAGE_STRATEGY` value.

## Permission errors on Docker volumes

The container runs the server as the non-root `bun` user, and the entrypoint prepares mounted data directories on start. If you still hit `EACCES` on `/app/data` or `/app/cache`, the host directories were likely created by another UID with restrictive permissions — make them writable for the container user (for example `chmod 777` for a quick test, or `chown` to the container's UID for a proper fix).

## Eviction is not running

Eviction is opt-in and filesystem-only. Nothing is evicted until you set `CACHE_MAX_BYTES` (LRU size cap) or `CACHE_TTL_HOURS` (last-access TTL). The sweep runs every `CACHE_SWEEP_INTERVAL_MS` (default 60 s) and only when a cap or TTL is set. On S3/GCS, use bucket lifecycle rules instead; see [Storage strategies](/guides/storage-strategies/).

## Nx isn't using the remote cache

`NX_SELF_HOSTED_REMOTE_CACHE_SERVER` and `NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN` must be set on the process that runs `nx`. In CI that means the job step that invokes Nx, not a different job or a shell that already exited. Verify from the same shell:

```sh
curl -fsS -H "Authorization: Bearer ${NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN}" \
  "${NX_SELF_HOSTED_REMOTE_CACHE_SERVER}/v1/cache/does-not-exist"
```

A `404` means auth works and the server is reachable (it's just a miss). A `403` means the token is wrong; a connection error means the URL is wrong or the network path is blocked.

---
name: remotecache
description: Use when configuring, deploying, securing, or integrating remotecache, a self-hosted Nx remote cache server. Covers the Nx cache API contract, bearer-token permissions, filesystem and S3 storage, Docker, Kubernetes, and security boundaries for trusted and untrusted CI.
---

# remotecache

Use this skill when an agent needs to understand, configure, deploy, or integrate remotecache.

## What remotecache is

remotecache is a self-hosted Nx remote cache server. It implements the Nx custom remote cache HTTP API and can store cache artifacts on local filesystem storage or S3-compatible object storage.

Primary docs:

- Quickstart: https://remotecache.dev/getting-started/quickstart/
- API reference: https://remotecache.dev/api/
- OpenAPI document: https://remotecache.dev/openapi.json
- Configuration: https://remotecache.dev/guides/configuration/
- Storage strategies: https://remotecache.dev/guides/storage-strategies/
- Token and admin API: https://remotecache.dev/guides/tokens/
- Security model: https://remotecache.dev/guides/security/

## Auth model

remotecache does not provide OAuth/OIDC discovery or dynamic agent registration. Operators provision credentials.

Cache clients use bearer tokens with one of two permissions:

- `readonly`: can download cache artifacts but cannot upload.
- `full`: can download and upload cache artifacts.

Admin endpoints use the operator-provided `ADMIN_TOKEN`. Do not place a `full` token in untrusted pull request jobs. Use `readonly` for untrusted CI and reserve `full` for trusted build contexts.

## API contract

The core endpoints are:

- `GET /v1/cache/:hash`: download a cache artifact.
- `PUT /v1/cache/:hash`: upload a cache artifact with a valid `Content-Length`.
- `GET /health`: lightweight health check.
- `GET /metrics`: Prometheus metrics.
- `/v1/admin/tokens`: token administration.

Use the OpenAPI document for exact status codes and request/response shapes: https://remotecache.dev/openapi.json

## Safety notes

- Cache writes are append-only; existing hashes return `409` and are never overwritten.
- Token values are SHA-256 hashed at rest.
- The server gives operators a token boundary for cache writes. It is not Nx Cloud's cryptographic artifact verification.
- Treat `/metrics` as private operational data even though the endpoint is unauthenticated.

---
title: 'Migrate off the deprecated @nx/s3-cache plugin'
description: '@nx/s3-cache and the other @nx/* self-hosted cache plugins are deprecated. Move to a free, self-hosted Nx remote cache server in a handful of env vars.'
head:
  - tag: title
    content: 'Migrate off the deprecated @nx/s3-cache plugin | remotecache'
  - tag: script
    attrs: { type: application/ld+json }
    content: |
      {"@context":"https://schema.org","@type":"TechArticle","headline":"Migrate off the deprecated @nx/s3-cache plugin","description":"Move from the deprecated @nx/* self-hosted cache plugins to a free, self-hosted Nx remote cache server.","url":"https://remotecache.dev/guides/migrate-from-nx-s3-cache/","author":{"@type":"Person","name":"Thilak Rao"},"mainEntityOfPage":"https://remotecache.dev/guides/migrate-from-nx-s3-cache/"}
---

On May 21, 2026, Nx officially deprecated the four `@nx/*` self-hosted cache plugins. The packages remain on npm so existing CI pipelines don't break on the next `npm install`, but they receive no further updates or security patches and may be removed from npm in a future Nx release.

This guide covers what changed, what timeline you're on based on your Nx version, and how to swap in this server — reusing your existing S3 bucket if you have one.

## What's deprecated and why

Nx deprecated all four official self-hosted cache plugins:

- `@nx/s3-cache`
- `@nx/gcs-cache`
- `@nx/azure-cache`
- `@nx/shared-fs-cache`

The stated reason is **CVE-2025-36852 (CREEP)**, a cache-poisoning flaw that is architectural rather than a patchable code bug. The full attack chain is documented at [/security/cve-2025-36852/](/security/cve-2025-36852/), but the short version: these plugins share a single credential that can both read and write the entire cache, and the CI workflow that produces an artifact is not part of the cache key. A contributor PR with no source changes but a malicious build step can hash to the same key as a trusted `main` build and upload a poisoned artifact first — every subsequent cache hit ships that payload.

Nx's position (from the May 21 announcement by Jeff Cross) is that the flaw cannot be patched at the plugin level; deprecation is their answer. Nx Cloud's recommended path separates cache credentials from CI trust boundaries at the platform level. The `@nx/*` plugins never could.

The packages still live on npm. If your Nx version and CI pipeline work today, they will continue to work tomorrow. But you are running unmaintained software against a published CVE.

## What keeps working vs. what won't

Your current setup is blocked primarily by **Nx version**, not the deprecation notice itself.

**Nx v20** — `tasksRunnerOptions` in `nx.json` is deprecated but the legacy cache engine still runs when you set `"useLegacyCache": true` in `nx.json`. The `@nx/s3-cache` plugin works through this path. You have a window to migrate before upgrading.

**Nx v21+** — the legacy cache engine is gone. `tasksRunnerOptions` and `useLegacyCache` do nothing. Nx now uses a remote-cache plugin interface with a custom HTTP endpoint, which is exactly where this server plugs in. If you have already upgraded to v21 or later, you cannot use `@nx/s3-cache` at all regardless of whether it is installed.

To check your version: `npx nx --version` or `cat node_modules/nx/package.json | grep '"version"'`.

## The swap: point Nx at this server

Replace the `@nx/s3-cache` wiring with two environment variables. That is the entire Nx-side change.

```sh
export NX_SELF_HOSTED_REMOTE_CACHE_SERVER="https://your-cache-server.example.com"
export NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN="<token-from-admin-api>"
```

Nx v21+ reads `NX_SELF_HOSTED_REMOTE_CACHE_SERVER` automatically and routes all cache reads and writes through that endpoint. No `nx.json` plugin config, no custom runner registration.

You will need an access token. Create one using the admin API after starting the server — the [Quickstart](/getting-started/quickstart/) walks through this in full. Issue a `full` token for trusted pipelines (main branch, deploy jobs) and `readonly` tokens for untrusted contexts (fork PRs, external contributor CI).

For the full list of environment variables the server itself accepts, see [Configuration](/guides/configuration/).

## Reusing your S3 bucket

If you were using `@nx/s3-cache`, you already have a bucket with the right region and credentials. You can point this server at the same bucket — no new infrastructure needed.

Set `STORAGE_STRATEGY=s3` and `S3_BUCKET` on the server process. Reuse your existing IAM keys if you have them, or omit the keys on EKS, ECS, or EC2 and let the server use the IRSA / instance role:

```sh
export STORAGE_STRATEGY=s3
export S3_REGION=us-east-1          # same region as your existing bucket (or AWS_REGION)
export S3_BUCKET=your-nx-cache      # existing bucket name, or a fresh one
# export S3_ACCESS_KEY_ID=...       # omit on EKS IRSA / ECS / EC2 instance role
# export S3_SECRET_ACCESS_KEY=...
# export S3_ENDPOINT="..."          # only for MinIO or other S3-compatible providers
```

This server stores each artifact under a key equal to the Nx task hash (`PUT`/`GET /v1/cache/:hash`) and only reads keys it wrote itself — it does not read or migrate artifacts produced by `@nx/s3-cache`. To keep things unambiguous, point this server at a fresh or dedicated bucket. Either way, the first builds after the swap run cold and repopulate the cache in this server's format.

For MinIO, R2, or other S3-compatible providers that need a custom endpoint, set `S3_ENDPOINT`. See [Storage strategies](/guides/storage-strategies/) for the complete storage documentation.

## Lock down trust boundaries while you're here

The CVE that triggered this deprecation is a trust-boundary problem. Swapping the server without revisiting token scoping reproduces the same class of risk under different software.

The [Security model](/guides/security/) covers how to scope `readonly` and `full` tokens to CI trust levels so untrusted PR workflows can hit the cache but cannot write to it. Read it before issuing tokens to CI.

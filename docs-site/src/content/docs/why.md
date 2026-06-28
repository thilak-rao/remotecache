---
title: "Why remotecache exists"
description: "Nx self-hosted caching went free to paid to free to deprecated. Here's why I run a free, MIT-licensed Nx remote cache I actually own — and what this fork adds."
head:
  - tag: title
    content: "Why remotecache exists: the Nx cache deprecation story"
  - tag: script
    attrs: { type: application/ld+json }
    content: |
      {"@context":"https://schema.org","@type":"TechArticle","headline":"Why remotecache exists: the Nx self-hosted cache deprecation story","description":"Nx self-hosted caching went free to paid to free to deprecated. A free, MIT-licensed, self-hosted Nx remote cache built on jase88/nx-cache-server-bun.","url":"https://remotecache.dev/why/","author":{"@type":"Person","name":"Thilak Rao"},"mainEntityOfPage":"https://remotecache.dev/why/"}
---

## The short version

Nx's self-hosted cache went free, then paid ($250/seat/year for Powerpack), then free again (Commercial-licensed plugins), then deprecated outright. This project is the option nobody's advertising: a free, MIT-licensed remote cache server you host and control.

## What happened to Nx caching

Remote caching in Nx has had a turbulent few years:

- **Before Nx v20:** Community plugins — `@nx-aws-plugin/nx-aws-cache`, `nx-remotecache-custom` and its Azure/MinIO variants — let teams self-host for free via the `tasksRunnerOptions` field in `nx.json`. It worked. Teams used it to avoid paying for Nx Cloud.
- **Nx v20 (September 2024):** `tasksRunnerOptions` was deprecated (Nx's stated reason: incompatibility with the Rust core rewrite). Nx introduced `@nx/powerpack` — an official self-hosted cache at **$250/seat/year** (or $26/seat/month). Community plugins were archived. Nx 21 removed the legacy cache engine entirely. The community reaction was blunt: [GitHub discussion #28332](https://github.com/nrwl/nx/discussions/28332), Reddit threads, "cautionary tale" blog posts.
- **Nx v20.8 (April 2025):** Nx reversed course and released four free official plugins — `@nx/s3-cache`, `@nx/gcs-cache`, `@nx/azure-cache`, `@nx/shared-fs-cache` — with refunds for Powerpack purchasers. The catch: these plugins shipped under a **Commercial license, not MIT**.
- **May 21, 2026:** Nx [deprecated all four plugins](https://nx.dev/docs/reference/deprecated/self-hosted-cache-packages), citing **[CVE-2025-36852](/security/cve-2025-36852/)** (CREEP), a cache-poisoning vulnerability inherent to the single-credential design. Jeff Cross wrote: *"We published a CVE (CREEP CVE-2025-36852) last year against these packages to make it clear that they shouldn't be used for serious projects because of the inherent design flaw."* The plugins remain on npm so existing builds don't break, but they receive no further updates or security fixes.

## The cost and the lock-in

At peak, self-hosted Nx caching required **Powerpack at $250/seat/year**. Even during the brief free window (v20.8 through May 2026), the official plugins were not open source — the Commercial license bars copying, modification, redistribution, or use to benchmark against Nx. Terms are at [cloud.nx.app/terms/self-hosted-cache/2025-03-05](https://cloud.nx.app/terms/self-hosted-cache/2025-03-05).

`remotecache` is **MIT**. Read it, fork it, modify it, self-host it.

## Standing on `jase88`'s shoulders

This project forks [jase88/nx-cache-server-bun](https://github.com/jase88/nx-cache-server-bun), a minimal, well-structured Bun/Hono cache server that implements Nx's remote cache HTTP contract. `jase88` did the hard part: figuring out the exact endpoints Nx expects, the binary artifact format, and a clean storage abstraction. This fork wouldn't exist without it.

What this fork adds on top of that foundation:

- Token hashing at rest, with a plaintext-token DB migration path
- Upload size cap (returns HTTP 413 on oversized artifacts)
- Constant-time admin credential comparison (timing-safe)
- Path-traversal and hash input hardening
- Non-root pinned container image
- GHCR image publishing
- Repository hardening (branch protection, dependabot, security policy)
- This documentation site

## Your options now

If you're running `@nx/s3-cache` or another deprecated plugin, you have four paths:

- **A — Accept the risk with mitigations:** Keep the deprecated plugin, add an environment variable to your `nx.json` named inputs so PR builds hash to different keys than `main`, restrict repo access to trusted contributors. You're on unmaintained software as Nx advances toward v22.
- **B — Migrate to Nx Cloud:** Nx's recommended path. Native zero-trust cache boundaries and artifact-integrity verification. Paid — [compare costs and tradeoffs](/compare/nx-cloud/).
- **C — Disable remote caching:** Local cache only. No risk; slower CI. The Medium piece by Emily Xiong frames this as turning a ~3-minute build into a ~30-minute one for large monorepos — their framing, not a measurement of ours.
- **D — Run a custom remote cache endpoint:** Nx's `remoteCache` config still accepts a custom server URL. This is where `remotecache` fits. Give CI pipelines a `readonly` token; only your trusted build system gets a `full` token. That split is the primitive for enforcing the write-trust boundary that [CVE-2025-36852](/security/cve-2025-36852/) exploits. See the [quickstart](/getting-started/quickstart/) to be running in minutes. Already running a deprecated `@nx/*-cache` plugin? The [migration guide](/guides/migrate-from-nx-s3-cache/) maps the old config onto this server.

## Get started

The [quickstart](/getting-started/quickstart/) walks through starting the server, creating tokens, and wiring Nx to use the cache. You own the storage, the logs, and the binary — no account required.

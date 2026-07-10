---
title: 'Self-hosted Nx remote cache vs Nx Cloud'
description: 'Nx Cloud vs a free, self-hosted Nx remote cache: cost, security, control, and data residency — and an honest take on when each one is the right call.'
head:
  - tag: title
    content: 'Nx Cloud Alternative? Self-Hosted Nx Remote Cache vs Nx Cloud'
  - tag: script
    attrs: { type: application/ld+json }
    content: |
      {"@context":"https://schema.org","@type":"TechArticle","headline":"Self-hosted Nx remote cache vs Nx Cloud","description":"An honest comparison of Nx Cloud and a free self-hosted Nx remote cache across cost, security, control, and data residency.","url":"https://remotecache.dev/compare/nx-cloud/","author":{"@type":"Person","name":"Thilak Rao"},"mainEntityOfPage":"https://remotecache.dev/compare/nx-cloud/"}
---

This page tries to be fair. Nx Cloud is a capable product with real advantages this server cannot replicate. Read both sections and pick the one that fits your actual constraints — not the one that has the better marketing page.

For context on why the official self-hosted plugins were deprecated and why this server exists, see [Why this server](/why/).

## At a glance

|                                | **Nx Cloud**                                                   | **This server**                                                                        |
| ------------------------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Cost**                       | Hobby: $0 · Team: $19 /contributor-month¹ · Enterprise: custom | Infrastructure cost only — no per-seat or per-contributor fee                          |
| **Hosting model**              | Managed SaaS (Nrwl/Nx)                                         | Self-hosted on your own infrastructure                                                 |
| **Cache-poisoning defense**    | Built-in cryptographic artifact-integrity verification         | `readonly`/`full` token split — untrusted CI gets read-only and cannot write artifacts |
| **Distributed task execution** | Yes — Nx Agents included on all plans                          | Cache only; no distributed execution                                                   |
| **Data residency**             | Nx infrastructure (US by default)                              | Your infra — air-gapped deployments supported                                          |
| **License**                    | Proprietary SaaS                                               | MIT                                                                                    |
| **Support**                    | Official Nrwl support + SLA on Team/Enterprise                 | Community / self-managed                                                               |

¹ Prices observed June 2026; first 5 contributors are free on the Team plan. Verify current figures at [nx.dev/pricing](https://nx.dev/pricing) before budgeting — Nx has changed its pricing model several times, and the numbers drift.

## When Nx Cloud is the right call

Nx Cloud has genuine advantages that a self-hosted cache cannot replicate.

**Cryptographic artifact integrity.** Nx Cloud's caching architecture includes built-in poisoning protection: artifacts are cryptographically bound to their source and verified on retrieval. CVE-2025-36852 (CREEP) was [explicitly not applicable to Nx Cloud](https://x.com/jeffbcross/status/2057543663727833369) because of this design. If cryptographic end-to-end integrity is a hard requirement for your security posture, Nx Cloud is the correct choice. This server does not replicate that guarantee — the `readonly`/`full` token split is an access-control primitive, not cryptographic verification.

**Distributed task execution.** Nx Agents fan out tasks across a fleet of ephemeral machines, cutting wall-clock CI time beyond what cache hits alone achieve. All Nx Cloud plans, including Hobby, include this. This server is a cache endpoint; it does nothing for task distribution.

**SaaS convenience.** No container to run, no storage bucket to provision, no on-call page when the cache tier goes down. For a small team without dedicated platform engineering bandwidth, the operational cost of self-hosting is real.

**Official support.** Team and Enterprise plans carry Nrwl SLAs. If the cache layer fails during a release weekend, you have someone to call.

**The Hobby tier is genuinely free.** If your team is small and your monthly CI runs stay within the credit limit, Nx Cloud costs nothing and includes both remote caching and Nx Agents. This server's cost advantage only materializes once you grow past that tier or have constraints that rule out managed SaaS.

## When self-hosting this server wins

**Cost at scale.** Once a team outgrows the Hobby credit cap, Nx Cloud bills per active contributor. For large teams or organizations running multiple monorepos, that per-seat cost compounds. This server costs infrastructure: one container and an object storage bucket (S3-compatible or GCS), or a local filesystem volume. The delta between that and $19/contributor-month × N is the concrete saving.

**Data residency and air-gapped environments.** If your security policy prohibits build artifacts from leaving your network — regulated industries, government contractors, financial services — managed SaaS is ruled out. This server runs wherever your infrastructure runs: on-prem, inside your VPC, or fully air-gapped.

**Full control, auditable code.** MIT license. You can read the source, audit it, fork it, or patch it. The official `@nx/*-cache` plugins were [Commercial-licensed](https://cloud.nx.app/terms/self-hosted-cache/2025-03-05) even while free: you could not modify, redistribute, or benchmark them. For teams with procurement or legal requirements around open-source, the license distinction matters.

**No per-seat model.** This server has no concept of contributors or seats and does not phone home. Capacity is bounded only by your own infrastructure.

**Write isolation by trust boundary.** The `readonly`/`full` token split lets you issue read-only credentials to untrusted CI contexts — PRs from forks, feature branches, pipelines where the source is less trusted. Those jobs get cache hits but cannot write new artifacts. This denies write access to untrusted CI contexts, closing the path CREEP exploits in a single-credential setup. The underlying first-writer-wins property of the cache storage remains, so a `full` token must be held only by trusted pipelines. See the [security guide](/guides/security/) for an honest account of what this server does and does not prevent.

## Ready to run it?

Setup takes about five minutes. The [quickstart guide](/getting-started/quickstart/) starts the server, creates a token, and points Nx at it; the [deployment guide](/deploy/docker/) covers Docker, Kubernetes, and standalone-binary installs.

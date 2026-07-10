---
title: 'CI recipes'
description: 'Wire the Nx remote cache into GitHub Actions and GitLab CI with readonly tokens for untrusted jobs and a full token only on trusted branches.'
head:
  - tag: title
    content: 'Nx Remote Cache in GitHub Actions and GitLab CI | remotecache'
---

Nx talks to this server through two environment variables, so any CI provider works. What differs per provider is how you keep the `full` token away from untrusted jobs. That separation is the whole point: a `readonly` token can pull cache hits but cannot write, so an untrusted job can never poison an artifact that a trusted build later consumes (see [CVE-2025-36852](/security/cve-2025-36852/)).

Create the two tokens once with the [admin API](/guides/tokens/):

```sh
# full: for trusted pipelines that populate the cache (main, deploy)
curl -sS -X POST -H "Authorization: Bearer ${ADMIN_TOKEN}" -H "Content-Type: application/json" \
  "https://cache.example.com/v1/admin/tokens" -d '{"id":"ci-main","permission":"full"}'

# readonly: for everything else
curl -sS -X POST -H "Authorization: Bearer ${ADMIN_TOKEN}" -H "Content-Type: application/json" \
  "https://cache.example.com/v1/admin/tokens" -d '{"id":"ci-readonly","permission":"readonly"}'
```

## GitHub Actions

Store both token values as repository secrets (`NX_CACHE_FULL_TOKEN`, `NX_CACHE_READONLY_TOKEN`). The workflow picks the token by branch: `main` gets `full`, everything else gets `readonly`.

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  main:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - name: Run Nx
        env:
          NX_CACHE_TOKEN: ${{ github.ref == 'refs/heads/main' && secrets.NX_CACHE_FULL_TOKEN || secrets.NX_CACHE_READONLY_TOKEN }}
        run: |
          if [ -n "$NX_CACHE_TOKEN" ]; then
            export NX_SELF_HOSTED_REMOTE_CACHE_SERVER="https://cache.example.com"
            export NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN="$NX_CACHE_TOKEN"
          fi
          npx nx affected -t lint test build
```

### Fork pull requests

GitHub does not pass secrets to workflows triggered by a `pull_request` from a fork. `NX_CACHE_TOKEN` is empty there, so the workflow exports neither Nx remote-cache variable and Nx uses only its local cache. Fork PRs get no cache credentials of any kind.

Do not work around this with `pull_request_target` to hand tokens to fork code. That event runs with secret access against untrusted head commits, and chained with cache poisoning it is exactly the attack pattern seen in the May 2026 TanStack compromise.

## GitLab CI

GitLab's protected variables map onto the token split directly. Define two CI/CD variables:

- `NX_CACHE_READONLY_TOKEN`: a normal variable, available to every branch pipeline.
- `NX_CACHE_FULL_TOKEN`: a **protected** variable, exposed only to pipelines on protected branches (protect `main`).

```yaml
default:
  image: node:22

.nx-cache: &nx-cache
  before_script:
    - npm ci
    - |
      if [ -n "$NX_CACHE_FULL_TOKEN" ]; then
        NX_CACHE_TOKEN="$NX_CACHE_FULL_TOKEN"
      else
        NX_CACHE_TOKEN="$NX_CACHE_READONLY_TOKEN"
      fi
      if [ -n "$NX_CACHE_TOKEN" ]; then
        export NX_SELF_HOSTED_REMOTE_CACHE_SERVER="https://cache.example.com"
        export NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN="$NX_CACHE_TOKEN"
      fi

build:
  <<: *nx-cache
  script:
    - npx nx affected -t lint test build
```

On a protected branch both variables exist and the job exports the `full` token; on any other branch only the readonly one is set. Pipelines for merge requests from forks receive no CI/CD variables by default, so the job exports neither Nx remote-cache variable and uses only its local cache.

## Any other CI

Set the same two variables on the process that runs Nx:

```sh
export NX_SELF_HOSTED_REMOTE_CACHE_SERVER="https://cache.example.com"
export NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN="<readonly-or-full-token>"
```

Two rules carry over regardless of provider:

- Only pipelines you trust to produce artifacts (typically `main` and deploy jobs) get the `full` token.
- If a job's inputs can be influenced by people you would not let push to `main`, it gets `readonly` or nothing.

The [security model](/guides/security/) explains what the token split does and does not protect against.

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

Configure the credentials like this:

- Store `NX_CACHE_READONLY_TOKEN` as a repository secret.
- Create a GitHub environment named `nx-cache-write`.
- In the environment's deployment branches and tags settings, choose selected branches and tags and allow only `main`.
- Store `NX_CACHE_FULL_TOKEN` as an environment secret in `nx-cache-write`, never as a repository secret.

Selecting between repository secrets with an expression does not restrict access. [Repository secrets are available to every workflow in the repository](https://docs.github.com/en/code-security/reference/secret-security/secret-types), and a same-repository pull request controls its workflow file. It can change the workflow to reference `NX_CACHE_FULL_TOKEN` directly. The [`main` deployment branch restriction](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments#deployment-branches-and-tags) on `nx-cache-write` is the access-control boundary.

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  pull-request:
    if: github.event_name == 'pull_request'
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
          NX_CACHE_TOKEN: ${{ secrets.NX_CACHE_READONLY_TOKEN }}
        run: |
          if [ -n "$NX_CACHE_TOKEN" ]; then
            export NX_SELF_HOSTED_REMOTE_CACHE_SERVER="https://cache.example.com"
            export NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN="$NX_CACHE_TOKEN"
          fi
          npx nx affected -t lint test build

  main:
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    environment: nx-cache-write
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
          NX_CACHE_TOKEN: ${{ secrets.NX_CACHE_FULL_TOKEN }}
        run: |
          if [ -n "$NX_CACHE_TOKEN" ]; then
            export NX_SELF_HOSTED_REMOTE_CACHE_SERVER="https://cache.example.com"
            export NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN="$NX_CACHE_TOKEN"
          fi
          npx nx affected -t lint test build
```

### Fork pull requests

By default, GitHub does not pass repository secrets to workflows triggered by a `pull_request` from a fork, and Dependabot workflows cannot access Actions secrets. `NX_CACHE_TOKEN` is empty in both cases, so the job exports neither Nx remote-cache variable and Nx uses only its local cache.

For private repositories, leave [**Send secrets to workflows from pull requests**](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository#enabling-workflows-for-forks-of-private-repositories) disabled. If you enable it, fork pull requests receive the readonly repository token. The `main` branch restriction on `nx-cache-write` still blocks access to the full token.

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

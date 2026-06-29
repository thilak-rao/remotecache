# Contributing

Want to improve remotecache? Here's what you need.

## Prerequisites

This project runs on [Bun](https://bun.sh). Install Bun, then:

```sh
bun install
```

## Develop

- `bun run serve` — start the server (requires `ADMIN_TOKEN`).
- `bun test` — run unit (`*.spec.ts`) and e2e (`e2e/*.e2e.spec.ts`) tests.
- `bun run lint` — oxlint.
- `bun run format` — oxfmt (rewrites files). CI runs `bun run format --check`, so format before pushing.
- `bun audit` — audit root dependencies.

Build and audit the docs site from `docs-site/`:

```sh
bun install --frozen-lockfile
bun audit
bun run build
```

Docker changes should also pass a local image smoke test:

```sh
docker build -t remotecache:ci .
docker run -d --name remotecache-ci -e ADMIN_TOKEN=test-token -p 3000:3000 remotecache:ci
curl -fsS http://127.0.0.1:3000/health
docker rm -f remotecache-ci
```

Chart changes should pass lint and template rendering:

```sh
helm lint charts/remotecache --set adminToken=ci-admin-token
helm template rc charts/remotecache -f charts/remotecache/ci/filesystem-values.yaml
helm template rc charts/remotecache -f charts/remotecache/ci/s3-values.yaml
helm template rc charts/remotecache -f charts/remotecache/ci/tls-values.yaml
```

## Conventions

- Conventional Commits: `type(scope): subject` (`feat|fix|docs|refactor|perf|test|build|ci|chore|revert`).
- Bun built-ins only — no Node-only equivalents or extra deps for what Bun provides. The one approved exception is `@aws-sdk/credential-providers`, used to resolve EKS IRSA / ECS / IMDS credentials that `Bun.S3Client` cannot resolve natively.
- Docs travel with code: a change to behavior, the HTTP API, env vars, or config updates the matching docs surface in the same commit (see `AGENTS.md`).
- Full docs: https://remotecache.dev/

## Releases

Release Please manages changelogs, version bumps, GitHub Releases, and SemVer tags.

Normal contributor PRs should use Conventional Commits. After changes land on `main`, Release Please opens or updates a release PR. A maintainer reviews and merges that release PR when it is time to publish.

The release workflow needs a `RELEASE_PLEASE_TOKEN` repository secret. See the release guide in the docs site for token permissions and troubleshooting.

## Pull requests

CI must pass: format, lint, tests, audits, docs build, Docker smoke, Helm lint/template, Trivy filesystem scan, and CodeQL. Keep PRs focused.

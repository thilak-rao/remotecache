## What & why

<!-- Brief description of the change and motivation. -->

## Checklist

- [ ] `bun run format --check` passes
- [ ] `bun run lint` passes
- [ ] `bun test` passes
- [ ] `bun audit` passes
- [ ] `cd docs-site && bun audit && bun run build` passes when docs, OpenAPI, or docs dependencies changed
- [ ] Docker smoke check considered when Dockerfile, runtime env, or server startup changed
- [ ] Docs updated where behavior/API/config/env changed (README, `docs-site/`, or `nx-cache-server.openapi.json`)
- [ ] Commits follow Conventional Commits

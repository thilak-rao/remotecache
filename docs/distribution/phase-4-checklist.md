# Phase 4 distribution checklist

This checklist tracks the Phase 4 work that needs account access or manual publication. It is not a record of completed work.

| Item                                      | Owner      | Status      | Acceptance criteria                                                                                                                   |
| ----------------------------------------- | ---------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Nx RFC discussion                         | Unassigned | Not started | A short post in nrwl/nx#30548 links to remotecache, the migration guide, and the CREEP security page.                                 |
| nx.dev community implementations proposal | Unassigned | Not started | An issue or PR proposes adding remotecache to the self-hosted caching docs as a community implementation.                             |
| Artifact Hub listing                      | Unassigned | Not started | The published Helm OCI chart appears on Artifact Hub and links back to `https://remotecache.dev/deploy/kubernetes/`.                  |
| Docker Hub mirror                         | Unassigned | Not started | A `thilakrao/remotecache` or organization-owned Docker Hub repository mirrors stable release tags from GHCR.                          |
| dev.to cross-post                         | Unassigned | Not started | `/why/` is adapted into a dev.to post targeting "nx self-hosted cache deprecated alternative" without overstating the security model. |
| Medium cross-post                         | Unassigned | Not started | The same adapted story is posted on Medium with canonical links back to `https://remotecache.dev/why/`.                               |
| Nx Discord announcement                   | Unassigned | Not started | A concise announcement links to the quickstart, migration guide, and security model.                                                  |
| OpenSSF Best Practices badge              | Unassigned | Not started | The project profile at bestpractices.dev reaches at least passing status and the README badge is added.                               |
| Coverage reporting                        | Unassigned | Not started | CI uploads Bun coverage to the chosen provider and the README badge reports coverage for `main`.                                      |

## Nx RFC discussion

Target: <https://github.com/nrwl/nx/discussions/30548>

Suggested post:

```md
For teams that still want a self-hosted cache after the @nx/\*-cache deprecation, I maintain remotecache: https://github.com/thilak-rao/remotecache

It implements Nx's custom remote cache HTTP API, ships Docker/Helm/binary releases, and separates `readonly` from `full` tokens so untrusted CI can read cache entries without writing poisoned artifacts. That does not replace Nx Cloud's cryptographic artifact verification, but it does give self-hosters a write-trust boundary the deprecated single-credential plugins did not have.

Docs:

- Why this exists: https://remotecache.dev/why/
- Migration guide: https://remotecache.dev/guides/migrate-from-nx-s3-cache/
- Security model: https://remotecache.dev/guides/security/
```

Acceptance check: the post is live and any maintainer feedback is linked from this file.

## nx.dev community implementations proposal

Target page: <https://nx.dev/ci/recipes/self-hosted-cache>

Open an issue first unless the Nx maintainers have invited a PR. Proposed change: add a "Community implementations" section that lists custom remote cache endpoints separately from official Nx products.

Acceptance check: issue or PR URL recorded here.

## Artifact Hub

Useful links:

- Artifact Hub Helm chart docs: <https://artifacthub.io/docs/topics/repositories/helm-charts/>
- OCI Helm chart FAQ: <https://artifacthub.io/docs/topics/faq/>

The chart is published as an OCI artifact at:

```sh
oci://ghcr.io/thilak-rao/charts/remotecache
```

Acceptance check: `helm search hub remotecache` finds the chart after Artifact Hub indexing finishes.

## Docker Hub mirror

Mirror stable release tags from GHCR to Docker Hub. Do not mirror `edge` unless the Docker Hub README clearly marks it as unreleased.

Acceptance check:

```sh
set -euo pipefail
docker pull docker.io/<owner>/remotecache:<version>
trap 'docker rm -f remotecache-dockerhub-smoke >/dev/null 2>&1 || true' EXIT
docker run -d --name remotecache-dockerhub-smoke -p 3000:3000 -e ADMIN_TOKEN=smoke-admin-token-0123456789 docker.io/<owner>/remotecache:<version>
for attempt in $(seq 1 30); do
  curl -fsS http://127.0.0.1:3000/health && exit 0
  sleep 1
done
docker logs remotecache-dockerhub-smoke
exit 1
```

## Cross-posts

Source article: <https://remotecache.dev/why/>

Keep the headline practical. Suggested titles:

- "A self-hosted Nx cache after the @nx/\*-cache deprecation"
- "An MIT-licensed alternative to the deprecated Nx self-hosted cache plugins"

Avoid claiming remotecache "fixes CREEP" outright. The accurate claim is narrower: append-only writes and read-only CI tokens let operators deny write access to untrusted pipelines.

Acceptance check: published URLs recorded here and canonical links point back to remotecache.dev where the platform supports them.

## Nx Discord

Post only after the deploy docs and migration guide are current.

Suggested announcement:

```md
I maintain remotecache, an MIT-licensed self-hosted Nx remote cache endpoint for teams migrating off the deprecated @nx/\*-cache plugins.

Quickstart: https://remotecache.dev/getting-started/quickstart/
Migration guide: https://remotecache.dev/guides/migrate-from-nx-s3-cache/
Security model: https://remotecache.dev/guides/security/
```

Acceptance check: announcement channel, date, and any useful replies recorded here.

## OpenSSF Best Practices badge

Start at <https://www.bestpractices.dev/en>. Use the existing repository evidence:

- CI, docs, CodeQL, Scorecard, Trivy, and release workflows in `.github/workflows/`
- security documentation under `docs-site/src/content/docs/guides/security.md`
- MIT license in `LICENSE`
- contribution docs under `docs-site/src/content/docs/contributing/`

Acceptance check: passing badge URL recorded here and README badge added in a follow-up PR.

## Coverage reporting

Pick one provider before wiring CI. Codecov is the default candidate because it has a GitHub Action uploader and README status badges, but this project should only add it after deciding whether tokenless public uploads are acceptable.

Acceptance check:

- `bun test --coverage` or the chosen Bun coverage command runs in CI.
- The provider receives reports from `main`.
- README badge links to the provider's project page.

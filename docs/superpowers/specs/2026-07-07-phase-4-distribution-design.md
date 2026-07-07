# Phase 4 distribution design

## Goal

Make Phase 4 useful from the repository alone: add deploy templates, docs, README positioning, and an owner-run checklist for the external publishing work that cannot be completed without account access.

## Scope

This slice is repo-local only. It does not post to Nx discussions, open nx.dev PRs, publish to Artifact Hub, mirror images to Docker Hub, submit OpenSSF forms, or configure third-party accounts.

## Deploy templates

Add root-level templates for:

- Railway: `railway.json`
- Render: `render.yaml`
- Fly.io: `fly.toml`

Each template should run the existing Dockerfile or published image path, expose port `3000`, point health checks at `/health`, and keep secrets out of the file. `ADMIN_TOKEN` must be set as a platform secret or dashboard variable. Filesystem persistence should use the platform's volume/disk mechanism where the platform supports it in code. If persistence cannot be fully expressed in the file, the docs must say so plainly.

The Docker image should prepare mounted `CACHE_DIR` and `TOKENS_DB_PATH` directories before starting the server as the `bun` user, so platform volumes mounted over `/app/data` work without running the server as root.

## Documentation

Add a deployment page for Railway, Render, and Fly.io. The page should cover:

- which template file each platform reads
- how to set `ADMIN_TOKEN`
- how persistence works for `CACHE_DIR=/app/data/cache` and `TOKENS_DB_PATH=/app/data/tokens.sqlite`
- why single-instance filesystem storage is the default for these templates
- when to switch to S3 instead of relying on host-local volumes
- the provider-side validation commands maintainers can run after installing the relevant CLI

Update the docs sidebar and README links so users can find the new page.

## README positioning

The README should answer the CREEP question without making a stronger claim than the server can prove. The exact message: append-only writes plus read-only CI tokens let operators enforce the write-trust boundary that the deprecated single-credential plugins lacked. This is not cryptographic artifact verification and should link to the security docs for the full model.

## External checklist

Add `docs/distribution/phase-4-checklist.md` for account-bound actions:

- Nx RFC discussion and nx.dev community implementations proposal
- Artifact Hub listing
- Docker Hub mirror
- dev.to and Medium cross-posts
- Nx Discord announcement
- OpenSSF Best Practices badge
- coverage reporting and badge setup

The checklist should include source links, acceptance criteria, and a place to record the owner and status. It should not pretend any external action has already happened.

## Verification

Run syntax checks for the new JSON, YAML, and TOML files using local tooling. Run the docs build to catch broken links and frontmatter errors. Run format, lint, and typecheck if the touched files make those checks relevant.

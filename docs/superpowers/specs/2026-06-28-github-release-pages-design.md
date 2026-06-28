# Design: GitHub Release pages for v1.0.0 and v2.0.0

Date: 2026-06-28

## Goal

Publish two GitHub Release pages for the already-pushed tags `v1.0.0` and
`v2.0.0`. The tags exist and the GHCR images are published; what's missing is the
human-readable Release pages with notes and a "Latest" marker.

## Scope

- Create two GitHub Releases via `gh release create` against existing tags.
- No repo changes: no `CHANGELOG.md`, no workflow changes, no code.
- `v1.0.0` is published as a normal past release (`--latest=false`).
- `v2.0.0` is published as the latest release (`--latest`) with a breaking-change
  callout.

Out of scope: a committed changelog file, automating release creation in CI,
editing existing releases (none exist yet).

## Approach

Two `gh release create <tag>` calls, each with `--title` and `--notes` (or
`--notes-file`). Order: create `v1.0.0` first with `--latest=false`, then
`v2.0.0` with `--latest`, so the newest line ends up flagged as Latest.

Idempotency: no releases exist today, so plain `create` is correct. If a call
ever collides with an existing release, fall back to `gh release edit <tag>`.

## Release notes content

The notes below are the final, humanized copy to publish verbatim.

### v1.0.0

Title: `v1.0.0`

```
**Security**
- Enforce `MAX_UPLOAD_BYTES` on uploads (returns `413` over the limit). It was documented before this release but never actually checked.
- Compare the admin token in constant time.
- Reject path-traversal and malformed cache hashes, and require an integer `Content-Length`.

**Build and CI**
- Run the container as a non-root user; pin the Bun base image to `1.3.14-alpine` by digest.
- Publish to GHCR from CI: a push to `main` gives `:latest` and `:sha-<short>`; version tags give `:X.Y.Z` and `:X.Y`.
- Dependabot now also watches GitHub Actions and Docker, not just Bun dependencies.

**Maintenance**
- Upgrade dev dependencies to latest. Add `AGENTS.md` as the shared agent guide.

Pull: `docker pull ghcr.io/thilak-rao/nx-cache-server-bun:1.0.0`
```

### v2.0.0

Title: `v2.0.0`

```
> [!WARNING]
> Breaking change. Token values are now hashed (SHA-256) at rest.

Existing SQLite databases migrate themselves on first start (gated by `PRAGMA user_version`), so you don't need to do anything by hand. One thing to know: a token's plaintext now appears exactly once, when you create it. The admin list and lookup endpoints return only `id` and `permission`, so a lost token can't be recovered and has to be replaced.

Pull: `docker pull ghcr.io/thilak-rao/nx-cache-server-bun:2.0.0`
```

## Verification

- `gh release list` shows both `v1.0.0` and `v2.0.0`.
- `gh release view v2.0.0` shows it marked Latest; `gh release view v1.0.0` is not.
- Both release bodies match the copy above.

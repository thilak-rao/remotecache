# GitHub Release Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish GitHub Release pages for the existing `v1.0.0` and `v2.0.0` tags, with `v2.0.0` marked as Latest.

**Architecture:** Two `gh release create` calls against tags that already exist and already have GHCR images. No repo changes, no code, no workflow edits. `v1.0.0` is created first as a non-latest past release; `v2.0.0` is created second as the latest release with a breaking-change callout.

**Tech Stack:** `gh` CLI (GitHub releases).

## Global Constraints

- Operate against the existing tags `v1.0.0` and `v2.0.0`; do not create or move tags.
- No commits to the repo. This task only creates GitHub Releases.
- `v1.0.0` → `--latest=false`. `v2.0.0` → `--latest`.
- Notes are published verbatim from the spec (`docs/superpowers/specs/2026-06-28-github-release-pages-design.md`); do not paraphrase.
- Release notes are written to temp files under the scratchpad, not committed.

---

### Task 1: Publish the v1.0.0 release

**Files:**

- Create (temp, not committed): `<scratchpad>/v1.0.0-notes.md`

**Interfaces:**

- Consumes: existing git tag `v1.0.0`.
- Produces: a GitHub Release named `v1.0.0`, not flagged Latest.

- [ ] **Step 1: Confirm no release exists yet for the tag**

Run: `gh release view v1.0.0 2>&1 || echo "NO RELEASE YET"`
Expected: `release not found` / `NO RELEASE YET` (if a release already exists, stop and switch to `gh release edit v1.0.0` instead of `create`).

- [ ] **Step 2: Write the notes file**

Write this exact content to `<scratchpad>/v1.0.0-notes.md`:

```markdown
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

- [ ] **Step 3: Create the release**

Run: `gh release create v1.0.0 --title "v1.0.0" --notes-file <scratchpad>/v1.0.0-notes.md --latest=false --verify-tag`
Expected: prints the release URL, exit 0.

- [ ] **Step 4: Verify it published and is not Latest**

Run: `gh release view v1.0.0 --json tagName,isLatest,name`
Expected: `{"isLatest":false,"name":"v1.0.0","tagName":"v1.0.0"}`.

---

### Task 2: Publish the v2.0.0 release as Latest

**Files:**

- Create (temp, not committed): `<scratchpad>/v2.0.0-notes.md`

**Interfaces:**

- Consumes: existing git tag `v2.0.0`.
- Produces: a GitHub Release named `v2.0.0`, flagged Latest.

- [ ] **Step 1: Confirm no release exists yet for the tag**

Run: `gh release view v2.0.0 2>&1 || echo "NO RELEASE YET"`
Expected: `release not found` / `NO RELEASE YET` (if one exists, switch to `gh release edit v2.0.0`).

- [ ] **Step 2: Write the notes file**

Write this exact content to `<scratchpad>/v2.0.0-notes.md`:

```markdown
> [!WARNING]
> Breaking change. Token values are now hashed (SHA-256) at rest.

Existing SQLite databases migrate themselves on first start (gated by `PRAGMA user_version`), so you don't need to do anything by hand. One thing to know: a token's plaintext now appears exactly once, when you create it. The admin list and lookup endpoints return only `id` and `permission`, so a lost token can't be recovered and has to be replaced.

Pull: `docker pull ghcr.io/thilak-rao/nx-cache-server-bun:2.0.0`
```

- [ ] **Step 3: Create the release as Latest**

Run: `gh release create v2.0.0 --title "v2.0.0" --notes-file <scratchpad>/v2.0.0-notes.md --latest --verify-tag`
Expected: prints the release URL, exit 0.

- [ ] **Step 4: Verify it published and is Latest**

Run: `gh release view v2.0.0 --json tagName,isLatest,name`
Expected: `{"isLatest":true,"name":"v2.0.0","tagName":"v2.0.0"}`.

---

### Task 3: Final verification

- [ ] **Step 1: Both releases listed, v2.0.0 is Latest**

Run: `gh release list`
Expected: two rows, `v1.0.0` and `v2.0.0`, with `Latest` next to `v2.0.0` only.

- [ ] **Step 2: Report the two release URLs to the user.**

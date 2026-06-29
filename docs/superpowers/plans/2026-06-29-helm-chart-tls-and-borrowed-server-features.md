# Helm chart, direct TLS, and borrowed server features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a production-grade Helm chart for remotecache, backed by a server that actually works in Kubernetes — direct TLS, a `BIND_ADDRESS`/IPv6 listen option, graceful SIGTERM draining, IRSA/ambient AWS credentials, and hardened hash validation.

**Architecture:** Keep handlers thin and responses built from `src/responses.ts`. New server behavior lands as small, unit-testable modules wired into `src/main.ts`. S3 credentials gain an AWS provider-chain path (IRSA/ECS/IMDS) via `@aws-sdk/credential-providers`, with a refresh-on-expiry wrapper around `Bun.S3Client`. The Helm chart under `charts/remotecache/` renders against these features and is validated in CI with `helm lint` and `helm template` across filesystem, S3, and TLS value sets.

**Tech Stack:** Bun (`Bun.serve` with `tls`/`hostname`, `bun:sqlite`, `bun:test`, `Bun.S3Client`), `@aws-sdk/credential-providers@3.1075.0`, Helm 3 charts, GitHub Actions, Astro/Starlight docs.

## Global Constraints

- Runtime is Bun. Use `Bun.serve`, `Bun.env`, `bun:test`, `Bun.file`, `Bun.S3Client`. Do not add Node-only replacements for what Bun provides.
- `@aws-sdk/credential-providers` is the **one approved dependency exception** (for EKS IRSA / ECS / IMDS credential resolution, which `Bun.S3Client` cannot do natively). Do not add other runtime deps.
- No `console`: import `logger` from `src/logger.ts`. `no-console` and `no-explicit-any` are lint errors.
- Single quotes; run `bun run format` before committing (`oxfmt`). CI gate is `bun run format --check`.
- Responses come from factories in `src/responses.ts`. Handlers in `src/main.ts` stay thin.
- Cache writes stay append-only (existing hash → `409`).
- Docs travel with the change: env vars and config → `docs-site/.../guides/configuration.md`; behavior/deploy → `docs-site/.../guides/deployment.md`; the `docs-site` API Reference is generated from `nx-cache-server.openapi.json`.
- Conventional Commits (`type(scope): subject`).

## Out of scope (explicit)

- Helm **OCI publishing** to GHCR — that is roadmap Phase 6, a separate plan. This plan only creates the chart and validates it with lint/template in CI.
- Binary distribution, S3 robustness/MinIO integration tests, CI/CD composite-action DRY, docs-site polish, and the final docs-site revision — all recorded as new roadmap phases in the design spec, each its own later plan.
- Changing the Nx cache HTTP contract. TLS is transport configuration, not an API change, so `nx-cache-server.openapi.json` does **not** change in this plan.

---

## Current baseline

Branch `teardown-fix`, HEAD `c967419 docs: add plan 4 handoff`. Plans 1–4 are complete. `GET /health` exists, unauthenticated, returning `200 OK` (`text/plain`).

Verified facts that shape this plan:

- **Bun TLS** (ctx7 `/oven-sh/bun`): `Bun.serve({ tls: { cert: Bun.file(certPath), key: Bun.file(keyPath) } })`. Both `cert` and `key` are required; they accept a string, `BunFile`, `TypedArray`, or `Buffer`.
- **Bun graceful shutdown** (ctx7 `/oven-sh/bun`): `await server.stop()` drains in-flight requests; `server.stop(true)` force-closes. `idleTimeout` defaults to 10s.
- **Bun.S3Client credentials** (ctx7 `/oven-sh/bun`): reads `S3_*` env vars and falls back to `AWS_*` (incl. `AWS_REGION`, `AWS_SESSION_TOKEN`). Constructor options or per-call options override defaults. It does **not** perform the STS web-identity exchange that EKS IRSA / ECS task roles need.
- **`@aws-sdk/credential-providers`** latest = `3.1075.0` (npm). `fromNodeProviderChain()` runs the full default chain (env → SSO → web-identity/IRSA → shared ini → ECS → EC2 IMDS) and returns an async provider yielding `{ accessKeyId, secretAccessKey, sessionToken?, expiration? }`. `expiration` is a `Date` for temporary credentials.
- **IRSA convention** (gh cross-check, e.g. `hashicorp/vault-secrets-operator` chart): a `ServiceAccount` annotated with `eks.amazonaws.com/role-arn: arn:aws:iam::...:role/...`.
- **Dockerfile gap**: the current `Dockerfile` has no `bun install` (the project has zero runtime deps today). Adding `@aws-sdk/credential-providers` makes a dependency install **mandatory** — `src/cache/create-cache-storage.ts` imports it at module load, so without it even filesystem containers fail to start.
- Helm is installed locally (`helm version` → `v4.x`). CI installs Helm via a pinned `azure/setup-helm`.

## File map

Create (server):

- `src/tls/load-tls-config.ts` — resolve/validate `TLS_CERT_PATH`/`TLS_KEY_PATH`.
- `src/tls/load-tls-config.spec.ts` — unit tests.
- `src/cache/create-cache-storage.spec.ts` — tests for `resolveS3Config` + strategy selection.
- `src/cache/storage-strategy/s3.spec.ts` — tests for `shouldRefreshCredentials`.
- `e2e/tls.e2e.spec.ts` — HTTPS round-trip + `/health` over HTTPS.
- `e2e/graceful-shutdown.e2e.spec.ts` — SIGTERM drains and exits 0.

Modify (server):

- `src/cache/is-valid-hash.ts` + `src/cache/is-valid-hash.spec.ts` — drop dots, cap length 128.
- `src/cache/create-cache-storage.ts` — optional keys, `resolveS3Config`, provider chain.
- `src/cache/storage-strategy/s3.ts` — credential-provider + refresh wrapper.
- `src/main.ts` — `BIND_ADDRESS`, TLS, SIGTERM/SIGINT.
- `package.json` (+ generated `bun.lock`) — add the dependency.
- `Dockerfile` — install dependencies.

Create (chart):

- `charts/remotecache/Chart.yaml`
- `charts/remotecache/values.yaml`
- `charts/remotecache/.helmignore`
- `charts/remotecache/templates/_helpers.tpl`
- `charts/remotecache/templates/serviceaccount.yaml`
- `charts/remotecache/templates/secret.yaml`
- `charts/remotecache/templates/pvc.yaml`
- `charts/remotecache/templates/service.yaml`
- `charts/remotecache/templates/deployment.yaml`
- `charts/remotecache/templates/NOTES.txt`
- `charts/remotecache/ci/filesystem-values.yaml`
- `charts/remotecache/ci/s3-values.yaml`
- `charts/remotecache/ci/tls-values.yaml`

Modify (CI + docs):

- `.github/workflows/ci.yml` — `helm` job (lint + template ×3).
- `docs-site/src/content/docs/guides/configuration.md`
- `docs-site/src/content/docs/guides/deployment.md`
- `docs-site/src/content/docs/contributing/releases.md`
- `CONTRIBUTING.md`
- `.github/pull_request_template.md`
- `AGENTS.md`
- `README.md`

---

# Part A — Server features

These are prerequisites for an honest chart (probes, TLS mount, IRSA all depend on real server behavior). Part A can be merged as its own PR before Part B if desired.

## Task A1: Harden hash validation (drop dots, cap length)

**Files:**

- Modify: `src/cache/is-valid-hash.ts`
- Modify: `src/cache/is-valid-hash.spec.ts`

**Interfaces:**

- Produces: `isValidHash(hash: string | undefined): boolean` — accepts `^[A-Za-z0-9_-]{1,128}$`.

- [ ] **Step 1: Update the test to encode the new rules**

Replace the entire body of `src/cache/is-valid-hash.spec.ts` with:

```ts
import { describe, expect, it } from 'bun:test';
import { isValidHash } from './is-valid-hash';

describe('isValidHash', () => {
  it('accepts typical Nx cache hashes', () => {
    expect(isValidHash('a1b2c3d4e5f6')).toBe(true);
    expect(isValidHash('1234567890abcdefABCDEF')).toBe(true);
    expect(isValidHash('hash-with-dashes_and_underscores')).toBe(true);
  });

  it('rejects dots so a hash cannot collide with the .tmp write path or the cache dir', () => {
    expect(isValidHash('.')).toBe(false);
    expect(isValidHash('..')).toBe(false);
    expect(isValidHash('abc.tmp')).toBe(false);
    expect(isValidHash('file.tar.gz')).toBe(false);
  });

  it('rejects path separators and traversal sequences', () => {
    expect(isValidHash('../etc/passwd')).toBe(false);
    expect(isValidHash('foo/bar')).toBe(false);
    expect(isValidHash('foo\\bar')).toBe(false);
  });

  it('rejects empty, undefined, and out-of-charset values', () => {
    expect(isValidHash('')).toBe(false);
    expect(isValidHash(undefined)).toBe(false);
    expect(isValidHash('has space')).toBe(false);
  });

  it('caps length at 128 characters', () => {
    expect(isValidHash('a'.repeat(128))).toBe(true);
    expect(isValidHash('a'.repeat(129))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun test src/cache/is-valid-hash.spec.ts
```

Expected: FAIL — the current implementation accepts dots (`abc.tmp`) and has no length cap.

- [ ] **Step 3: Implement the hardened validator**

Replace the entire contents of `src/cache/is-valid-hash.ts` with:

```ts
/**
 * Validate a cache hash for use as a filesystem path segment or S3 key.
 *
 * Allows only `[A-Za-z0-9_-]`, length 1–128. Dots are rejected so a hash can
 * never collide with the filesystem strategy's `${hash}.tmp` write path or
 * resolve to the cache directory (`.`) or its parent (`..`).
 */
export function isValidHash(hash: string | undefined): boolean {
  return typeof hash === 'string' && hash.length <= 128 && /^[A-Za-z0-9_-]+$/.test(hash);
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
bun test src/cache/is-valid-hash.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cache/is-valid-hash.ts src/cache/is-valid-hash.spec.ts
git commit -m "fix(cache): reject dots and cap hash length at 128"
```

## Task A2: Configurable bind address with IPv6

**Files:**

- Modify: `src/main.ts`

**Interfaces:**

- Produces: server honors `BIND_ADDRESS` (default `0.0.0.0`; `::` for IPv6/dual-stack).

No dedicated unit test: binding an interface is wiring, not logic, and a meaningful test needs a running socket (covered indirectly by the existing health e2e on the default address). Per the repo rule against low-impact tests, we wire and document it.

- [ ] **Step 1: Add the bind-address constant**

In `src/main.ts`, immediately after the line:

```ts
const PORT = Number(Bun.env.PORT ?? '3000');
```

add:

```ts
const HOSTNAME = Bun.env.BIND_ADDRESS ?? '0.0.0.0';
```

- [ ] **Step 2: Pass `hostname` to `Bun.serve`**

In `src/main.ts`, change:

```ts
export const server = Bun.serve({
  port: PORT,
  routes: {
```

to:

```ts
export const server = Bun.serve({
  port: PORT,
  hostname: HOSTNAME,
  routes: {
```

- [ ] **Step 3: Verify the existing suite still passes**

```bash
bun test
```

Expected: PASS (no regressions; the default `0.0.0.0` preserves current behavior).

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat(server): add BIND_ADDRESS listen option with IPv6 support"
```

## Task A3: Graceful shutdown on SIGTERM/SIGINT

**Files:**

- Create: `e2e/graceful-shutdown.e2e.spec.ts`
- Modify: `src/main.ts`

**Interfaces:**

- Produces: on `SIGTERM`/`SIGINT`, the process calls `server.stop()` (drains in-flight requests) then exits `0`.

- [ ] **Step 1: Write the failing e2e test**

Create `e2e/graceful-shutdown.e2e.spec.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('graceful shutdown e2e', () => {
  it('drains and exits 0 on SIGTERM', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rc-sigterm-'));
    const proc = Bun.spawn(['bun', 'src/main.ts'], {
      env: {
        ...process.env,
        ADMIN_TOKEN: 'admin-token',
        PORT: '4030',
        CACHE_DIR: join(dir, 'cache'),
        TOKENS_DB_PATH: join(dir, 'tokens.sqlite'),
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    let up = false;
    for (let i = 0; i < 50; i++) {
      try {
        const res = await fetch('http://127.0.0.1:4030/health');
        if (res.ok) {
          up = true;
          break;
        }
      } catch {}
      await Bun.sleep(100);
    }
    expect(up).toBe(true);

    proc.kill('SIGTERM');
    const exitCode = await proc.exited;
    rmSync(dir, { recursive: true, force: true });

    expect(exitCode).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
bun test e2e/graceful-shutdown.e2e.spec.ts
```

Expected: FAIL — without signal handlers, Bun's default SIGTERM handling does not exit `0` after draining (the assertion on `exitCode === 0` fails or times out).

- [ ] **Step 3: Add signal handlers**

In `src/main.ts`, replace the final line:

```ts
logger.info(`Server running at ${server.url}`);
```

with:

```ts
logger.info(`Server running at ${server.url}`);

const shutdown = (signal: string) => {
  logger.info(`Received ${signal}, draining connections`);
  server.stop().then(() => process.exit(0));
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

- [ ] **Step 4: Run it to verify it passes**

```bash
bun test e2e/graceful-shutdown.e2e.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts e2e/graceful-shutdown.e2e.spec.ts
git commit -m "feat(server): drain in-flight requests on SIGTERM and SIGINT"
```

## Task A4: Direct TLS support

**Files:**

- Create: `src/tls/load-tls-config.ts`
- Create: `src/tls/load-tls-config.spec.ts`
- Create: `e2e/tls.e2e.spec.ts`
- Modify: `src/main.ts`

**Interfaces:**

- Produces: `loadTlsConfig(env): Promise<{ cert: BunFile; key: BunFile } | undefined>`.
  - neither var set → `undefined` (HTTP).
  - both set, both files exist → `{ cert, key }`.
  - exactly one set → throws (`...both...`).
  - a referenced file missing → throws (`...not found...`).
- Consumes: `src/main.ts` spreads the result into `Bun.serve({ tls })` when defined; on a thrown error it logs and exits `1`.

- [ ] **Step 1: Write the failing unit test**

Create `src/tls/load-tls-config.spec.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTlsConfig } from './load-tls-config';

const asEnv = (o: Record<string, string>) => o as unknown as typeof Bun.env;

describe('loadTlsConfig', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rc-tls-cfg-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns undefined when neither path is set', async () => {
    expect(await loadTlsConfig(asEnv({}))).toBeUndefined();
  });

  it('throws when only one path is set', async () => {
    await expect(loadTlsConfig(asEnv({ TLS_CERT_PATH: '/x/cert.pem' }))).rejects.toThrow(/both/i);
    await expect(loadTlsConfig(asEnv({ TLS_KEY_PATH: '/x/key.pem' }))).rejects.toThrow(/both/i);
  });

  it('throws when a referenced file is missing', async () => {
    const cert = join(dir, 'cert.pem');
    writeFileSync(cert, 'cert');
    await expect(
      loadTlsConfig(asEnv({ TLS_CERT_PATH: cert, TLS_KEY_PATH: join(dir, 'missing.pem') })),
    ).rejects.toThrow(/not found/i);
  });

  it('returns file handles when both files exist', async () => {
    const cert = join(dir, 'cert.pem');
    const key = join(dir, 'key.pem');
    writeFileSync(cert, 'cert-bytes');
    writeFileSync(key, 'key-bytes');
    const cfg = await loadTlsConfig(asEnv({ TLS_CERT_PATH: cert, TLS_KEY_PATH: key }));
    expect(cfg).toBeDefined();
    expect(await cfg!.cert.text()).toBe('cert-bytes');
    expect(await cfg!.key.text()).toBe('key-bytes');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
bun test src/tls/load-tls-config.spec.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the loader**

Create `src/tls/load-tls-config.ts`:

```ts
export interface TlsConfig {
  cert: ReturnType<typeof Bun.file>;
  key: ReturnType<typeof Bun.file>;
}

/**
 * Resolve direct-TLS configuration from `TLS_CERT_PATH` and `TLS_KEY_PATH`.
 *
 * - neither set: returns `undefined` (serve plain HTTP).
 * - both set with readable files: returns `BunFile` handles for `cert` and `key`.
 * - exactly one set: throws (caller logs and exits).
 * - a referenced file is missing: throws (caller logs and exits).
 *
 * Reverse-proxy or ingress TLS is preferred for most deployments; this is for
 * direct exposure, local testing, or containers that terminate TLS themselves.
 */
export async function loadTlsConfig(env: typeof Bun.env): Promise<TlsConfig | undefined> {
  const certPath = env.TLS_CERT_PATH;
  const keyPath = env.TLS_KEY_PATH;

  if (!certPath && !keyPath) return undefined;

  if (!certPath || !keyPath) {
    throw new Error('TLS misconfigured: set both TLS_CERT_PATH and TLS_KEY_PATH, or neither.');
  }

  const cert = Bun.file(certPath);
  const key = Bun.file(keyPath);

  if (!(await cert.exists())) {
    throw new Error(`TLS_CERT_PATH file not found: ${certPath}`);
  }
  if (!(await key.exists())) {
    throw new Error(`TLS_KEY_PATH file not found: ${keyPath}`);
  }

  return { cert, key };
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
bun test src/tls/load-tls-config.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Wire TLS into `src/main.ts`**

In `src/main.ts`, add to the handler imports (near `import { getHealth } from './health/get-health';`):

```ts
import { loadTlsConfig, type TlsConfig } from './tls/load-tls-config';
```

After the `ADMIN_TOKEN` guard block (the `if (!ADMIN_TOKEN) { ... process.exit(1); }`), add:

```ts
let tls: TlsConfig | undefined;
try {
  tls = await loadTlsConfig(Bun.env);
} catch (error) {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
```

Then change the `Bun.serve` opening from:

```ts
export const server = Bun.serve({
  port: PORT,
  hostname: HOSTNAME,
  routes: {
```

to:

```ts
export const server = Bun.serve({
  port: PORT,
  hostname: HOSTNAME,
  ...(tls ? { tls } : {}),
  routes: {
```

(Note: `src/main.ts` now uses top-level `await`. Bun supports this in module and entrypoint scope. The existing e2e tests already `await import('../src/main')`.)

- [ ] **Step 6: Write the HTTPS e2e test**

Create `e2e/tls.e2e.spec.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

mock.module('../src/logger', () => ({
  logger: { info() {}, log() {}, error: console.error },
}));

let dir: string;
let baseUrl: string;

describe('tls e2e', () => {
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'rc-tls-e2e-'));
    const keyPath = join(dir, 'key.pem');
    const certPath = join(dir, 'cert.pem');

    const gen = Bun.spawnSync([
      'openssl',
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      keyPath,
      '-out',
      certPath,
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
    ]);
    if (gen.exitCode !== 0) {
      throw new Error(`openssl failed: ${gen.stderr.toString()}`);
    }

    Bun.env.ADMIN_TOKEN = 'admin-token';
    Bun.env.CACHE_DIR = join(dir, 'cache');
    Bun.env.TOKENS_DB_PATH = join(dir, 'tokens.sqlite');
    Bun.env.PORT = '4020';
    Bun.env.TLS_CERT_PATH = certPath;
    Bun.env.TLS_KEY_PATH = keyPath;

    const { server } = await import('../src/main');
    baseUrl = server.url.origin;
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves /health over HTTPS without authentication', async () => {
    expect(baseUrl.startsWith('https://')).toBe(true);
    const res = await fetch(`${baseUrl}/health`, { tls: { rejectUnauthorized: false } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('OK');
  });
});
```

- [ ] **Step 7: Run the TLS e2e to verify it passes**

```bash
bun test e2e/tls.e2e.spec.ts
```

Expected: PASS — `server.url.origin` is `https://...` and `/health` returns `OK`. (Requires `openssl` on PATH; it ships on macOS and GitHub `ubuntu-latest` runners.)

- [ ] **Step 8: Commit**

```bash
git add src/tls/load-tls-config.ts src/tls/load-tls-config.spec.ts e2e/tls.e2e.spec.ts src/main.ts
git commit -m "feat(server): add direct TLS via TLS_CERT_PATH and TLS_KEY_PATH"
```

## Task A5: IRSA / ambient AWS credentials for S3

**Files:**

- Modify: `package.json` (+ generated `bun.lock`)
- Modify: `Dockerfile`
- Modify: `src/cache/create-cache-storage.ts`
- Create: `src/cache/create-cache-storage.spec.ts`
- Modify: `src/cache/storage-strategy/s3.ts`
- Create: `src/cache/storage-strategy/s3.spec.ts`

**Interfaces:**

- Produces (`create-cache-storage.ts`):
  - `resolveS3Config(env): S3Resolved` where
    `S3Resolved = { bucket: string; region?: string; endpoint?: string } & ({ mode: 'static'; credentials: { accessKeyId: string; secretAccessKey: string; sessionToken?: string } } | { mode: 'chain' })`.
    Throws if `S3_BUCKET` is unset. Static mode when both `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` are present; otherwise chain mode. `region` is `S3_REGION ?? AWS_REGION`.
  - `createCacheStorage(env): CacheStorageStrategy` — unchanged signature.
- Produces (`s3.ts`):
  - `shouldRefreshCredentials(expiration: number | null, now: number): boolean`.
  - `S3Strategy` accepting `{ bucket; region?; endpoint?; credentials: StaticCredentials | CredentialProvider }`.

- [ ] **Step 1: Add the dependency**

```bash
bun add @aws-sdk/credential-providers@3.1075.0
```

Expected: `package.json` gains a `dependencies` block with `@aws-sdk/credential-providers`, and `bun.lock` is created/updated. (Web-search confirmed `3.1075.0` is current at planning time; if `bun add` resolves a newer patch, accept it and note the version in the commit body.)

- [ ] **Step 2: Write the failing config-resolution test**

Create `src/cache/create-cache-storage.spec.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { resolveS3Config } from './create-cache-storage';

const asEnv = (o: Record<string, string>) => o as unknown as typeof Bun.env;

describe('resolveS3Config', () => {
  it('throws without a bucket', () => {
    expect(() => resolveS3Config(asEnv({}))).toThrow(/S3_BUCKET/);
  });

  it('uses static credentials when both keys are present', () => {
    const cfg = resolveS3Config(
      asEnv({ S3_BUCKET: 'b', S3_REGION: 'r', S3_ACCESS_KEY_ID: 'a', S3_SECRET_ACCESS_KEY: 's' }),
    );
    expect(cfg.mode).toBe('static');
    if (cfg.mode === 'static') {
      expect(cfg.credentials.accessKeyId).toBe('a');
      expect(cfg.credentials.secretAccessKey).toBe('s');
    }
  });

  it('passes a session token through in static mode', () => {
    const cfg = resolveS3Config(
      asEnv({
        S3_BUCKET: 'b',
        S3_ACCESS_KEY_ID: 'a',
        S3_SECRET_ACCESS_KEY: 's',
        S3_SESSION_TOKEN: 't',
      }),
    );
    expect(cfg.mode === 'static' && cfg.credentials.sessionToken).toBe('t');
  });

  it('falls back to the AWS provider chain when keys are absent', () => {
    const cfg = resolveS3Config(asEnv({ S3_BUCKET: 'b', S3_REGION: 'r' }));
    expect(cfg.mode).toBe('chain');
  });

  it('falls back to AWS_REGION when S3_REGION is unset', () => {
    const cfg = resolveS3Config(
      asEnv({
        S3_BUCKET: 'b',
        AWS_REGION: 'us-west-2',
        S3_ACCESS_KEY_ID: 'a',
        S3_SECRET_ACCESS_KEY: 's',
      }),
    );
    expect(cfg.region).toBe('us-west-2');
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

```bash
bun test src/cache/create-cache-storage.spec.ts
```

Expected: FAIL — `resolveS3Config` is not exported yet.

- [ ] **Step 4: Rewrite `create-cache-storage.ts`**

Replace the entire contents of `src/cache/create-cache-storage.ts` with:

```ts
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { CacheStorageStrategy } from './storage-strategy/storage-strategy.interface';
import { S3Strategy } from './storage-strategy/s3';
import { FileSystemStrategy } from './storage-strategy/file-system';

export type S3Resolved = {
  bucket: string;
  region?: string;
  endpoint?: string;
} & (
  | {
      mode: 'static';
      credentials: { accessKeyId: string; secretAccessKey: string; sessionToken?: string };
    }
  | { mode: 'chain' }
);

/**
 * Resolve S3 settings from the environment. Static credentials take precedence;
 * when access key and secret are both absent, fall back to the AWS provider
 * chain (env, web identity / IRSA, ECS task role, EC2 IMDS). `region` accepts
 * `S3_REGION` or the AWS-standard `AWS_REGION`.
 */
export function resolveS3Config(env: typeof Bun.env): S3Resolved {
  const bucket = env.S3_BUCKET;
  if (!bucket) {
    throw new Error('S3 storage requires S3_BUCKET.');
  }

  const region = env.S3_REGION ?? env.AWS_REGION;
  const endpoint = env.S3_ENDPOINT;
  const accessKeyId = env.S3_ACCESS_KEY_ID;
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY;

  if (accessKeyId && secretAccessKey) {
    return {
      bucket,
      region,
      endpoint,
      mode: 'static',
      credentials: { accessKeyId, secretAccessKey, sessionToken: env.S3_SESSION_TOKEN },
    };
  }

  return { bucket, region, endpoint, mode: 'chain' };
}

export function createCacheStorage(env: typeof Bun.env): CacheStorageStrategy {
  const kind = (env.STORAGE_STRATEGY ?? 'filesystem').toLowerCase();
  if (kind === 's3') {
    const cfg = resolveS3Config(env);
    const credentials = cfg.mode === 'static' ? cfg.credentials : fromNodeProviderChain();
    return new S3Strategy({
      bucket: cfg.bucket,
      region: cfg.region,
      endpoint: cfg.endpoint,
      credentials,
    });
  }

  const cacheDir = env.CACHE_DIR ?? './cache';
  return new FileSystemStrategy(cacheDir);
}
```

- [ ] **Step 5: Run the config test to verify it passes**

```bash
bun test src/cache/create-cache-storage.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Write the failing refresh-logic test**

Create `src/cache/storage-strategy/s3.spec.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { shouldRefreshCredentials } from './s3';

describe('shouldRefreshCredentials', () => {
  const now = 1_000_000_000_000;

  it('never refreshes when expiration is null (static credentials)', () => {
    expect(shouldRefreshCredentials(null, now)).toBe(false);
  });

  it('refreshes within five minutes of expiry', () => {
    expect(shouldRefreshCredentials(now + 4 * 60 * 1000, now)).toBe(true);
  });

  it('does not refresh comfortably before expiry', () => {
    expect(shouldRefreshCredentials(now + 30 * 60 * 1000, now)).toBe(false);
  });

  it('refreshes when already expired', () => {
    expect(shouldRefreshCredentials(now - 1000, now)).toBe(true);
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

```bash
bun test src/cache/storage-strategy/s3.spec.ts
```

Expected: FAIL — `shouldRefreshCredentials` is not exported yet.

- [ ] **Step 8: Rewrite `s3.ts` with the provider/refresh wrapper**

Replace the entire contents of `src/cache/storage-strategy/s3.ts` with:

```ts
import { S3Client, type S3Options } from 'bun';
import { CacheStorageStrategy } from './storage-strategy.interface';

type StaticCredentials = { accessKeyId: string; secretAccessKey: string; sessionToken?: string };
type ResolvedCredentials = StaticCredentials & { expiration?: Date };
type CredentialProvider = () => Promise<ResolvedCredentials>;

export interface S3StrategyOptions {
  bucket: string;
  region?: string;
  endpoint?: string;
  credentials: StaticCredentials | CredentialProvider;
}

const REFRESH_WINDOW_MS = 5 * 60 * 1000;

/** True when temporary credentials are missing or within the refresh window of expiry. */
export function shouldRefreshCredentials(expiration: number | null, now: number): boolean {
  if (expiration === null) return false;
  return now >= expiration - REFRESH_WINDOW_MS;
}

export class S3Strategy implements CacheStorageStrategy {
  readonly #bucket: string;
  readonly #region?: string;
  readonly #endpoint?: string;
  readonly #provider?: CredentialProvider;
  #client: Bun.S3Client | null = null;
  #expiration: number | null = null;

  constructor(options: S3StrategyOptions) {
    this.#bucket = options.bucket;
    this.#region = options.region;
    this.#endpoint = options.endpoint;
    if (typeof options.credentials === 'function') {
      this.#provider = options.credentials;
    } else {
      this.#client = this.#build(options.credentials);
    }
  }

  #build(creds: StaticCredentials): Bun.S3Client {
    const opts: S3Options = {
      bucket: this.#bucket,
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      ...(creds.sessionToken ? { sessionToken: creds.sessionToken } : {}),
      ...(this.#region ? { region: this.#region } : {}),
      ...(this.#endpoint ? { endpoint: this.#endpoint } : {}),
    };
    return new S3Client(opts);
  }

  async #getClient(): Promise<Bun.S3Client> {
    if (!this.#provider) return this.#client as Bun.S3Client;
    if (!this.#client || shouldRefreshCredentials(this.#expiration, Date.now())) {
      const creds = await this.#provider();
      this.#client = this.#build(creds);
      this.#expiration = creds.expiration ? creds.expiration.getTime() : null;
    }
    return this.#client;
  }

  async exists(hash: string): Promise<boolean> {
    return (await this.#getClient()).exists(hash);
  }

  async getStream(hash: string): Promise<ReadableStream> {
    return (await this.#getClient()).file(hash).stream();
  }

  async getSize(hash: string): Promise<number> {
    return (await this.#getClient()).size(hash);
  }

  async writeStream(hash: string, stream: ReadableStream<Uint8Array>): Promise<void> {
    const client = await this.#getClient();
    const file = client.file(hash);
    const writer = file.writer({ retry: 3, queueSize: 10, partSize: 5 * 1024 * 1024 });

    try {
      for await (const chunk of stream) {
        writer.write(chunk);
        await writer.flush();
      }
      await writer.end();
    } catch (error) {
      try {
        await writer.end();
      } catch {}
      throw error;
    }
  }
}
```

- [ ] **Step 9: Run the refresh test to verify it passes**

```bash
bun test src/cache/storage-strategy/s3.spec.ts
```

Expected: PASS.

- [ ] **Step 10: Make the Docker image install dependencies**

Replace the entire contents of `Dockerfile` with (keep the existing pinned base-image digest — do not change the `FROM` line's digest):

```dockerfile
FROM oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0

WORKDIR /app

ENV PORT=3000 \
    CACHE_DIR=/app/cache \
    TOKENS_DB_PATH=/app/data/nx-cache-server-tokens.sqlite \
    STORAGE_STRATEGY=filesystem

# Install runtime dependencies first so this layer caches independently of source.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY tsconfig.json ./
COPY src ./src

# Create the writable data/cache directories and hand ownership to the
# unprivileged `bun` user (uid 1000) that ships with the base image, so the
# server never runs as root.
RUN mkdir -p "$CACHE_DIR" "$(dirname "$TOKENS_DB_PATH")" \
    && chown -R bun:bun /app

USER bun

EXPOSE 3000
CMD ["bun", "/app/src/main.ts"]
```

- [ ] **Step 11: Verify the full suite and a Docker filesystem smoke**

```bash
bun test
docker build -t remotecache:irsa-check .
docker rm -f remotecache-irsa-check >/dev/null 2>&1 || true
docker run -d --name remotecache-irsa-check -e ADMIN_TOKEN=test-token -p 3000:3000 remotecache:irsa-check
for attempt in {1..30}; do
  if curl -fsS http://127.0.0.1:3000/health > /tmp/rc-health.txt; then cat /tmp/rc-health.txt; break; fi
  sleep 1
done
docker logs remotecache-irsa-check | tail -5
docker rm -f remotecache-irsa-check
```

Expected: all tests pass; the container prints `OK` (proves the new dependency installs and the image still starts in filesystem mode).

- [ ] **Step 12: Commit**

```bash
git add package.json bun.lock Dockerfile src/cache/create-cache-storage.ts src/cache/create-cache-storage.spec.ts src/cache/storage-strategy/s3.ts src/cache/storage-strategy/s3.spec.ts
git commit -m "feat(s3): resolve credentials via AWS provider chain for IRSA support"
```

---

# Part B — Helm chart

The chart renders against the Part A features: `/health` probes, the TLS secret mount (`TLS_CERT_PATH`/`TLS_KEY_PATH`), IRSA via ServiceAccount annotations (no static keys → provider chain), `BIND_ADDRESS`, and `MAX_UPLOAD_BYTES`.

## Task B1: Chart scaffold and values

**Files:**

- Create: `charts/remotecache/Chart.yaml`
- Create: `charts/remotecache/.helmignore`
- Create: `charts/remotecache/values.yaml`
- Create: `charts/remotecache/templates/_helpers.tpl`

- [ ] **Step 1: Create `charts/remotecache/Chart.yaml`**

```yaml
apiVersion: v2
name: remotecache
description: Self-hosted Nx remote cache server on the Bun runtime
type: application
# version (chart) and appVersion are wired to release-please in roadmap Phase 6.
version: 0.1.0
appVersion: '0.0.0'
home: https://remotecache.dev
sources:
  - https://github.com/thilak-rao/remotecache
keywords:
  - nx
  - remote-cache
  - cache
  - bun
maintainers:
  - name: Thilak Rao
```

- [ ] **Step 2: Create `charts/remotecache/.helmignore`**

```text
.git
.github
*.tgz
ci/
```

- [ ] **Step 3: Create `charts/remotecache/values.yaml`**

```yaml
# Default values for remotecache.

replicaCount: 1

image:
  repository: ghcr.io/thilak-rao/remotecache
  # tag defaults to the chart appVersion when empty.
  tag: ''
  pullPolicy: IfNotPresent

imagePullSecrets: []
nameOverride: ''
fullnameOverride: ''

# Admin token (required). Provide exactly one of:
#   adminToken: a literal value -> the chart creates a Secret
#   existingSecret (+ existingSecretKey) -> reference an existing Secret
adminToken: ''
existingSecret: ''
existingSecretKey: admin-token

config:
  port: 3000
  # bindAddress: "0.0.0.0" (default) or "::" for IPv6 / dual-stack pods.
  bindAddress: '0.0.0.0'
  maxUploadBytes: 524288000
  verbose: false

storage:
  # "filesystem" (default) or "s3".
  strategy: filesystem
  tokensDbPath: /app/data/nx-cache-server-tokens.sqlite
  filesystem:
    cacheDir: /app/cache

s3:
  bucket: ''
  region: ''
  endpoint: ''
  # Static credentials (optional). Leave empty to use the ServiceAccount's IAM
  # role (IRSA), an ECS task role, or an instance profile via the AWS chain.
  accessKeyId: ''
  secretAccessKey: ''
  sessionToken: ''
  # An existing Secret with keys: access-key-id, secret-access-key, [session-token].
  existingSecret: ''

# Direct TLS (optional). Prefer ingress / reverse-proxy TLS for most setups.
tls:
  enabled: false
  # A kubernetes.io/tls Secret providing tls.crt and tls.key.
  existingSecret: ''
  mountPath: /etc/remotecache/tls

persistence:
  data:
    enabled: true
    size: 1Gi
    storageClass: ''
    accessModes:
      - ReadWriteOnce
    existingClaim: ''
  cache:
    # Used only by the filesystem strategy.
    enabled: true
    size: 10Gi
    storageClass: ''
    accessModes:
      - ReadWriteOnce
    existingClaim: ''

serviceAccount:
  create: true
  name: ''
  # For IRSA, set: eks.amazonaws.com/role-arn: arn:aws:iam::<account>:role/<role>
  annotations: {}

service:
  type: ClusterIP
  port: 3000

livenessProbe:
  enabled: true
  initialDelaySeconds: 5
  periodSeconds: 10
readinessProbe:
  enabled: true
  initialDelaySeconds: 5
  periodSeconds: 10

# Escape hatches.
extraEnv: []
extraVolumes: []
extraVolumeMounts: []

resources: {}
podAnnotations: {}
podLabels: {}
podSecurityContext:
  runAsNonRoot: true
  runAsUser: 1000
  fsGroup: 1000
securityContext:
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: false
  capabilities:
    drop:
      - ALL
nodeSelector: {}
tolerations: []
affinity: {}
```

- [ ] **Step 4: Create `charts/remotecache/templates/_helpers.tpl`**

```yaml
{{- define "remotecache.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "remotecache.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "remotecache.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "remotecache.selectorLabels" -}}
app.kubernetes.io/name: {{ include "remotecache.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "remotecache.labels" -}}
helm.sh/chart: {{ include "remotecache.chart" . }}
{{ include "remotecache.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "remotecache.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "remotecache.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{- define "remotecache.adminSecretName" -}}
{{- if .Values.existingSecret }}{{ .Values.existingSecret }}{{ else }}{{ include "remotecache.fullname" . }}-admin{{ end }}
{{- end }}

{{- define "remotecache.adminSecretKey" -}}
{{- if .Values.existingSecret }}{{ .Values.existingSecretKey }}{{ else }}admin-token{{ end }}
{{- end }}

{{- define "remotecache.s3SecretName" -}}
{{- if .Values.s3.existingSecret }}{{ .Values.s3.existingSecret }}{{ else }}{{ include "remotecache.fullname" . }}-s3{{ end }}
{{- end }}
```

- [ ] **Step 5: Commit**

```bash
git add charts/remotecache/Chart.yaml charts/remotecache/.helmignore charts/remotecache/values.yaml charts/remotecache/templates/_helpers.tpl
git commit -m "feat(helm): scaffold chart with values and helpers"
```

## Task B2: Core templates (ServiceAccount, Secret, PVC, Service, Deployment, NOTES)

**Files:**

- Create: `charts/remotecache/templates/serviceaccount.yaml`
- Create: `charts/remotecache/templates/secret.yaml`
- Create: `charts/remotecache/templates/pvc.yaml`
- Create: `charts/remotecache/templates/service.yaml`
- Create: `charts/remotecache/templates/deployment.yaml`
- Create: `charts/remotecache/templates/NOTES.txt`

- [ ] **Step 1: `templates/serviceaccount.yaml`**

```yaml
{{- if .Values.serviceAccount.create }}
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ include "remotecache.serviceAccountName" . }}
  labels:
    {{- include "remotecache.labels" . | nindent 4 }}
  {{- with .Values.serviceAccount.annotations }}
  annotations:
    {{- toYaml . | nindent 4 }}
  {{- end }}
{{- end }}
```

- [ ] **Step 2: `templates/secret.yaml`**

```yaml
{{- if and (not .Values.existingSecret) .Values.adminToken }}
apiVersion: v1
kind: Secret
metadata:
  name: {{ include "remotecache.fullname" . }}-admin
  labels:
    {{- include "remotecache.labels" . | nindent 4 }}
type: Opaque
stringData:
  admin-token: {{ .Values.adminToken | quote }}
{{- end }}
{{- if and (eq .Values.storage.strategy "s3") (not .Values.s3.existingSecret) .Values.s3.accessKeyId }}
---
apiVersion: v1
kind: Secret
metadata:
  name: {{ include "remotecache.fullname" . }}-s3
  labels:
    {{- include "remotecache.labels" . | nindent 4 }}
type: Opaque
stringData:
  access-key-id: {{ .Values.s3.accessKeyId | quote }}
  secret-access-key: {{ .Values.s3.secretAccessKey | quote }}
  {{- if .Values.s3.sessionToken }}
  session-token: {{ .Values.s3.sessionToken | quote }}
  {{- end }}
{{- end }}
```

- [ ] **Step 3: `templates/pvc.yaml`**

```yaml
{{- if and .Values.persistence.data.enabled (not .Values.persistence.data.existingClaim) }}
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: {{ include "remotecache.fullname" . }}-data
  labels:
    {{- include "remotecache.labels" . | nindent 4 }}
spec:
  accessModes:
    {{- toYaml .Values.persistence.data.accessModes | nindent 4 }}
  resources:
    requests:
      storage: {{ .Values.persistence.data.size | quote }}
  {{- if .Values.persistence.data.storageClass }}
  storageClassName: {{ .Values.persistence.data.storageClass | quote }}
  {{- end }}
{{- end }}
{{- if and (eq .Values.storage.strategy "filesystem") .Values.persistence.cache.enabled (not .Values.persistence.cache.existingClaim) }}
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: {{ include "remotecache.fullname" . }}-cache
  labels:
    {{- include "remotecache.labels" . | nindent 4 }}
spec:
  accessModes:
    {{- toYaml .Values.persistence.cache.accessModes | nindent 4 }}
  resources:
    requests:
      storage: {{ .Values.persistence.cache.size | quote }}
  {{- if .Values.persistence.cache.storageClass }}
  storageClassName: {{ .Values.persistence.cache.storageClass | quote }}
  {{- end }}
{{- end }}
```

- [ ] **Step 4: `templates/service.yaml`**

```yaml
apiVersion: v1
kind: Service
metadata:
  name: { { include "remotecache.fullname" . } }
  labels: { { - include "remotecache.labels" . | nindent 4 } }
spec:
  type: { { .Values.service.type } }
  ports:
    - port: { { .Values.service.port } }
      targetPort: http
      protocol: TCP
      name: http
  selector: { { - include "remotecache.selectorLabels" . | nindent 4 } }
```

- [ ] **Step 5: `templates/deployment.yaml`**

```yaml
{{- if and (not .Values.adminToken) (not .Values.existingSecret) }}
{{- fail "remotecache: set either .Values.adminToken or .Values.existingSecret" }}
{{- end }}
{{- if and (eq .Values.storage.strategy "s3") (not .Values.s3.bucket) }}
{{- fail "remotecache: storage.strategy=s3 requires s3.bucket" }}
{{- end }}
{{- if and .Values.tls.enabled (not .Values.tls.existingSecret) }}
{{- fail "remotecache: tls.enabled requires tls.existingSecret (a kubernetes.io/tls Secret)" }}
{{- end }}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "remotecache.fullname" . }}
  labels:
    {{- include "remotecache.labels" . | nindent 4 }}
spec:
  replicas: {{ .Values.replicaCount }}
  selector:
    matchLabels:
      {{- include "remotecache.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      {{- with .Values.podAnnotations }}
      annotations:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      labels:
        {{- include "remotecache.selectorLabels" . | nindent 8 }}
        {{- with .Values.podLabels }}
        {{- toYaml . | nindent 8 }}
        {{- end }}
    spec:
      serviceAccountName: {{ include "remotecache.serviceAccountName" . }}
      {{- with .Values.imagePullSecrets }}
      imagePullSecrets:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      securityContext:
        {{- toYaml .Values.podSecurityContext | nindent 8 }}
      containers:
        - name: {{ .Chart.Name }}
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          securityContext:
            {{- toYaml .Values.securityContext | nindent 12 }}
          ports:
            - name: http
              containerPort: {{ .Values.config.port }}
              protocol: TCP
          env:
            - name: ADMIN_TOKEN
              valueFrom:
                secretKeyRef:
                  name: {{ include "remotecache.adminSecretName" . }}
                  key: {{ include "remotecache.adminSecretKey" . }}
            - name: PORT
              value: {{ .Values.config.port | quote }}
            - name: BIND_ADDRESS
              value: {{ .Values.config.bindAddress | quote }}
            - name: MAX_UPLOAD_BYTES
              value: {{ .Values.config.maxUploadBytes | quote }}
            - name: TOKENS_DB_PATH
              value: {{ .Values.storage.tokensDbPath | quote }}
            - name: STORAGE_STRATEGY
              value: {{ .Values.storage.strategy | quote }}
            {{- if .Values.config.verbose }}
            - name: VERBOSE
              value: "1"
            {{- end }}
            {{- if eq .Values.storage.strategy "filesystem" }}
            - name: CACHE_DIR
              value: {{ .Values.storage.filesystem.cacheDir | quote }}
            {{- end }}
            {{- if eq .Values.storage.strategy "s3" }}
            - name: S3_BUCKET
              value: {{ .Values.s3.bucket | quote }}
            {{- if .Values.s3.region }}
            - name: S3_REGION
              value: {{ .Values.s3.region | quote }}
            {{- end }}
            {{- if .Values.s3.endpoint }}
            - name: S3_ENDPOINT
              value: {{ .Values.s3.endpoint | quote }}
            {{- end }}
            {{- if or .Values.s3.existingSecret .Values.s3.accessKeyId }}
            - name: S3_ACCESS_KEY_ID
              valueFrom:
                secretKeyRef:
                  name: {{ include "remotecache.s3SecretName" . }}
                  key: access-key-id
            - name: S3_SECRET_ACCESS_KEY
              valueFrom:
                secretKeyRef:
                  name: {{ include "remotecache.s3SecretName" . }}
                  key: secret-access-key
            - name: S3_SESSION_TOKEN
              valueFrom:
                secretKeyRef:
                  name: {{ include "remotecache.s3SecretName" . }}
                  key: session-token
                  optional: true
            {{- end }}
            {{- end }}
            {{- if .Values.tls.enabled }}
            - name: TLS_CERT_PATH
              value: {{ printf "%s/tls.crt" .Values.tls.mountPath | quote }}
            - name: TLS_KEY_PATH
              value: {{ printf "%s/tls.key" .Values.tls.mountPath | quote }}
            {{- end }}
            {{- with .Values.extraEnv }}
            {{- toYaml . | nindent 12 }}
            {{- end }}
          {{- if .Values.livenessProbe.enabled }}
          livenessProbe:
            httpGet:
              path: /health
              port: http
              scheme: {{ if .Values.tls.enabled }}HTTPS{{ else }}HTTP{{ end }}
            initialDelaySeconds: {{ .Values.livenessProbe.initialDelaySeconds }}
            periodSeconds: {{ .Values.livenessProbe.periodSeconds }}
          {{- end }}
          {{- if .Values.readinessProbe.enabled }}
          readinessProbe:
            httpGet:
              path: /health
              port: http
              scheme: {{ if .Values.tls.enabled }}HTTPS{{ else }}HTTP{{ end }}
            initialDelaySeconds: {{ .Values.readinessProbe.initialDelaySeconds }}
            periodSeconds: {{ .Values.readinessProbe.periodSeconds }}
          {{- end }}
          resources:
            {{- toYaml .Values.resources | nindent 12 }}
          volumeMounts:
            - name: data
              mountPath: {{ dir .Values.storage.tokensDbPath }}
            {{- if eq .Values.storage.strategy "filesystem" }}
            - name: cache
              mountPath: {{ .Values.storage.filesystem.cacheDir }}
            {{- end }}
            {{- if .Values.tls.enabled }}
            - name: tls
              mountPath: {{ .Values.tls.mountPath }}
              readOnly: true
            {{- end }}
            {{- with .Values.extraVolumeMounts }}
            {{- toYaml . | nindent 12 }}
            {{- end }}
      volumes:
        - name: data
          {{- if .Values.persistence.data.enabled }}
          persistentVolumeClaim:
            claimName: {{ .Values.persistence.data.existingClaim | default (printf "%s-data" (include "remotecache.fullname" .)) }}
          {{- else }}
          emptyDir: {}
          {{- end }}
        {{- if eq .Values.storage.strategy "filesystem" }}
        - name: cache
          {{- if .Values.persistence.cache.enabled }}
          persistentVolumeClaim:
            claimName: {{ .Values.persistence.cache.existingClaim | default (printf "%s-cache" (include "remotecache.fullname" .)) }}
          {{- else }}
          emptyDir: {}
          {{- end }}
        {{- end }}
        {{- if .Values.tls.enabled }}
        - name: tls
          secret:
            secretName: {{ .Values.tls.existingSecret }}
        {{- end }}
        {{- with .Values.extraVolumes }}
        {{- toYaml . | nindent 8 }}
        {{- end }}
      {{- with .Values.nodeSelector }}
      nodeSelector:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.affinity }}
      affinity:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.tolerations }}
      tolerations:
        {{- toYaml . | nindent 8 }}
      {{- end }}
```

- [ ] **Step 6: `templates/NOTES.txt`**

```text
remotecache is deploying.

Service: {{ include "remotecache.fullname" . }} ({{ .Values.service.type }}) on port {{ .Values.service.port }}.
Storage: {{ .Values.storage.strategy }}{{ if eq .Values.storage.strategy "s3" }} (bucket {{ .Values.s3.bucket }}){{ end }}.
TLS: {{ if .Values.tls.enabled }}enabled (secret {{ .Values.tls.existingSecret }}){{ else }}disabled — terminate TLS at your ingress or proxy{{ end }}.

Check health (unauthenticated):

  kubectl --namespace {{ .Release.Namespace }} port-forward svc/{{ include "remotecache.fullname" . }} {{ .Values.service.port }}:{{ .Values.service.port }}
  curl -fsS http{{ if .Values.tls.enabled }}s{{ end }}://127.0.0.1:{{ .Values.service.port }}/health

Then create a token with your ADMIN_TOKEN against POST /v1/admin/tokens.
```

- [ ] **Step 7: Render locally to verify the templates are valid**

```bash
helm lint charts/remotecache --set adminToken=local-test
helm template rc charts/remotecache --set adminToken=local-test
```

Expected: lint reports `0 chart(s) failed`; template prints a Deployment, Service, ServiceAccount, two PVCs (data + cache), and the admin Secret, with `livenessProbe`/`readinessProbe` hitting `/health` and `BIND_ADDRESS`/`MAX_UPLOAD_BYTES` env present.

- [ ] **Step 8: Commit**

```bash
git add charts/remotecache/templates/serviceaccount.yaml charts/remotecache/templates/secret.yaml charts/remotecache/templates/pvc.yaml charts/remotecache/templates/service.yaml charts/remotecache/templates/deployment.yaml charts/remotecache/templates/NOTES.txt
git commit -m "feat(helm): add core templates for deployment, service, secret, pvc, sa"
```

## Task B3: CI value sets

**Files:**

- Create: `charts/remotecache/ci/filesystem-values.yaml`
- Create: `charts/remotecache/ci/s3-values.yaml`
- Create: `charts/remotecache/ci/tls-values.yaml`

- [ ] **Step 1: `ci/filesystem-values.yaml`**

```yaml
adminToken: ci-admin-token
storage:
  strategy: filesystem
```

- [ ] **Step 2: `ci/s3-values.yaml`** (IRSA path — no static keys, relies on the provider chain)

```yaml
adminToken: ci-admin-token
storage:
  strategy: s3
s3:
  bucket: ci-bucket
  region: us-east-1
serviceAccount:
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789012:role/remotecache
```

- [ ] **Step 3: `ci/tls-values.yaml`**

```yaml
adminToken: ci-admin-token
tls:
  enabled: true
  existingSecret: remotecache-tls
```

- [ ] **Step 4: Render all three to verify they pass**

```bash
helm template rc charts/remotecache -f charts/remotecache/ci/filesystem-values.yaml
helm template rc charts/remotecache -f charts/remotecache/ci/s3-values.yaml
helm template rc charts/remotecache -f charts/remotecache/ci/tls-values.yaml
```

Expected (per file):

- filesystem: data + cache PVCs, `CACHE_DIR` env, no S3 env, probes scheme `HTTP`.
- s3: no cache PVC, `S3_BUCKET`/`S3_REGION` env, ServiceAccount carries the `eks.amazonaws.com/role-arn` annotation, no S3 secretKeyRef env (IRSA).
- tls: a `tls` volume from `remotecache-tls`, `TLS_CERT_PATH`/`TLS_KEY_PATH` env, probes scheme `HTTPS`.

- [ ] **Step 5: Commit**

```bash
git add charts/remotecache/ci/filesystem-values.yaml charts/remotecache/ci/s3-values.yaml charts/remotecache/ci/tls-values.yaml
git commit -m "test(helm): add CI value sets for filesystem, s3, and tls"
```

---

# Part C — CI

## Task C1: Add a Helm lint/template job

**Files:**

- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Resolve and pin the `azure/setup-helm` commit SHA**

This repo pins every Action by commit SHA. Resolve the latest release and its SHA:

```bash
gh api repos/azure/setup-helm/releases/latest --jq '.tag_name'
gh api repos/azure/setup-helm/git/refs/tags/$(gh api repos/azure/setup-helm/releases/latest --jq '.tag_name') --jq '.object.sha'
```

Note the tag (e.g. `v4.3.0`) and the commit SHA. If the ref object is a tag (not a commit), dereference it:

```bash
gh api repos/azure/setup-helm/git/tags/<sha-from-above> --jq '.object.sha'
```

Use the resolved commit SHA in Step 2 in place of `<SETUP_HELM_SHA>` and the tag in place of `<SETUP_HELM_TAG>`.

- [ ] **Step 2: Add the `helm` job**

In `.github/workflows/ci.yml`, after the `docker-smoke` job and before the `security` job, add:

```yaml
helm:
  runs-on: ubuntu-latest
  steps:
    - name: Checkout
      uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0

    - name: Set up Helm
      uses: azure/setup-helm@<SETUP_HELM_SHA> # <SETUP_HELM_TAG>
      with:
        version: v3.16.3

    - name: Helm lint
      run: helm lint charts/remotecache --set adminToken=ci-admin-token

    - name: Helm template (filesystem)
      run: helm template rc charts/remotecache -f charts/remotecache/ci/filesystem-values.yaml

    - name: Helm template (s3)
      run: helm template rc charts/remotecache -f charts/remotecache/ci/s3-values.yaml

    - name: Helm template (tls)
      run: helm template rc charts/remotecache -f charts/remotecache/ci/tls-values.yaml
```

- [ ] **Step 3: Verify the workflow file is well-formed**

```bash
helm lint charts/remotecache --set adminToken=ci-admin-token
rg -n 'helm lint|helm template|azure/setup-helm' .github/workflows/ci.yml
```

Expected: lint passes locally; the grep shows the new job's steps and a pinned `azure/setup-helm@<sha>`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: lint and template the helm chart on every PR"
```

---

# Part D — Docs

## Task D1: Configuration and deployment docs

**Files:**

- Modify: `docs-site/src/content/docs/guides/configuration.md`
- Modify: `docs-site/src/content/docs/guides/deployment.md`

- [ ] **Step 1: Add the new variables to the configuration table**

In `docs-site/src/content/docs/guides/configuration.md`, in the environment-variable table, change the four S3 credential rows and add the new ones. Replace these rows:

```markdown
| `S3_ACCESS_KEY_ID` | for s3 | — | S3 access key. |
| `S3_SECRET_ACCESS_KEY` | for s3 | — | S3 secret key. |
| `S3_ENDPOINT` | no | — | Custom endpoint for MinIO / other S3-compatible providers. |
| `VERBOSE` | no | — | Set `1` to print `logger.info`/`logger.log` output; errors always print. |
```

with:

```markdown
| `S3_ACCESS_KEY_ID` | no | — | S3 access key. Omit (with the secret) to use the AWS credential chain. |
| `S3_SECRET_ACCESS_KEY` | no | — | S3 secret key. Omit (with the key id) to use the AWS credential chain. |
| `S3_SESSION_TOKEN` | no | — | Session token for temporary S3 credentials (STS / assumed roles). |
| `S3_ENDPOINT` | no | — | Custom endpoint for MinIO / other S3-compatible providers. |
| `BIND_ADDRESS` | no | `0.0.0.0` | Listen interface. Use `::` for IPv6 / dual-stack. |
| `TLS_CERT_PATH` | no | — | PEM certificate path. Set with `TLS_KEY_PATH` to serve HTTPS directly. |
| `TLS_KEY_PATH` | no | — | PEM private-key path. Set with `TLS_CERT_PATH` to serve HTTPS directly. |
| `VERBOSE` | no | — | Set `1` to print `logger.info`/`logger.log` output; errors always print. |
```

- [ ] **Step 2: Update the S3 and notes prose**

In the same file, replace the S3 paragraph:

```markdown
For S3, set `STORAGE_STRATEGY=s3` along with `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY`. MinIO and other compatible providers also need `S3_ENDPOINT`. If you are moving from `@nx/s3-cache` (or another deprecated `@nx/*-cache` plugin), see [Migrate from @nx/s3-cache](/guides/migrate-from-nx-s3-cache/).
```

with:

```markdown
For S3, set `STORAGE_STRATEGY=s3` and `S3_BUCKET`. Provide credentials one of two ways:

- **Static keys:** set `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` (and `S3_SESSION_TOKEN` for temporary credentials).
- **Ambient roles:** omit the keys. The server then resolves credentials through the AWS provider chain — environment, EKS IRSA web identity, ECS task role, or EC2 instance profile — and refreshes temporary credentials before they expire.

`S3_REGION` (or the AWS-standard `AWS_REGION`) sets the region. MinIO and other compatible providers also need `S3_ENDPOINT`. If you are moving from `@nx/s3-cache` (or another deprecated `@nx/*-cache` plugin), see [Migrate from @nx/s3-cache](/guides/migrate-from-nx-s3-cache/).
```

Then, after the `MAX_UPLOAD_BYTES` note near the end, add:

```markdown
`BIND_ADDRESS` controls which interface the server listens on (`0.0.0.0` by default; `::` for IPv6). The server drains in-flight requests on `SIGTERM`/`SIGINT`, so Kubernetes rolling updates and `docker stop` finish active uploads before exiting.

Set `TLS_CERT_PATH` and `TLS_KEY_PATH` together to serve HTTPS directly; the server exits on startup if only one is set or a file is missing. For most deployments, terminate TLS at an ingress or reverse proxy instead. See [Deployment](/guides/deployment/) for the direct-TLS and Helm details.
```

- [ ] **Step 3: Add Kubernetes (Helm) and direct-TLS sections to the deployment guide**

In `docs-site/src/content/docs/guides/deployment.md`, after the `## Health checks` section and before `## Monitoring`, add:

````markdown
## Kubernetes (Helm)

A Helm chart lives in `charts/remotecache/`. Install it from a checkout of the repository:

```sh
helm install remotecache ./charts/remotecache \
  --set adminToken="change-me"
```

Reference an existing Secret instead of a literal token:

```sh
helm install remotecache ./charts/remotecache \
  --set existingSecret=remotecache-admin \
  --set existingSecretKey=admin-token
```

The chart defaults to filesystem storage with PersistentVolumeClaims for the token database and cache. Probes call the unauthenticated `/health` endpoint.

For S3 with EKS IRSA — no static keys, credentials resolved from the pod's IAM role:

```sh
helm install remotecache ./charts/remotecache \
  --set adminToken="change-me" \
  --set storage.strategy=s3 \
  --set s3.bucket=my-cache-bucket \
  --set s3.region=us-east-1 \
  --set serviceAccount.annotations."eks\.amazonaws\.com/role-arn"=arn:aws:iam::123456789012:role/remotecache
```

Key values: `image.repository`/`image.tag`, `adminToken`/`existingSecret`, `storage.strategy`, `s3.*`, `tls.*`, `persistence.*`, `serviceAccount.annotations`, `config.maxUploadBytes`, `config.bindAddress`, `resources`, and the `extraEnv`/`extraVolumes`/`extraVolumeMounts` escape hatches. See `charts/remotecache/values.yaml` for the full list.

## Direct TLS

The server can terminate TLS itself. Mount a certificate and key, then point the server at them with `TLS_CERT_PATH` and `TLS_KEY_PATH`:

```sh
docker run -p 3000:3000 \
  -e ADMIN_TOKEN="change-me" \
  -e TLS_CERT_PATH=/certs/tls.crt \
  -e TLS_KEY_PATH=/certs/tls.key \
  -v "$PWD/certs:/certs:ro" \
  ghcr.io/thilak-rao/remotecache:latest
```

Set both variables or neither — the server exits on startup if only one is set, or if a file is missing. In the Helm chart, set `tls.enabled=true` and `tls.existingSecret` to a `kubernetes.io/tls` Secret; the chart mounts it and switches the probes to HTTPS. For most deployments, terminating TLS at an ingress or reverse proxy is simpler.
````

- [ ] **Step 4: Human-facing docs pass**

Read the changed configuration and deployment prose. Keep wording direct; remove filler, hype, and chatbot phrasing (apply the humanizer guidance).

- [ ] **Step 5: Build the docs site to verify**

```bash
cd docs-site && bun run build && cd ..
```

Expected: build exits `0` and internal links validate.

- [ ] **Step 6: Commit**

```bash
git add docs-site/src/content/docs/guides/configuration.md docs-site/src/content/docs/guides/deployment.md
git commit -m "docs: document TLS, BIND_ADDRESS, ambient S3 credentials, and the Helm chart"
```

## Task D2: Contributor, release, agent, and README updates

**Files:**

- Modify: `CONTRIBUTING.md`
- Modify: `.github/pull_request_template.md`
- Modify: `docs-site/src/content/docs/contributing/releases.md`
- Modify: `AGENTS.md`
- Modify: `README.md`

- [ ] **Step 1: `CONTRIBUTING.md` — dependency exception, Helm checks, smoke fix**

In `CONTRIBUTING.md`, replace the Bun-built-ins bullet:

```markdown
- Bun built-ins only — no Node-only equivalents or extra deps for what Bun provides.
```

with:

```markdown
- Bun built-ins only — no Node-only equivalents or extra deps for what Bun provides. The one approved exception is `@aws-sdk/credential-providers`, used to resolve EKS IRSA / ECS / IMDS credentials that `Bun.S3Client` cannot resolve natively.
```

In the Docker smoke block, replace:

```markdown
curl -fsS http://127.0.0.1:3000/metrics
```

with:

```markdown
curl -fsS http://127.0.0.1:3000/health
```

After the Docker smoke block, add:

````markdown
Chart changes should pass lint and template rendering:

```sh
helm lint charts/remotecache --set adminToken=ci-admin-token
helm template rc charts/remotecache -f charts/remotecache/ci/filesystem-values.yaml
helm template rc charts/remotecache -f charts/remotecache/ci/s3-values.yaml
helm template rc charts/remotecache -f charts/remotecache/ci/tls-values.yaml
```
````

In the Pull requests section, replace:

```markdown
CI must pass: format, lint, tests, audits, docs build, Docker smoke, Trivy filesystem scan, and CodeQL. Keep PRs focused.
```

with:

```markdown
CI must pass: format, lint, tests, audits, docs build, Docker smoke, Helm lint/template, Trivy filesystem scan, and CodeQL. Keep PRs focused.
```

- [ ] **Step 2: `.github/pull_request_template.md` — add a Helm checklist item**

Replace:

```markdown
- [ ] Docker smoke check considered when Dockerfile, runtime env, or server startup changed
```

with:

```markdown
- [ ] Docker smoke check considered when Dockerfile, runtime env, or server startup changed
- [ ] `helm lint` and `helm template` (filesystem, s3, tls) pass when `charts/` changed
```

- [ ] **Step 3: `docs-site/.../contributing/releases.md` — note Helm validation**

In `docs-site/src/content/docs/contributing/releases.md`, add a sentence to the CI description noting that PR CI now lints and templates the Helm chart, and that chart OCI publishing is a later roadmap phase (not yet wired). Place it where the CI gates are described. Suggested text:

```markdown
PR CI also runs `helm lint` and `helm template` against the chart in `charts/remotecache/` (filesystem, S3, and TLS value sets). Publishing the chart as an OCI artifact to GHCR is a separate, later step and is not wired yet.
```

- [ ] **Step 4: `AGENTS.md` — record the chart, new env vars, and the dependency exception**

In `AGENTS.md`, update the runtime/dependency guidance and the project summary so future agents know:

- `charts/remotecache/` holds the Helm chart; CI lints and templates it.
- New server env vars exist: `BIND_ADDRESS`, `TLS_CERT_PATH`, `TLS_KEY_PATH`, `S3_SESSION_TOKEN`; S3 keys are optional (AWS provider chain / IRSA).
- The server drains on `SIGTERM`/`SIGINT`.
- `@aws-sdk/credential-providers` is the single approved runtime dependency exception; the Dockerfile now runs `bun install --frozen-lockfile --production`.

Make these edits in the matching existing sentences/sections (do not duplicate the project summary). Keep each addition to a single clause or bullet.

- [ ] **Step 5: `README.md` — TLS and Helm pointers**

In `README.md`, under `## Features`, after the storage-strategies bullet group, add:

```markdown
- Direct TLS (`TLS_CERT_PATH` + `TLS_KEY_PATH`) or terminate TLS at your proxy/ingress
- Helm chart for Kubernetes (`charts/remotecache/`)
```

In the `## Docker` section, after the existing health-check sentence, add:

```markdown
For Kubernetes, install the Helm chart in `charts/remotecache/`. See the [Deployment guide](https://remotecache.dev/guides/deployment/).
```

- [ ] **Step 6: Human-facing docs pass + docs build**

Read the changed README and release prose for tone (humanizer guidance), then:

```bash
cd docs-site && bun run build && cd ..
```

Expected: build exits `0`.

- [ ] **Step 7: Commit**

```bash
git add CONTRIBUTING.md .github/pull_request_template.md docs-site/src/content/docs/contributing/releases.md AGENTS.md README.md
git commit -m "docs: document helm chart, TLS, and the credential-providers exception"
```

---

# Task V: Full verification

**Files:** validate everything above.

- [ ] **Step 1: Root checks**

```bash
bun install --frozen-lockfile
bun run format --check
bun run lint
bun audit
bun test
```

Expected: install makes no lockfile changes; format/lint exit `0`; `bun audit` prints no vulnerabilities (if the new dependency introduces an advisory, stop and surface it — do not silently ignore); all tests pass.

- [ ] **Step 2: Docs checks**

```bash
cd docs-site
bun install --frozen-lockfile
bun audit
bun run build
cd ..
```

Expected: all exit `0`; internal links validate.

- [ ] **Step 3: Helm checks**

```bash
helm lint charts/remotecache --set adminToken=ci-admin-token
helm template rc charts/remotecache -f charts/remotecache/ci/filesystem-values.yaml
helm template rc charts/remotecache -f charts/remotecache/ci/s3-values.yaml
helm template rc charts/remotecache -f charts/remotecache/ci/tls-values.yaml
```

Expected: lint passes; all three render without error.

- [ ] **Step 4: Negative-path chart checks (fail-loud guards)**

```bash
helm template rc charts/remotecache 2>&1 | rg -q 'adminToken or .Values.existingSecret' && echo "admin guard OK"
helm template rc charts/remotecache --set adminToken=x --set storage.strategy=s3 2>&1 | rg -q 'requires s3.bucket' && echo "s3 guard OK"
helm template rc charts/remotecache --set adminToken=x --set tls.enabled=true 2>&1 | rg -q 'requires tls.existingSecret' && echo "tls guard OK"
```

Expected: each prints its `... OK` line (the `fail` guards fire).

- [ ] **Step 5: Docker filesystem smoke (dependency installs + image starts)**

```bash
docker build -t remotecache:verify .
docker rm -f remotecache-verify >/dev/null 2>&1 || true
docker run -d --name remotecache-verify -e ADMIN_TOKEN=test-token -p 3000:3000 remotecache:verify
for attempt in {1..30}; do
  if curl -fsS http://127.0.0.1:3000/health; then break; fi
  sleep 1
done
docker rm -f remotecache-verify
```

Expected: prints `OK`.

- [ ] **Step 6: Final format + commit if needed**

```bash
bun run format
git add -A
git status --short
```

If formatting changed tracked files, commit:

```bash
git commit -m "chore: format helm and tls changes"
```

---

## Plan self-review

- **Spec coverage:** Phase 3 Helm (chart with image/token/persistence/S3/TLS/SA-annotations/probes/extra-env/resources, plus `helm lint`/`helm template` filesystem+S3+TLS) — Tasks B1–B3, C1. Phase 4 Optional Direct TLS (neither/both/one, file-read failure, HTTPS round-trip, `/health` over HTTPS) — Task A4. Borrowed features the user folded in (IRSA/ambient creds, `BIND_ADDRESS`+IPv6, graceful SIGTERM, hash hardening) — Tasks A5, A2, A3, A1.
- **Out-of-scope held:** Helm OCI publishing (Phase 6), binary distribution, S3 robustness/MinIO, CI/CD DRY, docs polish, and the final docs-site revision are excluded and recorded in the spec as later phases.
- **Honesty checks:** TLS chart values are functional because Task A4 lands real server TLS first. IRSA is real because Task A5 uses `fromNodeProviderChain`; the chart never advertises an option the server cannot honor.
- **Dependency ripple:** the `@aws-sdk/credential-providers` addition forces the Dockerfile install (Task A5 Step 10) — captured, not left implicit.
- **Placeholder scan:** the only intentional placeholders are `<SETUP_HELM_SHA>`/`<SETUP_HELM_TAG>` in Task C1, with exact `gh` commands to resolve them (action SHAs cannot be pinned offline).
- **Type consistency:** `resolveS3Config`/`S3Resolved`, `S3StrategyOptions`, `shouldRefreshCredentials`, `loadTlsConfig`/`TlsConfig`, and the chart helper names (`remotecache.fullname`, `remotecache.adminSecretName`, `remotecache.s3SecretName`) are used consistently across tasks.

## Execution handoff

Recommended order: Part A (server, can be its own PR) → Part B (chart) → Part C (CI) → Part D (docs) → Task V. Within Part A, A1→A5 are independent except A5's Dockerfile change, which assumes A1–A4 are present only for the final smoke.

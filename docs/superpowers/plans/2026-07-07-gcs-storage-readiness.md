# GCS Storage and Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google Cloud Storage as a cache backend and add a deep unauthenticated `GET /ready` probe.

**Architecture:** Keep the existing thin-handler and `CacheStorageStrategy` shape. Add a small GCS strategy behind the current storage factory, then add `checkReady()` to the storage and token-store boundaries so `/ready` can verify SQLite plus the configured cache backend without exposing details in the response.

**Tech Stack:** Bun 1.3.14, `bun:test`, TypeScript, `@google-cloud/storage@7.21.0`, Helm, Astro/Starlight docs.

---

## Sources checked before planning

- `ctx7` check in this worktree: `command -v ctx7` returned no path, so the fallback path from `AGENTS.md` applies.
- Latest package version by web search: `@google-cloud/storage` latest is `7.21.0`.
- Official API docs checked:
  - <https://googleapis.dev/nodejs/storage/latest/module-%40google-cloud_storage.html>
  - <https://googleapis.dev/nodejs/storage/latest/File.html>
  - <https://docs.cloud.google.com/storage/docs/request-preconditions>
- Official client source checked from `googleapis/nodejs-storage`:
  - `src/file.ts` exposes `CreateWriteStreamOptions.preconditionOpts`.
  - `test/file.ts` asserts `createWriteStream({ preconditionOpts: { ifGenerationMatch } })` passes the precondition through.
  - `src/transfer-manager.ts` uses `ifGenerationMatch: 0` for "skip if exists" uploads.

## File structure

- `package.json`, `bun.lock`: add the GCS SDK runtime dependency.
- `src/cache/create-cache-storage.ts`: parse `STORAGE_STRATEGY=gcs` and build `GcsStrategy`.
- `src/cache/create-cache-storage.spec.ts`: config resolver tests and factory tests.
- `src/cache/storage-strategy/storage-strategy.interface.ts`: add `checkReady()`.
- `src/cache/storage-strategy/file-system.ts`: export the filesystem readiness probe and implement `checkReady()`.
- `src/cache/storage-strategy/s3.ts`: implement `checkReady()`.
- `src/cache/storage-strategy/gcs.ts`: new GCS strategy.
- `src/cache/storage-strategy/gcs.spec.ts`: mocked-client unit tests for GCS behavior.
- `src/token/token-storage.ts`, `src/token/token-storage.spec.ts`: add SQLite readiness check.
- `src/responses.ts`: add a `503` response factory.
- `src/ready/get-ready.ts`, `src/ready/get-ready.spec.ts`: new pure readiness handler.
- `src/main.ts`: add `GET /ready`.
- `e2e/ready.e2e.spec.ts`: filesystem readiness e2e on port `4018`.
- `e2e/startup-validation.e2e.spec.ts`: bad GCS config startup failures.
- `nx-cache-server.openapi.json`: document `GET /ready`.
- `docs-site/src/content/docs/guides/configuration.md`: GCS and `/ready` docs.
- `docs-site/src/content/docs/guides/storage-strategies.md`: GCS strategy docs.
- `docs-site/src/content/docs/deploy/kubernetes.md`: Workload Identity and readiness probe docs.
- `README.md`: feature list update after implementation.
- `docs/superpowers/plans/2026-07-05-remotecache-roadmap.md`: mark GCS and `/ready` shipped, leave Azure pending.
- Helm chart files:
  - `charts/remotecache/values.yaml`
  - `charts/remotecache/templates/deployment.yaml`
  - `charts/remotecache/ci/gcs-values.yaml`

## Constraints

- Runtime stays Bun, not Node server APIs.
- Use `bun add @google-cloud/storage@7.21.0`, not npm or pnpm.
- No direct `console`; use `logger`.
- No `any`.
- Every HTTP response comes from `src/responses.ts`.
- `@aws-sdk/credential-providers` and `@google-cloud/storage` are the only runtime dependencies after this plan.
- Do not add live GCS CI without a safe temporary-bucket credential story. This plan uses strict mocked-client tests plus documented local smoke commands.
- Every commit uses Conventional Commits.

---

### Task 1: Add the GCS dependency and config resolver

**Files:**

- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `src/cache/create-cache-storage.ts`
- Modify: `src/cache/create-cache-storage.spec.ts`

- [ ] **Step 1: Confirm the package version**

Run:

```sh
command -v ctx7 || true
```

Expected in this environment: no output. If another worker has `ctx7`, run:

```sh
ctx7 library "@google-cloud/storage" "How do I stream upload to Google Cloud Storage with ifGenerationMatch 0 using the Node.js client?"
ctx7 docs /googleapis/nodejs-storage "How do I stream upload to Google Cloud Storage with ifGenerationMatch 0 using the Node.js client?"
```

Then confirm the latest package version by web search before install. The version checked while writing this plan is `7.21.0`.

- [ ] **Step 2: Install the dependency**

Run:

```sh
bun add @google-cloud/storage@7.21.0
```

Expected: `package.json` gains `@google-cloud/storage` in `dependencies`, and `bun.lock` changes.

- [ ] **Step 3: Write failing config tests**

In `src/cache/create-cache-storage.spec.ts`, change the import to include `resolveGcsConfig`:

```ts
import { createCacheStorage, resolveGcsConfig, resolveS3Config } from './create-cache-storage';
```

Change the unknown-strategy test to use a still-unknown value:

```ts
it('throws on an unknown STORAGE_STRATEGY', () => {
  expect(() => createCacheStorage(asEnv({ STORAGE_STRATEGY: 'azure' }))).toThrow(
    /Unknown STORAGE_STRATEGY "azure"/,
  );
});
```

Add this block above `describe('createCacheStorage', ...)`:

```ts
describe('resolveGcsConfig', () => {
  it('throws without a bucket', () => {
    expect(() => resolveGcsConfig(asEnv({}))).toThrow(/GCS_BUCKET/);
  });

  it('uses ambient credentials with only a bucket', () => {
    expect(resolveGcsConfig(asEnv({ GCS_BUCKET: 'b' }))).toEqual({
      bucket: 'b',
      mode: 'ambient',
    });
  });

  it('passes project id through when set', () => {
    expect(resolveGcsConfig(asEnv({ GCS_BUCKET: 'b', GCS_PROJECT_ID: 'p' }))).toEqual({
      bucket: 'b',
      projectId: 'p',
      mode: 'ambient',
    });
  });

  it('uses a key file when GCS_KEY_FILENAME is set', () => {
    expect(resolveGcsConfig(asEnv({ GCS_BUCKET: 'b', GCS_KEY_FILENAME: '/var/gcp.json' }))).toEqual(
      {
        bucket: 'b',
        keyFilename: '/var/gcp.json',
        mode: 'keyFilename',
      },
    );
  });

  it('parses GCS_CREDENTIALS JSON', () => {
    const cfg = resolveGcsConfig(
      asEnv({
        GCS_BUCKET: 'b',
        GCS_CREDENTIALS: JSON.stringify({
          client_email: 'svc@example.iam.gserviceaccount.com',
          private_key: 'private-key',
        }),
      }),
    );

    expect(cfg.mode).toBe('credentials');
    if (cfg.mode === 'credentials') {
      expect(cfg.credentials.client_email).toBe('svc@example.iam.gserviceaccount.com');
      expect(cfg.credentials.private_key).toBe('private-key');
    }
  });

  it('throws when explicit credential sources conflict', () => {
    expect(() =>
      resolveGcsConfig(
        asEnv({
          GCS_BUCKET: 'b',
          GCS_KEY_FILENAME: '/var/gcp.json',
          GCS_CREDENTIALS: '{}',
        }),
      ),
    ).toThrow(/GCS_KEY_FILENAME.*GCS_CREDENTIALS/);
  });

  it('throws when GCS_CREDENTIALS is not JSON object text', () => {
    expect(() => resolveGcsConfig(asEnv({ GCS_BUCKET: 'b', GCS_CREDENTIALS: 'not-json' }))).toThrow(
      /GCS_CREDENTIALS/,
    );
  });
});
```

- [ ] **Step 4: Run the failing tests**

Run:

```sh
bun test src/cache/create-cache-storage.spec.ts
```

Expected: fails because `resolveGcsConfig` does not exist yet.

- [ ] **Step 5: Implement the resolver**

In `src/cache/create-cache-storage.ts`, add the type import:

```ts
import type { StorageOptions } from '@google-cloud/storage';
```

Add this type below `S3Resolved`:

```ts
export type GcsResolved = {
  bucket: string;
  projectId?: string;
} & (
  | { mode: 'ambient' }
  | { mode: 'keyFilename'; keyFilename: string }
  | { mode: 'credentials'; credentials: NonNullable<StorageOptions['credentials']> }
);
```

Add these helpers below `resolveS3Config`:

```ts
function parseGcsCredentials(raw: string): NonNullable<StorageOptions['credentials']> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('GCS_CREDENTIALS must be valid service account JSON.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('GCS_CREDENTIALS must be a JSON object.');
  }

  return parsed as NonNullable<StorageOptions['credentials']>;
}

/**
 * Resolve Google Cloud Storage settings from the environment.
 *
 * @throws if `GCS_BUCKET` is missing, if explicit credential sources conflict,
 * or if `GCS_CREDENTIALS` is not service-account JSON object text.
 */
export function resolveGcsConfig(env: typeof Bun.env): GcsResolved {
  const bucket = env.GCS_BUCKET;
  if (!bucket) {
    throw new Error('GCS storage requires GCS_BUCKET.');
  }

  const projectId = env.GCS_PROJECT_ID;
  const keyFilename = env.GCS_KEY_FILENAME;
  const credentialsRaw = env.GCS_CREDENTIALS;

  if (keyFilename && credentialsRaw) {
    throw new Error(
      'GCS_KEY_FILENAME and GCS_CREDENTIALS are mutually exclusive. Set one explicit credential source, or unset both to use ambient credentials.',
    );
  }

  if (keyFilename) {
    return { bucket, ...(projectId ? { projectId } : {}), mode: 'keyFilename', keyFilename };
  }

  if (credentialsRaw) {
    return {
      bucket,
      ...(projectId ? { projectId } : {}),
      mode: 'credentials',
      credentials: parseGcsCredentials(credentialsRaw),
    };
  }

  return { bucket, ...(projectId ? { projectId } : {}), mode: 'ambient' };
}
```

- [ ] **Step 6: Run the tests**

Run:

```sh
bun test src/cache/create-cache-storage.spec.ts
```

Expected: all tests in that file pass.

- [ ] **Step 7: Commit**

Run:

```sh
git add package.json bun.lock src/cache/create-cache-storage.ts src/cache/create-cache-storage.spec.ts
git commit -m "feat(storage): add gcs configuration resolver"
```

---

### Task 2: Add the GCS storage strategy

**Files:**

- Create: `src/cache/storage-strategy/gcs.ts`
- Create: `src/cache/storage-strategy/gcs.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/cache/storage-strategy/gcs.spec.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { Readable, Writable } from 'node:stream';
import { CacheEntryExistsError } from './storage-strategy.interface';
import { GcsStrategy, type GcsClient, type GcsWriteOptions } from './gcs';

class FakeFile {
  existsResult = true;
  metadataSize: string | number = '0';
  writeOptions: GcsWriteOptions | null = null;
  writeError: Error | null = null;
  written = Buffer.alloc(0);

  async exists(): Promise<[boolean]> {
    return [this.existsResult];
  }

  async getMetadata(): Promise<[{ size?: string | number }]> {
    return [{ size: this.metadataSize }];
  }

  createReadStream(): Readable {
    return Readable.from([Buffer.from('artifact')]);
  }

  createWriteStream(options: GcsWriteOptions): Writable {
    this.writeOptions = options;
    const file = this;
    return new Writable({
      write(chunk: Buffer | string, _encoding, callback) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        file.written = Buffer.concat([file.written, buffer]);
        callback();
      },
      final(callback) {
        callback(file.writeError);
      },
    });
  }
}

class FakeBucket {
  fileRef = new FakeFile();
  readyError: Error | null = null;

  file(_name: string): FakeFile {
    return this.fileRef;
  }

  async getMetadata(): Promise<[Record<string, unknown>]> {
    if (this.readyError) throw this.readyError;
    return [{}];
  }
}

class FakeClient implements GcsClient {
  bucketRef = new FakeBucket();

  bucket(_name: string): FakeBucket {
    return this.bucketRef;
  }
}

describe('GcsStrategy', () => {
  it('checks object existence', async () => {
    const client = new FakeClient();
    client.bucketRef.fileRef.existsResult = false;
    const strategy = new GcsStrategy({ bucket: 'b', client });

    expect(await strategy.exists('hash')).toBe(false);
  });

  it('streams object data without buffering it into memory', async () => {
    const strategy = new GcsStrategy({ bucket: 'b', client: new FakeClient() });
    const stream = await strategy.getStream('hash');

    expect(await new Response(stream).text()).toBe('artifact');
  });

  it('reads object size from metadata', async () => {
    const client = new FakeClient();
    client.bucketRef.fileRef.metadataSize = '123';
    const strategy = new GcsStrategy({ bucket: 'b', client });

    expect(await strategy.getSize('hash')).toBe(123);
  });

  it('uploads with ifGenerationMatch 0 so existing objects are never overwritten', async () => {
    const client = new FakeClient();
    const strategy = new GcsStrategy({ bucket: 'b', client });

    await strategy.writeStream('hash', new Blob(['abc']).stream(), 3);

    expect(client.bucketRef.fileRef.written.toString()).toBe('abc');
    expect(client.bucketRef.fileRef.writeOptions).toEqual({
      resumable: true,
      validation: 'crc32c',
      metadata: {
        contentType: 'application/octet-stream',
      },
      preconditionOpts: {
        ifGenerationMatch: 0,
      },
    });
  });

  it('maps GCS 412 precondition failures to CacheEntryExistsError', async () => {
    const client = new FakeClient();
    const error = Object.assign(new Error('precondition failed'), { code: 412 });
    client.bucketRef.fileRef.writeError = error;
    const strategy = new GcsStrategy({ bucket: 'b', client });

    await expect(
      strategy.writeStream('hash', new Blob(['abc']).stream(), 3),
    ).rejects.toBeInstanceOf(CacheEntryExistsError);
  });

  it('checks bucket readiness', async () => {
    const strategy = new GcsStrategy({ bucket: 'b', client: new FakeClient() });

    await expect(strategy.checkReady()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```sh
bun test src/cache/storage-strategy/gcs.spec.ts
```

Expected: fails because `src/cache/storage-strategy/gcs.ts` does not exist.

- [ ] **Step 3: Implement the strategy**

Create `src/cache/storage-strategy/gcs.ts`:

```ts
import { Storage, type StorageOptions } from '@google-cloud/storage';
import { once } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { CacheEntryExistsError, CacheStorageStrategy } from './storage-strategy.interface';

type GcsMetadata = { size?: string | number };

export interface GcsWriteOptions {
  resumable: boolean;
  validation: 'crc32c';
  metadata: {
    contentType: 'application/octet-stream';
  };
  preconditionOpts: {
    ifGenerationMatch: 0;
  };
}

export interface GcsFile {
  exists(): Promise<[boolean]>;
  getMetadata(): Promise<[GcsMetadata]>;
  createReadStream(): Readable;
  createWriteStream(options: GcsWriteOptions): Writable;
}

export interface GcsBucket {
  file(name: string): GcsFile;
  getMetadata(): Promise<unknown>;
}

export interface GcsClient {
  bucket(name: string): GcsBucket;
}

export interface GcsStrategyOptions {
  bucket: string;
  projectId?: string;
  keyFilename?: string;
  credentials?: NonNullable<StorageOptions['credentials']>;
  client?: GcsClient;
}

function createClient(options: GcsStrategyOptions): GcsClient {
  if (options.client) return options.client;

  const storageOptions: StorageOptions = {
    ...(options.projectId ? { projectId: options.projectId } : {}),
    ...(options.keyFilename ? { keyFilename: options.keyFilename } : {}),
    ...(options.credentials ? { credentials: options.credentials } : {}),
  };
  return new Storage(storageOptions);
}

function isPreconditionFailed(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; statusCode?: unknown };
  return candidate.code === 412 || candidate.statusCode === 412;
}

async function writeWebStreamToWritable(
  source: ReadableStream<Uint8Array>,
  target: Writable,
): Promise<void> {
  const reader = source.getReader();
  const failure = new Promise<never>((_, reject) => {
    target.once('error', reject);
  });

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!target.write(value)) {
        await Promise.race([once(target, 'drain'), failure]);
      }
    }
    target.end();
    await Promise.race([once(target, 'finish'), failure]);
  } catch (error) {
    target.destroy(error instanceof Error ? error : new Error(String(error)));
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export class GcsStrategy implements CacheStorageStrategy {
  readonly #bucket: GcsBucket;

  constructor(options: GcsStrategyOptions) {
    this.#bucket = createClient(options).bucket(options.bucket);
  }

  #file(hash: string): GcsFile {
    return this.#bucket.file(hash);
  }

  async exists(hash: string): Promise<boolean> {
    const [exists] = await this.#file(hash).exists();
    return exists;
  }

  async getStream(hash: string): Promise<ReadableStream> {
    return Readable.toWeb(this.#file(hash).createReadStream());
  }

  async getSize(hash: string): Promise<number> {
    const [metadata] = await this.#file(hash).getMetadata();
    return Number(metadata.size ?? 0);
  }

  async writeStream(
    hash: string,
    stream: ReadableStream<Uint8Array>,
    _contentLength: number,
  ): Promise<void> {
    const writer = this.#file(hash).createWriteStream({
      resumable: true,
      validation: 'crc32c',
      metadata: {
        contentType: 'application/octet-stream',
      },
      preconditionOpts: {
        ifGenerationMatch: 0,
      },
    });

    try {
      await writeWebStreamToWritable(stream, writer);
    } catch (error) {
      if (isPreconditionFailed(error)) {
        throw new CacheEntryExistsError(hash);
      }
      throw error;
    }
  }

  async checkReady(): Promise<void> {
    await this.#bucket.getMetadata();
  }
}
```

- [ ] **Step 4: Run the strategy tests**

Run:

```sh
bun test src/cache/storage-strategy/gcs.spec.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```sh
git add src/cache/storage-strategy/gcs.ts src/cache/storage-strategy/gcs.spec.ts
git commit -m "feat(storage): add gcs cache strategy"
```

---

### Task 3: Wire `STORAGE_STRATEGY=gcs` into startup

**Files:**

- Modify: `src/cache/create-cache-storage.ts`
- Modify: `src/cache/create-cache-storage.spec.ts`
- Modify: `e2e/startup-validation.e2e.spec.ts`

- [ ] **Step 1: Write failing factory and startup tests**

In `src/cache/create-cache-storage.spec.ts`, add:

```ts
import { GcsStrategy } from './storage-strategy/gcs';
```

Append to `describe('createCacheStorage', ...)`:

```ts
it('creates GCS storage when STORAGE_STRATEGY is gcs', () => {
  expect(createCacheStorage(asEnv({ STORAGE_STRATEGY: 'gcs', GCS_BUCKET: 'b' }))).toBeInstanceOf(
    GcsStrategy,
  );
});
```

In `e2e/startup-validation.e2e.spec.ts`, change the unknown strategy test from `gcs` to `azure`:

```ts
STORAGE_STRATEGY: 'azure',
```

```ts
expect(stderr).toContain('Unknown STORAGE_STRATEGY');
```

Append this e2e:

```ts
it('refuses to start when gcs storage has no bucket', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rc-startup-gcs-'));
  const proc = Bun.spawn(['bun', 'src/main.ts'], {
    env: {
      ...baseEnv(),
      ADMIN_TOKEN: 'e2e-admin-token-0123456789abcdef',
      PORT: '4014',
      STORAGE_STRATEGY: 'gcs',
      TOKENS_DB_PATH: join(dir, 'tokens.sqlite'),
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const exitCode = await proc.exited;
  const stderr = await new Response(proc.stderr).text();
  rmSync(dir, { recursive: true, force: true });

  expect(exitCode).toBe(1);
  expect(stderr).toContain('GCS_BUCKET');
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```sh
bun test src/cache/create-cache-storage.spec.ts e2e/startup-validation.e2e.spec.ts
```

Expected: the factory test fails because `createCacheStorage` still rejects `gcs`.

- [ ] **Step 3: Implement the factory branch**

In `src/cache/create-cache-storage.ts`, add the import:

```ts
import { GcsStrategy } from './storage-strategy/gcs';
```

Inside `createCacheStorage`, add this branch after the S3 branch:

```ts
if (kind === 'gcs') {
  const cfg = resolveGcsConfig(env);
  return new GcsStrategy({
    bucket: cfg.bucket,
    ...(cfg.projectId ? { projectId: cfg.projectId } : {}),
    ...(cfg.mode === 'keyFilename' ? { keyFilename: cfg.keyFilename } : {}),
    ...(cfg.mode === 'credentials' ? { credentials: cfg.credentials } : {}),
  });
}
```

Change the unknown strategy error to:

```ts
throw new Error(
  `Unknown STORAGE_STRATEGY "${env.STORAGE_STRATEGY}". Use "filesystem", "s3", or "gcs".`,
);
```

- [ ] **Step 4: Run tests**

Run:

```sh
bun test src/cache/create-cache-storage.spec.ts e2e/startup-validation.e2e.spec.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```sh
git add src/cache/create-cache-storage.ts src/cache/create-cache-storage.spec.ts e2e/startup-validation.e2e.spec.ts
git commit -m "feat(storage): wire gcs startup configuration"
```

---

### Task 4: Add deep readiness

**Files:**

- Modify: `src/cache/storage-strategy/storage-strategy.interface.ts`
- Modify: `src/cache/storage-strategy/file-system.ts`
- Modify: `src/cache/storage-strategy/s3.ts`
- Modify: `src/cache/create-cache-storage.ts`
- Modify: `src/token/token-storage.ts`
- Modify: `src/token/token-storage.spec.ts`
- Modify: `src/responses.ts`
- Create: `src/ready/get-ready.ts`
- Create: `src/ready/get-ready.spec.ts`
- Modify: `src/main.ts`
- Create: `e2e/ready.e2e.spec.ts`

- [ ] **Step 1: Write failing readiness handler tests**

Create `src/ready/get-ready.spec.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { getReady, type ReadyDependency } from './get-ready';

const ready = (): ReadyDependency => ({ checkReady: () => Promise.resolve() });
const broken = (): ReadyDependency => ({
  checkReady: () => Promise.reject(new Error('backend unavailable')),
});

describe('getReady', () => {
  it('returns OK when token storage and cache storage are ready', async () => {
    const response = await getReady({ tokenStorage: ready(), storage: ready() });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/plain');
    expect(await response.text()).toBe('OK');
  });

  it('returns a static 503 when token storage is unavailable', async () => {
    const response = await getReady({ tokenStorage: broken(), storage: ready() });

    expect(response.status).toBe(503);
    expect(response.headers.get('Content-Type')).toContain('text/plain');
    expect(await response.text()).toBe('Not Ready');
  });

  it('returns a static 503 when cache storage is unavailable', async () => {
    const response = await getReady({ tokenStorage: ready(), storage: broken() });

    expect(response.status).toBe(503);
    expect(await response.text()).toBe('Not Ready');
  });
});
```

- [ ] **Step 2: Add token readiness test**

In `src/token/token-storage.spec.ts`, append:

```ts
it('checks sqlite readiness with a simple query', async () => {
  const dbPath = await freshDbPath();
  const storage = new TokenStorage(dbPath);

  await expect(storage.checkReady()).resolves.toBeUndefined();
});
```

- [ ] **Step 3: Add e2e test for `/ready`**

Create `e2e/ready.e2e.spec.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { spawnServer, type SpawnedServer } from './spawn-server';

describe('ready endpoint e2e', () => {
  let server: SpawnedServer;

  beforeAll(async () => {
    server = await spawnServer(4018);
  });

  afterAll(async () => {
    await server.stop();
  });

  it('returns OK without authentication when dependencies are ready', async () => {
    const response = await fetch(`${server.baseUrl}/ready`);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/plain');
    expect(await response.text()).toBe('OK');
  });
});
```

- [ ] **Step 4: Run tests to verify failure**

Run:

```sh
bun test src/ready/get-ready.spec.ts src/token/token-storage.spec.ts e2e/ready.e2e.spec.ts
```

Expected: fails because `get-ready.ts`, `TokenStorage.checkReady`, and `/ready` do not exist.

- [ ] **Step 5: Add response factory**

In `src/responses.ts`, add:

```ts
export function serviceUnavailable(message: string) {
  return new Response(message, {
    status: 503,
    headers: { 'Content-Type': 'text/plain' },
  });
}
```

- [ ] **Step 6: Add the readiness handler**

Create `src/ready/get-ready.ts`:

```ts
import { logger } from '../logger';
import { okResponse, serviceUnavailable } from '../responses';

export interface ReadyDependency {
  checkReady(): Promise<void>;
}

export async function getReady({
  tokenStorage,
  storage,
}: {
  tokenStorage: ReadyDependency;
  storage: ReadyDependency;
}) {
  try {
    await tokenStorage.checkReady();
    await storage.checkReady();
    return okResponse({ message: 'OK', contentType: 'text/plain' });
  } catch (error) {
    logger.error(error);
    return serviceUnavailable('Not Ready');
  }
}
```

- [ ] **Step 7: Add token-store readiness**

In `src/token/token-storage.ts`, add this method to `TokenStorage`:

```ts
checkReady(): Promise<void> {
  this.#db.query('SELECT 1').get();
  return Promise.resolve();
}
```

- [ ] **Step 8: Add storage readiness contract**

In `src/cache/storage-strategy/storage-strategy.interface.ts`, add:

```ts
  checkReady(): Promise<void>;
```

The interface should become:

```ts
export interface CacheStorageStrategy {
  exists(hash: string): Promise<boolean>;
  // assumes existence check has been done beforehand
  getStream(hash: string): Promise<ReadableStream>;
  getSize(hash: string): Promise<number>;
  writeStream(
    hash: string,
    stream: ReadableStream<Uint8Array>,
    contentLength: number,
  ): Promise<void>;
  checkReady(): Promise<void>;
}
```

- [ ] **Step 9: Move the filesystem readiness probe into the filesystem strategy**

In `src/cache/storage-strategy/file-system.ts`, replace the `node:fs` import with:

```ts
import {
  accessSync,
  constants,
  existsSync,
  linkSync,
  mkdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
```

Add this exported helper above `FileSystemStrategy`:

```ts
export function assertFileSystemCacheDirReady(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK | constants.X_OK);
  } catch (error) {
    throw new Error(
      `CACHE_DIR "${dir}" is not writable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const probe = join(dir, `.remotecache-link-probe-${crypto.randomUUID()}`);
  const probeLink = `${probe}.link`;
  try {
    writeFileSync(probe, '');
    linkSync(probe, probeLink);
  } catch (error) {
    throw new Error(
      `CACHE_DIR "${dir}" does not support atomic hard-link commits: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    for (const path of [probeLink, probe]) {
      try {
        unlinkSync(path);
      } catch {}
    }
  }
}
```

Add this method to `FileSystemStrategy`:

```ts
async checkReady(): Promise<void> {
  assertFileSystemCacheDirReady(this.cacheDir);
}
```

In `src/cache/create-cache-storage.ts`, remove the local `assertWritableDir` helper and its `node:fs` / `node:path` imports, then import the filesystem helper:

```ts
import { FileSystemStrategy, assertFileSystemCacheDirReady } from './storage-strategy/file-system';
```

Replace:

```ts
assertWritableDir(cacheDir);
```

with:

```ts
assertFileSystemCacheDirReady(cacheDir);
```

- [ ] **Step 10: Add S3 readiness**

In `src/cache/storage-strategy/s3.ts`, add:

```ts
async checkReady(): Promise<void> {
  await (await this.#getClient()).exists('.remotecache-ready-probe');
}
```

`GcsStrategy.checkReady()` already exists from Task 2.

- [ ] **Step 11: Wire `/ready` in `main.ts`**

Add the import:

```ts
import { getReady } from './ready/get-ready';
```

Add this route beside `/health`:

```ts
'/ready': {
  GET: () => trackRequest(() => getReady({ tokenStorage, storage })),
},
```

The route key is the literal string `'/ready'`.

- [ ] **Step 12: Run readiness tests**

Run:

```sh
bun test src/ready/get-ready.spec.ts src/token/token-storage.spec.ts e2e/ready.e2e.spec.ts
```

Expected: pass.

- [ ] **Step 13: Run the storage factory tests**

Run:

```sh
bun test src/cache/create-cache-storage.spec.ts src/cache/storage-strategy/gcs.spec.ts src/cache/storage-strategy/s3.spec.ts
```

Expected: pass.

- [ ] **Step 14: Commit**

Run:

```sh
git add src/cache/storage-strategy/storage-strategy.interface.ts src/cache/storage-strategy/file-system.ts src/cache/storage-strategy/s3.ts src/cache/create-cache-storage.ts src/token/token-storage.ts src/token/token-storage.spec.ts src/responses.ts src/ready/get-ready.ts src/ready/get-ready.spec.ts src/main.ts e2e/ready.e2e.spec.ts
git commit -m "feat(health): add deep readiness probe"
```

---

### Task 5: Add Helm chart support

**Files:**

- Modify: `charts/remotecache/values.yaml`
- Modify: `charts/remotecache/templates/deployment.yaml`
- Create: `charts/remotecache/ci/gcs-values.yaml`
- Modify: `docs-site/src/content/docs/deploy/kubernetes.md` in Task 6, not here

- [ ] **Step 1: Add GCS values**

In `charts/remotecache/values.yaml`, change the storage comment:

```yaml
storage:
  # "filesystem" (default), "s3", or "gcs".
  strategy: filesystem
```

Add after the `s3:` block:

```yaml
gcs:
  bucket: ''
  projectId: ''
  # Optional explicit credentials. Prefer Workload Identity on GKE.
  # keyFilename points at a mounted service account JSON file; mount it with
  # extraVolumes/extraVolumeMounts or your own wrapper chart.
  keyFilename: ''
  # Existing Secret containing a service account JSON value. The chart never
  # creates this Secret from a literal value.
  existingSecret: ''
  existingSecretKey: credentials.json
```

- [ ] **Step 2: Add template validation**

In `charts/remotecache/templates/deployment.yaml`, change the storage strategy guard to:

```gotemplate
{{- if not (or (eq .Values.storage.strategy "filesystem") (eq .Values.storage.strategy "s3") (eq .Values.storage.strategy "gcs")) }}
{{- fail "remotecache: storage.strategy must be filesystem, s3, or gcs" }}
{{- end }}
```

Add after the S3 validations:

```gotemplate
{{- if and (eq .Values.storage.strategy "gcs") (not .Values.gcs.bucket) }}
{{- fail "remotecache: storage.strategy=gcs requires gcs.bucket" }}
{{- end }}
{{- if and .Values.gcs.existingSecret .Values.gcs.keyFilename }}
{{- fail "remotecache: set only one of gcs.existingSecret or gcs.keyFilename" }}
{{- end }}
```

Change the eviction guard to mention object stores:

```gotemplate
{{- if and (ne .Values.storage.strategy "filesystem") (or .Values.config.cacheMaxBytes .Values.config.cacheTtlHours .Values.config.sweepIntervalMs) }}
{{- fail "remotecache: config.cacheMaxBytes/cacheTtlHours/sweepIntervalMs require storage.strategy=filesystem (use object storage lifecycle rules instead)" }}
{{- end }}
```

- [ ] **Step 3: Wire GCS environment variables**

In the container `env:` list in `charts/remotecache/templates/deployment.yaml`, add after the S3 block:

```gotemplate
            {{- if eq .Values.storage.strategy "gcs" }}
            - name: GCS_BUCKET
              value: {{ .Values.gcs.bucket | quote }}
            {{- if .Values.gcs.projectId }}
            - name: GCS_PROJECT_ID
              value: {{ .Values.gcs.projectId | quote }}
            {{- end }}
            {{- if .Values.gcs.keyFilename }}
            - name: GCS_KEY_FILENAME
              value: {{ .Values.gcs.keyFilename | quote }}
            {{- end }}
            {{- if .Values.gcs.existingSecret }}
            - name: GCS_CREDENTIALS
              valueFrom:
                secretKeyRef:
                  name: {{ .Values.gcs.existingSecret }}
                  key: {{ .Values.gcs.existingSecretKey }}
            {{- end }}
            {{- end }}
```

- [ ] **Step 4: Move readiness probe to `/ready`**

In `charts/remotecache/templates/deployment.yaml`, change only the readiness probe path:

```gotemplate
          readinessProbe:
            httpGet:
              path: /ready
              port: http
              scheme: {{ if .Values.tls.enabled }}HTTPS{{ else }}HTTP{{ end }}
```

Leave the liveness probe path as `/health`.

- [ ] **Step 5: Add chart CI values for GCS**

Create `charts/remotecache/ci/gcs-values.yaml`:

```yaml
adminToken: ci-admin-token-0123456789abcdef

storage:
  strategy: gcs

gcs:
  bucket: remotecache-ci-bucket
  projectId: remotecache-ci

persistence:
  cache:
    enabled: false
```

- [ ] **Step 6: Verify Helm rendering**

Run:

```sh
helm lint charts/remotecache --values charts/remotecache/ci/gcs-values.yaml
helm template remotecache charts/remotecache --values charts/remotecache/ci/gcs-values.yaml > /tmp/remotecache-gcs.yaml
rg -n "GCS_BUCKET|GCS_PROJECT_ID|path: /ready|path: /health" /tmp/remotecache-gcs.yaml
```

Expected:

- `helm lint` exits `0`.
- Rendered YAML contains `GCS_BUCKET`, `GCS_PROJECT_ID`, readiness `path: /ready`, and liveness `path: /health`.

- [ ] **Step 7: Commit**

Run:

```sh
git add charts/remotecache/values.yaml charts/remotecache/templates/deployment.yaml charts/remotecache/ci/gcs-values.yaml
git commit -m "feat(chart): support gcs storage and readiness probes"
```

---

### Task 6: Update API, docs, README, and roadmap

**Files:**

- Modify: `nx-cache-server.openapi.json`
- Modify: `docs-site/src/content/docs/guides/configuration.md`
- Modify: `docs-site/src/content/docs/guides/storage-strategies.md`
- Modify: `docs-site/src/content/docs/deploy/kubernetes.md`
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-07-05-remotecache-roadmap.md`

- [ ] **Step 1: Add `/ready` to OpenAPI**

In `nx-cache-server.openapi.json`, add a sibling to `/health`:

```json
"/ready": {
  "get": {
    "description": "Deep unauthenticated readiness check for orchestrator probes. Returns OK when the token database is reachable and the configured cache backend passes its readiness check.",
    "operationId": "getReady",
    "security": [],
    "responses": {
      "200": {
        "description": "Server dependencies are ready",
        "content": {
          "text/plain": {
            "schema": {
              "type": "string",
              "example": "OK"
            }
          }
        }
      },
      "503": {
        "description": "A dependency is not ready",
        "content": {
          "text/plain": {
            "schema": {
              "type": "string",
              "example": "Not Ready"
            }
          }
        }
      }
    }
  }
},
```

Keep valid JSON commas when inserting the new path.

- [ ] **Step 2: Update configuration docs**

In `docs-site/src/content/docs/guides/configuration.md`, update the frontmatter description to include readiness and GCS.

Change these rows or add them in the table:

```md
| `STORAGE_STRATEGY` | no | filesystem | `filesystem`, `s3`, or `gcs`. Any other value refuses to start. |
| `GCS_BUCKET` | for gcs | - | Google Cloud Storage bucket. |
| `GCS_PROJECT_ID` | no | - | Google Cloud project id when the SDK cannot infer it. |
| `GCS_KEY_FILENAME` | no | - | Path to a service account JSON file. Use this or `GCS_CREDENTIALS`, not both. |
| `GCS_CREDENTIALS` | no | - | Service account JSON supplied through a secret-backed environment variable. Use this or `GCS_KEY_FILENAME`, not both. |
```

In Notes, replace the health paragraph with:

```md
`GET /health` has no configuration. It returns `OK` when the process is accepting requests. Use it for liveness checks.

`GET /ready` is also unauthenticated, but it is deeper: it checks SQLite token storage and the configured cache backend. Use it for readiness checks in Kubernetes or any platform that can route traffic only after dependencies are usable. Failure responses are static (`Not Ready`); details go to logs.
```

Add after the S3 paragraph:

```md
For GCS, set `STORAGE_STRATEGY=gcs` and `GCS_BUCKET`. On GKE, prefer Workload Identity or other ambient Google credentials. For explicit credentials, set exactly one of `GCS_KEY_FILENAME` or `GCS_CREDENTIALS`; the latter should come from a secret, not a committed env file.
```

Update the eviction paragraph:

```md
Setting either filesystem eviction variable with `STORAGE_STRATEGY=s3` or `STORAGE_STRATEGY=gcs` is a startup error. Use bucket lifecycle rules for object storage instead.
```

- [ ] **Step 3: Update storage strategies docs**

In `docs-site/src/content/docs/guides/storage-strategies.md`, update the description and opening paragraph to list filesystem, S3, and GCS.

Add this section after the S3 section:

```md
## Google Cloud Storage

Set `STORAGE_STRATEGY=gcs` and `GCS_BUCKET`.

For GKE, use Workload Identity and leave `GCS_KEY_FILENAME` / `GCS_CREDENTIALS` unset. Outside Google Cloud, provide one explicit credential source:

- `GCS_KEY_FILENAME`: path to a mounted service account JSON file.
- `GCS_CREDENTIALS`: service account JSON from a secret-backed environment variable.

Do not set both. The server fails at startup if the bucket is missing or the credential settings conflict.

GCS writes use the generation precondition `ifGenerationMatch: 0`. That makes the upload succeed only when no live object exists for the hash; an existing object maps to the same `409` response as the filesystem and S3 strategies.

GCS cache growth should be managed with bucket lifecycle rules. The built-in `CACHE_MAX_BYTES` and `CACHE_TTL_HOURS` sweeper applies only to filesystem storage.
```

In "Cache growth and pruning", rename the S3 lifecycle paragraph heading to:

```md
**Object storage.** Use a bucket lifecycle rule; the server is not involved. For S3:
```

After the S3 JSON example, add:

````md
For GCS, use a lifecycle rule such as:

```json
{
  "rule": [
    {
      "action": { "type": "Delete" },
      "condition": { "age": 30 }
    }
  ]
}
```
````

Apply it with `gcloud storage buckets update gs://<bucket> --lifecycle-file=lifecycle.json`.

````

- [ ] **Step 4: Update Kubernetes docs**

In `docs-site/src/content/docs/deploy/kubernetes.md`, change the first paragraph to say readiness points at `/ready` and liveness points at `/health`.

Add this section after "S3 with EKS IRSA":

```md
## GCS with GKE Workload Identity

For GCS on GKE, prefer Workload Identity instead of a service account JSON key:

```sh
helm install remotecache ./charts/remotecache \
  --set adminToken="$(openssl rand -hex 32)" \
  --set storage.strategy=gcs \
  --set gcs.bucket=my-cache-bucket \
  --set gcs.projectId=my-gcp-project \
  --set serviceAccount.annotations."iam\.gke\.io/gcp-service-account"=remotecache@my-gcp-project.iam.gserviceaccount.com
````

Grant the Google service account access to the bucket. For least privilege, it needs object read, create, and metadata access for the cache bucket.

````

In the key values table, change:

```md
| `storage.strategy` | `filesystem` (default), `s3`, or `gcs`. |
| `gcs.*` | Bucket, project id, and optional explicit credential settings. Prefer Workload Identity on GKE. |
````

- [ ] **Step 5: Update README**

In `README.md`, update feature bullets:

```md
- Health and readiness checks
  - `GET /health` (unauthenticated; process liveness)
  - `GET /ready` (unauthenticated; token DB + storage backend readiness)
```

Update storage strategy bullets:

```md
- Storage strategies
  - local filesystem (default)
  - S3-compatible storage (AWS S3, MinIO, etc.)
  - Google Cloud Storage
```

- [ ] **Step 6: Update roadmap**

In `docs/superpowers/plans/2026-07-05-remotecache-roadmap.md`, replace Phase 3 items 2 and 3 with:

```md
2. **Google Cloud Storage strategy** - shipped: `STORAGE_STRATEGY=gcs` with append-only writes via `ifGenerationMatch: 0`.
3. **Azure Blob storage strategy** - pending; same Phase 3 migration thesis, separate spec/plan cycle.
4. **Deep `/ready` probe** - shipped: token DB + configured storage backend readiness for orchestrators.
```

- [ ] **Step 7: Humanize docs copy**

Read the changed Markdown files and remove:

- inflated claims
- vague "best in class" language
- em dash overuse
- chatbot-style conclusions

Keep the docs direct and operational.

- [ ] **Step 8: Build docs and run format**

Run:

```sh
bun run format nx-cache-server.openapi.json README.md docs-site/src/content/docs/guides/configuration.md docs-site/src/content/docs/guides/storage-strategies.md docs-site/src/content/docs/deploy/kubernetes.md docs/superpowers/plans/2026-07-05-remotecache-roadmap.md
cd docs-site && bun run build
```

Expected: formatter exits `0`, docs build exits `0`.

- [ ] **Step 9: Commit**

Run:

```sh
git add nx-cache-server.openapi.json docs-site/src/content/docs/guides/configuration.md docs-site/src/content/docs/guides/storage-strategies.md docs-site/src/content/docs/deploy/kubernetes.md README.md docs/superpowers/plans/2026-07-05-remotecache-roadmap.md
git commit -m "docs(storage): document gcs storage and readiness"
```

---

### Task 7: Final verification

**Files:**

- All touched files

- [ ] **Step 1: Run the full local gate**

Run:

```sh
bun test
bun run typecheck
bun run lint
bun run format --check
```

Expected: all exit `0`.

- [ ] **Step 2: Run docs build**

Run:

```sh
cd docs-site && bun run build
```

Expected: exit `0`.

- [ ] **Step 3: Run Helm checks**

Run:

```sh
helm lint charts/remotecache --values charts/remotecache/ci/filesystem-values.yaml
helm lint charts/remotecache --values charts/remotecache/ci/s3-values.yaml
helm lint charts/remotecache --values charts/remotecache/ci/gcs-values.yaml
helm template remotecache charts/remotecache --values charts/remotecache/ci/filesystem-values.yaml > /tmp/remotecache-fs.yaml
helm template remotecache charts/remotecache --values charts/remotecache/ci/gcs-values.yaml > /tmp/remotecache-gcs.yaml
rg -n "path: /ready|path: /health" /tmp/remotecache-fs.yaml /tmp/remotecache-gcs.yaml
```

Expected: all Helm commands exit `0`; rendered manifests include `/ready` readiness and `/health` liveness.

- [ ] **Step 4: Optional local GCS smoke**

Run this only with a disposable bucket and credentials:

```sh
export ADMIN_TOKEN="$(openssl rand -hex 32)"
export STORAGE_STRATEGY=gcs
export GCS_BUCKET="<temporary-bucket>"
export GCS_PROJECT_ID="<project-id>"
bun run serve
```

From another shell:

```sh
curl -i http://127.0.0.1:3000/ready
curl -sS -X PUT \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Length: 5" \
  --data-binary "hello" \
  http://127.0.0.1:3000/v1/cache/0123456789abcdef0123456789abcdef
curl -i -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  http://127.0.0.1:3000/v1/cache/0123456789abcdef0123456789abcdef
curl -i -X PUT \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Length: 5" \
  --data-binary "again" \
  http://127.0.0.1:3000/v1/cache/0123456789abcdef0123456789abcdef
```

Expected:

- `/ready` returns `200 OK`.
- First `PUT` returns `200`.
- `GET` returns the stored body.
- Second `PUT` to the same hash returns `409`.

- [ ] **Step 5: Final status**

Run:

```sh
git status --short
git log --oneline -7
```

Expected: worktree clean except any intentionally uncommitted local smoke artifacts; recent commits match the tasks above.

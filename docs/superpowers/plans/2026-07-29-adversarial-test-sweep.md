# Adversarial Test Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Find and fix meaningful edge-case, corruption, cancellation, configuration, and concurrency defects while leaving a smaller, stronger test suite.

**Architecture:** Work from a module-by-module risk ledger, then use focused unit tests for logic, local filesystem and SQLite tests for state, and a small number of HTTP and MinIO tests for integration boundaries. Every production edit follows a red-green cycle; final pruning uses the ledger so no distinct contract disappears.

**Tech Stack:** Bun 1.3.14, TypeScript 6, `bun:test`, `bun:sqlite`, Bun S3 client, Docker, and the CI-pinned MinIO image.

---

## File map

- Create `docs/superpowers/reviews/2026-07-29-adversarial-test-sweep.md`: risk dispositions, defects, pruning decisions, and final evidence.
- Modify `src/cache/write-cache.ts` and `src/cache/write-cache.spec.ts`: upload-source cancellation and malformed length partitions.
- Modify `src/token/token-storage.ts` and `src/token/token-storage.spec.ts`: collision-safe migration and operational readiness.
- Modify `src/main.ts`, `e2e/startup-validation.e2e.spec.ts`, and `docs-site/src/content/docs/guides/configuration.md`: integer configuration boundaries and test consolidation.
- Modify `src/cache/storage-strategy/s3.spec.ts`: credential refresh and conditional-write failure coverage.
- Create `e2e/request-boundaries.e2e.spec.ts`: malformed auth, encoded traversal, and duplicate length integration boundaries.
- Modify `e2e/concurrency.e2e.spec.ts` and `e2e/s3-minio.e2e.spec.ts`: bounded contention and real S3 readiness.
- Modify `src/cache/is-valid-hash.spec.ts`, `src/token/add-token.spec.ts`, and `src/token/hash-token.spec.ts`: complete input partitions and replace redundant hash properties with one exact contract.

### Task 1: Record the baseline and risk ledger

**Files:**

- Create: `docs/superpowers/reviews/2026-07-29-adversarial-test-sweep.md`
- Reference: `docs/superpowers/specs/2026-07-29-adversarial-test-sweep-design.md`

- [ ] **Step 1: Create the review ledger**

Start the file with the measured baseline and one row for every runtime unit:

```markdown
# Adversarial test sweep

## Baseline

- `bun test`: 132 pass, 8 endpoint-gated MinIO skips, 0 fail
- Function coverage: 90.63%
- Line coverage: 92.18%
- Format, lint, and typecheck: pass

## Risk dispositions

| Unit                                        | Primary risks                                     | Initial evidence                | Planned disposition                                                             |
| ------------------------------------------- | ------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------- |
| `src/main.ts`                               | numeric parsing, auth parsing, shutdown races     | startup and e2e coverage        | add integer-boundary cases; retain shutdown e2e                                 |
| `src/cache/write-cache.ts`                  | malformed lengths, partial streams, cancellation  | focused unit coverage           | add red-green cancellation regressions; merge malformed syntax cases            |
| `src/cache/get-cache.ts`                    | authorization, disappear-after-exists             | 100% line coverage              | retain existing handler tests; document the storage-race 500 contract           |
| `src/cache/eviction.ts`                     | missing entries, overlap, timer lifecycle         | focused filesystem coverage     | retain existing state/race tests; repeat overlap case 20 times                  |
| `src/cache/create-cache-storage.ts`         | malformed credentials and strategies              | focused config coverage         | retain existing configuration partitions                                        |
| `src/cache/storage-strategy/file-system.ts` | atomic commit, cleanup, readiness                 | unit and e2e coverage           | retain atomicity and cleanup tests; repeat races 20 times                       |
| `src/cache/storage-strategy/s3.ts`          | refresh coalescing, conditional writes, aborts    | MinIO plus sparse unit coverage | add provider concurrency/retry and 501 contract tests; run MinIO                |
| `src/cache/storage-strategy/gcs.ts`         | stream errors, metadata, preconditions            | fake-client unit coverage       | retain stream cancellation and both observed 412 shapes                         |
| `src/token/token-storage.ts`                | migration collisions, corruption, duplicate state | SQLite unit coverage            | add red-green collision and damaged-table readiness regressions                 |
| `src/token/add-token.ts`                    | malformed JSON and permissions                    | focused unit coverage           | retain distinct authorization, parsing, validation, conflict, and success cases |
| `src/token/delete-token.ts`                 | invalid IDs and storage failures                  | focused unit coverage           | retain distinct authorization, validation, storage, missing, and success cases  |
| `src/token/list-tokens.ts`                  | authorization and disclosure                      | focused unit coverage           | retain authorization and response-shape cases                                   |
| `src/metrics/metrics-registry.ts`           | label mapping and counter drift                   | 100% line coverage              | retain mapping, counter, gauge, and seed cases                                  |
| `src/tls/load-tls-config.ts`                | partial or missing TLS files                      | unit and TLS e2e coverage       | retain configuration partitions and real HTTPS smoke test                       |
| `src/ready/get-ready.ts`                    | dependency failure propagation                    | focused unit coverage           | retain dependency tests; strengthen token readiness dependency                  |
| `src/responses.ts`                          | status, body, and header consistency              | exercised through handlers      | keep indirect contract coverage; do not add factory-only tests                  |
| `src/safe-equal.ts`                         | unequal lengths and empty secrets                 | focused unit coverage           | retain equality partitions                                                      |
| `src/logger.ts`                             | verbose gating and error visibility               | integration-observed            | keep integration observation; avoid global-console unit mocks                   |
```

- [ ] **Step 2: Re-run the baseline**

Run:

```bash
bun test
bun test --coverage
bun run format --check
bun run lint
bun run typecheck
```

Expected: 132 pass, eight explained MinIO skips, zero failures, and all static gates pass. Record any drift before editing.

- [ ] **Step 3: Commit the ledger**

```bash
git add docs/superpowers/reviews/2026-07-29-adversarial-test-sweep.md
git commit -m "docs(test): record adversarial baseline"
```

### Task 2: Cancel rejected upload sources and consolidate malformed lengths

**Files:**

- Modify: `src/cache/write-cache.spec.ts`
- Modify: `src/cache/write-cache.ts`

- [ ] **Step 1: Strengthen the existing write-failure test**

Replace its body setup with an observable cancellation source and add the final assertion:

```ts
it('returns 500 and cancels the source when storage rejects before reading', async () => {
  const diskFullError = new Error('disk full');
  const cacheFile = makeCacheFile();
  cacheFile.exists.mockResolvedValue(false);
  cacheFile.writeStream.mockRejectedValue(diskFullError);
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('payload'));
    },
    cancel() {
      cancelled = true;
    },
  });

  const response = await writeCache(cacheFile, 'full', body, '7', maxUploadBytes);

  expect(cacheFile.exists).toHaveBeenCalled();
  expect(cacheFile.writeStream).toHaveBeenCalled();
  expect(response.status).toBe(500);
  expect(await response.text()).toBe('Failed to write to cache');
  expect(logger.error).toHaveBeenCalledWith(diskFullError);
  expect(cancelled).toBe(true);
});
```

- [ ] **Step 2: Add an overlong-stream cancellation regression**

```ts
it('cancels the source when the body exceeds its declared length', async () => {
  const cacheFile = makeCacheFile();
  cacheFile.exists.mockResolvedValue(false);
  cacheFile.writeStream.mockImplementation(async (stream) => {
    await consumeStream(stream);
  });
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(5));
    },
    cancel() {
      cancelled = true;
    },
  });

  const response = await writeCache(cacheFile, 'full', body, '4', maxUploadBytes);

  expect(response.status).toBe(400);
  expect(await response.text()).toBe('Invalid Content-Length header');
  expect(cancelled).toBe(true);
});
```

- [ ] **Step 3: Verify both regressions fail for cancellation**

Run: `bun test src/cache/write-cache.spec.ts`

Expected: the two cancellation assertions fail with `Expected: true, Received: false`.

- [ ] **Step 4: Cancel the acquired reader on every failed write**

Add this JSDoc above `writeCache`:

```ts
/**
 * Validate and stream one append-only cache upload.
 *
 * Once the request body reader is acquired, any rejected write cancels that
 * reader so an unread or oversized source cannot remain live after the
 * response has been decided.
 */
```

Immediately after `const reader = sourceStream.getReader();`, insert:

```ts
const cancelSource = async () => {
  try {
    await reader.cancel();
  } catch {}
};
```

Make cancellation the first operation in the existing catch block:

```ts
} catch (error) {
  await cancelSource();
  if (error instanceof CacheEntryExistsError) {
    return conflictError('Cannot override an existing record');
  }
  if (
    error instanceof ContentLengthExceededError ||
    error instanceof ContentLengthMismatchError
  ) {
    return badRequest('Invalid Content-Length header');
  }
  logger.error(error);
  return internalServerError('Failed to write to cache');
}
```

- [ ] **Step 5: Merge the two syntax-only length tests**

Replace the separate generic-invalid and scientific-notation tests with one partition test:

```ts
it('rejects non-decimal-positive-integer Content-Length forms', async () => {
  for (const header of ['', '0', '-1', '+4', ' 4 ', '4.0', '4e0', 'Infinity', 'NaN']) {
    const cacheFile = makeCacheFile();
    cacheFile.exists.mockResolvedValue(false);

    const response = await writeCache(
      cacheFile,
      'full',
      createStream('data'),
      header,
      maxUploadBytes,
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toBe('Invalid Content-Length header');
    expect(cacheFile.writeStream).not.toHaveBeenCalled();
  }
});
```

- [ ] **Step 6: Verify and commit**

Run:

```bash
bun test src/cache/write-cache.spec.ts
bun run typecheck
```

Expected: all write-cache tests pass.

```bash
git add src/cache/write-cache.ts src/cache/write-cache.spec.ts
git commit -m "fix(cache): cancel rejected upload sources"
```

### Task 3: Make token migration collision-safe and readiness operational

**Files:**

- Modify: `src/token/token-storage.spec.ts`
- Modify: `src/token/token-storage.ts`

- [ ] **Step 1: Add the migration-collision regression**

Create a legacy database containing raw value `a` and another raw value equal to `hashToken('a')`. Opening it must preserve both credentials:

```ts
it('migrates when one plaintext value equals another token hash', async () => {
  const dbPath = await freshDbPath();
  const raw = 'a';
  const hashLookingRaw = hashToken(raw);
  const legacy = new Database(dbPath, { create: true, strict: true });
  legacy.run(`
    CREATE TABLE tokens (
      id TEXT NOT NULL UNIQUE,
      value TEXT PRIMARY KEY,
      permission TEXT NOT NULL CHECK (permission IN ('readonly', 'full'))
    );
  `);
  const insert = legacy.query(
    'INSERT INTO tokens (id, value, permission) VALUES ($id, $value, $permission)',
  );
  insert.run({ id: 'plain', value: raw, permission: 'full' });
  insert.run({ id: 'hash-looking', value: hashLookingRaw, permission: 'readonly' });
  legacy.close();

  const storage = new TokenStorage(dbPath);

  expect(storage.findToken(raw)).toEqual({ id: 'plain', permission: 'full' });
  expect(storage.findToken(hashLookingRaw)).toEqual({
    id: 'hash-looking',
    permission: 'readonly',
  });
});
```

- [ ] **Step 2: Observe the collision failure**

Run: `bun test src/token/token-storage.spec.ts`

Expected: constructor throws `UNIQUE constraint failed: tokens.value`.

- [ ] **Step 3: Rebuild values inside the existing migration transaction**

Select complete records, delete the legacy rows, and insert their hashes:

```ts
const legacyTokens = this.#db
  .query<TokenRecord, Record<string, never>>('SELECT id, value, permission FROM tokens')
  .all({});
const insert = this.#db.query(
  'INSERT INTO tokens (id, value, permission) VALUES ($id, $value, $permission)',
);

const migrate = this.#db.transaction((tokens: TokenRecord[]) => {
  this.#db.run('DELETE FROM tokens');
  for (const token of tokens) {
    insert.run({ ...token, value: hashToken(token.value) });
  }
  this.#db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
});
migrate(legacyTokens);
```

Update `#migrateToHashedTokens` JSDoc to state that the table is rebuilt transactionally to avoid collisions between a new hash and another row's still-plaintext value.

- [ ] **Step 4: Add a readiness corruption regression**

```ts
it('fails readiness when the token table becomes unusable', async () => {
  const dbPath = await freshDbPath();
  const storage = new TokenStorage(dbPath);
  const corruptor = new Database(dbPath, { strict: true });
  corruptor.run('DROP TABLE tokens');
  corruptor.close();

  await expect(storage.checkReady()).rejects.toThrow();
});
```

- [ ] **Step 5: Verify it fails for the current `SELECT 1` probe**

Run: `bun test src/token/token-storage.spec.ts`

Expected: readiness resolves instead of rejecting.

- [ ] **Step 6: Probe the operational table**

```ts
/** Verify that the token table can serve the columns used by runtime operations. */
checkReady(): Promise<void> {
  this.#db.query('SELECT id, value, permission FROM tokens LIMIT 1').get();
  return Promise.resolve();
}
```

- [ ] **Step 7: Verify and commit**

Run:

```bash
bun test src/token/token-storage.spec.ts src/ready/get-ready.spec.ts
bun run typecheck
```

Expected: all token-storage and readiness tests pass.

```bash
git add src/token/token-storage.ts src/token/token-storage.spec.ts
git commit -m "fix(tokens): harden migration and readiness"
```

### Task 4: Reject fractional and unsafe integer configuration

**Files:**

- Modify: `src/main.ts`
- Modify: `e2e/startup-validation.e2e.spec.ts`
- Modify: `docs-site/src/content/docs/guides/configuration.md`

- [ ] **Step 1: Add a bounded startup helper**

Use one helper for all startup failures so a regression that starts the server cannot hang the suite:

```ts
async function runInvalidStartup(env: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'rc-startup-'));
  const proc = Bun.spawn(['bun', 'src/main.ts'], {
    env: {
      ...baseEnv(),
      ADMIN_TOKEN: 'e2e-admin-token-0123456789abcdef',
      PORT: '4014',
      CACHE_DIR: join(dir, 'cache'),
      TOKENS_DB_PATH: join(dir, 'tokens.sqlite'),
      ...env,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const result = await Promise.race([
    proc.exited.then((exitCode) => ({ exitCode })),
    Bun.sleep(1000).then(() => null),
  ]);
  if (!result) proc.kill();
  await proc.exited;
  const stderr = await new Response(proc.stderr).text();
  rmSync(dir, { recursive: true, force: true });
  return { exitCode: result?.exitCode ?? null, stderr };
}
```

Refactor the five existing cases to call this helper with their current environment overrides and keep their current message assertions.

- [ ] **Step 2: Add one shared integer-boundary test**

```ts
it('rejects fractional and unsafe integer settings', async () => {
  for (const [name, value] of [
    ['PORT', '4014.5'],
    ['MAX_UPLOAD_BYTES', '1.5'],
    ['SHUTDOWN_DRAIN_TIMEOUT_MS', '1.5'],
    ['CACHE_MAX_BYTES', '1.5'],
    ['CACHE_SWEEP_INTERVAL_MS', '1.5'],
    ['MAX_UPLOAD_BYTES', '9007199254740992'],
  ] as const) {
    const { exitCode, stderr } = await runInvalidStartup({ [name]: value });
    expect(exitCode).toBe(1);
    expect(stderr).toContain(name);
  }
});
```

- [ ] **Step 3: Observe the timeout failures**

Run: `bun test e2e/startup-validation.e2e.spec.ts`

Expected: affected cases return `exitCode: null` because the current server accepts them.

- [ ] **Step 4: Apply integer-specific validation**

```ts
function requirePositiveInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    logger.error(`Error: ${name} environment variable must be a positive integer.`);
    process.exit(1);
  }
}

if (!Number.isInteger(PORT) || PORT <= 0 || PORT >= 65536) {
  logger.error('Error: PORT environment variable must be a valid port number.');
  process.exit(1);
}

requirePositiveInteger('MAX_UPLOAD_BYTES', MAX_UPLOAD_BYTES);
requirePositiveInteger('SHUTDOWN_DRAIN_TIMEOUT_MS', SHUTDOWN_DRAIN_TIMEOUT_MS);
if (CACHE_MAX_BYTES !== undefined) requirePositiveInteger('CACHE_MAX_BYTES', CACHE_MAX_BYTES);
if (CACHE_TTL_HOURS !== undefined) requirePositiveNumber('CACHE_TTL_HOURS', CACHE_TTL_HOURS);
requirePositiveInteger('CACHE_SWEEP_INTERVAL_MS', CACHE_SWEEP_INTERVAL_MS);
```

- [ ] **Step 5: Update canonical configuration prose**

Use these exact purpose statements in the configuration table:

```markdown
| `PORT` | no | `3000` | HTTP port; must be an integer from 1 through 65535. |
| `MAX_UPLOAD_BYTES` | no | `524288000` (500 MiB) | Positive integer upload size cap in bytes for `PUT`; over the limit returns `413`. |
| `SHUTDOWN_DRAIN_TIMEOUT_MS` | no | `30000` | Positive integer maximum wait in milliseconds for in-flight requests on `SIGTERM`/`SIGINT`. |
| `CACHE_MAX_BYTES` | no | not set | Positive integer filesystem cache cap in bytes; the sweeper evicts least-recently-used entries until the cache fits. |
| `CACHE_SWEEP_INTERVAL_MS` | no | `60000` | Positive integer eviction sweep period in milliseconds; used only when a cap or TTL is set. |
```

Keep `CACHE_TTL_HOURS` as a positive number because fractional hours are valid.

- [ ] **Step 6: Verify and commit**

Run:

```bash
bun test e2e/startup-validation.e2e.spec.ts
bun run format
bun run lint
bun run typecheck
```

Expected: every startup case exits 1 within one second, and static gates pass.

```bash
git add src/main.ts e2e/startup-validation.e2e.spec.ts docs-site/src/content/docs/guides/configuration.md
git commit -m "fix(config): require integer byte and time limits"
```

### Task 5: Cover S3 credential and conditional-write failure behavior

**Files:**

- Modify: `src/cache/storage-strategy/s3.spec.ts`

- [ ] **Step 1: Generalize the existing strategy test group**

Rename `describe('S3Strategy readiness', ...)` to `describe('S3Strategy', ...)`. Keep its existing `createStrategy` factory and readiness cases inside that block so the write-path case below uses the same static configuration.

- [ ] **Step 2: Add provider refresh coalescing**

```ts
it('coalesces concurrent credential resolution', async () => {
  let providerCalls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  s3Prototype.exists = () => Promise.resolve(false);
  const strategy = new S3Strategy({
    bucket: 'bucket',
    credentials: async () => {
      providerCalls++;
      await gate;
      return {
        accessKeyId: 'access',
        secretAccessKey: 'secret',
        expiration: new Date(Date.now() + 30 * 60 * 1000),
      };
    },
  });

  const requests = Array.from({ length: 32 }, () => strategy.exists('hash'));
  release();

  await expect(Promise.all(requests)).resolves.toEqual(Array(32).fill(false));
  expect(providerCalls).toBe(1);
});
```

- [ ] **Step 3: Add provider recovery after failure**

```ts
it('retries credential resolution after a provider failure', async () => {
  let providerCalls = 0;
  s3Prototype.exists = () => Promise.resolve(true);
  const strategy = new S3Strategy({
    bucket: 'bucket',
    credentials: async () => {
      providerCalls++;
      if (providerCalls === 1) throw new Error('STS unavailable');
      return { accessKeyId: 'access', secretAccessKey: 'secret' };
    },
  });

  await expect(strategy.exists('hash')).rejects.toThrow('STS unavailable');
  await expect(strategy.exists('hash')).resolves.toBe(true);
  expect(providerCalls).toBe(2);
});
```

- [ ] **Step 4: Add the documented 501 failure contract**

Capture `fetch` beside the existing S3 prototype originals:

```ts
const originalFetch = globalThis.fetch;
```

Extend the existing `afterEach`:

```ts
globalThis.fetch = originalFetch;
```

Inside the renamed `S3Strategy` block, temporarily replace `globalThis.fetch` and assert:

```ts
globalThis.fetch = (async () =>
  new Response('conditional writes unsupported', { status: 501 })) as typeof fetch;

await expect(createStrategy().writeStream('hash', new Blob(['data']).stream(), 4)).rejects.toThrow(
  'does not support conditional writes',
);
```

- [ ] **Step 5: Verify no production change is needed**

Run:

```bash
bun test src/cache/storage-strategy/s3.spec.ts
bun run typecheck
```

Expected: all new tests pass against the existing implementation. Do not add delegation tests for `exists`, `size`, or `file().stream()` merely to raise coverage.

- [ ] **Step 6: Commit**

```bash
git add src/cache/storage-strategy/s3.spec.ts
git commit -m "test(s3): cover credential refresh failures"
```

### Task 6: Exercise bounded contention and real MinIO readiness

**Files:**

- Create: `e2e/request-boundaries.e2e.spec.ts`
- Modify: `e2e/concurrency.e2e.spec.ts`
- Modify: `e2e/s3-minio.e2e.spec.ts`

- [ ] **Step 1: Add focused HTTP boundary integration**

Create a server on port 4017 and add three cases:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { E2E_ADMIN_TOKEN, spawnServer, type SpawnedServer } from './spawn-server';

const PORT = 4017;
let server: SpawnedServer;

async function rawRequest(request: string): Promise<string> {
  let text = '';
  let settle!: (value: string) => void;
  const received = new Promise<string>((resolve) => {
    settle = resolve;
  });
  const socket = await Bun.connect({
    hostname: '127.0.0.1',
    port: PORT,
    socket: {
      data(_socket, data) {
        text += new TextDecoder().decode(data);
      },
      close() {
        settle(text);
      },
      error() {
        settle(text);
      },
    },
  });
  socket.write(request);
  const response = await Promise.race([received, Bun.sleep(5000).then(() => '__TIMEOUT__')]);
  socket.end();
  return response;
}

describe('request boundaries e2e', () => {
  beforeAll(async () => {
    server = await spawnServer(PORT);
  });

  afterAll(async () => {
    await server?.stop();
  });

  it('rejects malformed bearer credentials', async () => {
    for (const authorization of ['Basic token', 'Bearer', 'Bearer   ', 'Token value']) {
      const response = await fetch(`${server.baseUrl}/v1/admin/tokens`, {
        headers: { Authorization: authorization },
      });
      expect(response.status).toBe(403);
    }
  });

  it('never resolves an encoded traversal target outside the cache directory', async () => {
    const response = await fetch(`${server.baseUrl}/v1/cache/..%2Fescape`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${E2E_ADMIN_TOKEN}` },
      body: 'data',
    });

    expect([400, 404]).toContain(response.status);
    expect(await Bun.file(join(server.dir, 'escape')).exists()).toBe(false);
  });

  it('rejects duplicate Content-Length without committing an artifact', async () => {
    const hash = 'duplicatelengthhash';
    const response = await rawRequest(
      `PUT /v1/cache/${hash} HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${PORT}\r\n` +
        `Authorization: Bearer ${E2E_ADMIN_TOKEN}\r\n` +
        `Content-Length: 4\r\n` +
        `Content-Length: 5\r\n` +
        `Connection: close\r\n\r\n` +
        `data`,
    );
    expect(response.split('\r\n')[0]).toContain('400');

    const get = await fetch(`${server.baseUrl}/v1/cache/${hash}`, {
      headers: { Authorization: `Bearer ${E2E_ADMIN_TOKEN}` },
    });
    expect(get.status).toBe(404);
  });
});
```

- [ ] **Step 2: Add a 32-client same-hash burst**

```ts
it('preserves one intact artifact under a 32-client burst', async () => {
  const hash = 'burstputhash01';
  const bodies = Array.from({ length: 32 }, (_, index) => new Uint8Array(64 * 1024).fill(index));
  const responses = await Promise.all(
    bodies.map((body) =>
      fetch(`${server.baseUrl}/v1/cache/${hash}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${E2E_ADMIN_TOKEN}` },
        body,
      }),
    ),
  );

  expect(responses.filter(({ status }) => status === 200)).toHaveLength(1);
  expect(responses.filter(({ status }) => status === 409)).toHaveLength(31);

  const get = await fetch(`${server.baseUrl}/v1/cache/${hash}`, {
    headers: { Authorization: `Bearer ${E2E_ADMIN_TOKEN}` },
  });
  const stored = new Uint8Array(await get.arrayBuffer());
  expect(stored).toHaveLength(64 * 1024);
  expect(stored.every((byte) => byte === stored[0])).toBe(true);
});
```

- [ ] **Step 3: Add MinIO readiness**

```ts
it('reports ready when the configured bucket is reachable', async () => {
  const response = await fetch(`${server.baseUrl}/ready`);

  expect(response.status).toBe(200);
  expect(await response.text()).toBe('OK');
});
```

- [ ] **Step 4: Verify local HTTP boundaries and contention**

Run:

```bash
bun test e2e/request-boundaries.e2e.spec.ts e2e/concurrency.e2e.spec.ts
```

Expected: all boundary cases pass, the burst returns one 200 and 31 conflicts, and the stored artifact is byte-uniform.

- [ ] **Step 5: Start the pinned MinIO container and create its bucket**

```bash
if docker ps -a --format '{{.Names}}' | rg -x 'remotecache-adv-review-minio-20260729'; then
  printf 'Dedicated MinIO container name is already in use; stop and inspect it first.\n'
  exit 1
fi
if lsof -nP -iTCP:9000 -sTCP:LISTEN | rg .; then
  printf 'Port 9000 is already in use; do not disturb the existing listener.\n'
  exit 1
fi

minio_container_id=$(docker run --rm -d \
  --name remotecache-adv-review-minio-20260729 \
  -p 9000:9000 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  minio/minio:RELEASE.2025-09-07T16-13-09Z server /data)

for attempt in {1..30}; do
  curl -fsS http://127.0.0.1:9000/minio/health/live && break
  if [ "$attempt" -eq 30 ]; then docker logs "$minio_container_id"; exit 1; fi
  sleep 1
done

docker exec "$minio_container_id" \
  mc alias set local http://127.0.0.1:9000 minioadmin minioadmin
docker exec "$minio_container_id" mc mb local/remotecache-e2e
```

- [ ] **Step 6: Run every MinIO case without skips**

```bash
S3_E2E_ENDPOINT=http://127.0.0.1:9000 bun test e2e/s3-minio.e2e.spec.ts
```

Expected: every named MinIO test passes and the summary reports zero skips.

- [ ] **Step 7: Stop only the container started above**

```bash
docker stop "$minio_container_id"
```

Because the container uses `--rm`, stopping its captured ID removes it without touching other containers.

- [ ] **Step 8: Commit**

```bash
git add e2e/request-boundaries.e2e.spec.ts \
  e2e/concurrency.e2e.spec.ts \
  e2e/s3-minio.e2e.spec.ts
git commit -m "test: add bounded integration coverage"
```

### Task 7: Prune weak tests and complete verification

**Files:**

- Modify: `src/cache/is-valid-hash.spec.ts`
- Modify: `src/token/add-token.spec.ts`
- Modify: `src/token/hash-token.spec.ts`
- Modify: `docs/superpowers/reviews/2026-07-29-adversarial-test-sweep.md`
- Verify: matching JSDoc and canonical docs for each production behavior changed above

- [ ] **Step 1: Complete the compact malformed-input partitions**

Extend the existing out-of-charset hash case without adding separate tests:

```ts
for (const hash of ['has space', 'ümlaut', 'line\nbreak', 'null\0byte', 'foo%2Fbar']) {
  expect(isValidHash(hash)).toBe(false);
}
```

Replace the scalar-only token-body test with this record-shape partition:

```ts
it('rejects JSON values that are not token records', async () => {
  const storage = { addToken: mock() };

  for (const value of [null, 'not-object', 42, true, [], {}]) {
    const response = await addToken(true, storage, mock().mockResolvedValue(value));
    expect(response.status).toBe(400);
  }

  expect(storage.addToken).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Replace four wrapper-property tests with one known vector**

```ts
import { describe, expect, it } from 'bun:test';
import { hashToken } from './hash-token';

describe('hashToken', () => {
  it('returns the lowercase SHA-256 digest of the UTF-8 token', () => {
    expect(hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
```

The at-rest token test continues to prove that plaintext is not stored; the removed tests duplicated properties guaranteed by this exact digest.

- [ ] **Step 3: Run focused and full suites**

```bash
bun test src/cache/is-valid-hash.spec.ts src/token/add-token.spec.ts src/token/hash-token.spec.ts
bun test
bun test --coverage
```

Expected: zero failures; only the endpoint-gated MinIO file skips in the ordinary run.

- [ ] **Step 4: Repeat race-sensitive suites 20 times**

```bash
for run in {1..20}; do
  bun test e2e/concurrency.e2e.spec.ts src/cache/eviction.spec.ts \
    src/cache/storage-strategy/file-system.spec.ts || exit 1
done
```

Expected: all 20 iterations pass without timeouts or intermittent status/count differences.

- [ ] **Step 5: Repeat the MinIO race file 20 times**

Start the pinned container and bucket with Task 6's exact commands, then run:

```bash
for run in {1..20}; do
  S3_E2E_ENDPOINT=http://127.0.0.1:9000 \
    bun test e2e/s3-minio.e2e.spec.ts || exit 1
done
```

Expected: all iterations execute with zero skips and zero failures. Stop the captured container ID afterward.

- [ ] **Step 6: Finish the risk dispositions**

Re-check every planned disposition in the review ledger and replace it with the observed outcome:

- the exact retained or added test that protects the risk;
- the production defect and regression test that fixed it; or
- a concrete bounded-environment reason the risk was not tested.

Record before-and-after test counts, coverage, removed tests, Docker evidence, race repetition counts, and any remaining uncertainty. Run the required humanizer pass on this prose artifact without changing technical facts.

- [ ] **Step 7: Run final repository gates**

```bash
bun run format
bun run format --check
bun run lint
bun run typecheck
bun test
bun test --coverage
git diff --check
git status --short
```

Expected: every command passes; only documented MinIO skips appear in the ordinary suite; the worktree contains only intentional changes.

- [ ] **Step 8: Request code review**

Use `superpowers:requesting-code-review` against the design, this plan, the complete diff, and the final verification output. Address only findings that trace to the approved sweep.

- [ ] **Step 9: Commit the cleanup and final report**

```bash
git add src/cache/is-valid-hash.spec.ts \
  src/token/add-token.spec.ts \
  src/token/hash-token.spec.ts \
  docs/superpowers/reviews/2026-07-29-adversarial-test-sweep.md
git commit -m "test: complete adversarial sweep"
```

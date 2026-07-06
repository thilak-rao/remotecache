import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { E2E_ADMIN_TOKEN, spawnServer, type SpawnedServer } from './spawn-server';

// Skipped unless S3_E2E_ENDPOINT is set. Run locally with:
//   docker run -d --name minio -p 9000:9000 \
//     -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin \
//     minio/minio:RELEASE.2025-09-07T16-13-09Z server /data
//   AWS_ACCESS_KEY_ID=minioadmin AWS_SECRET_ACCESS_KEY=minioadmin \
//     aws --endpoint-url http://127.0.0.1:9000 --region us-east-1 s3 mb s3://remotecache-e2e
//   S3_E2E_ENDPOINT=http://127.0.0.1:9000 bun test e2e/s3-minio.e2e.spec.ts
const ENDPOINT = Bun.env.S3_E2E_ENDPOINT;
const PORT = 4016;
// Unique per run: bucket contents persist across runs and writes are
// append-only, so a fixed hash would 409 on the second run.
const nonce = crypto.randomUUID().replaceAll('-', '').slice(0, 12);

const authHeaders = { Authorization: `Bearer ${E2E_ADMIN_TOKEN}` };

interface RawConnection {
  write: (data: string | Uint8Array) => void;
  end: () => void;
  response: Promise<string>;
}

async function openConnection(): Promise<RawConnection> {
  let text = '';
  let resolved = false;
  let resolveResponse: (v: string) => void;
  const received = new Promise<string>((resolve) => {
    resolveResponse = resolve;
  });
  const settle = () => {
    if (resolved) return;
    resolved = true;
    resolveResponse(text);
  };
  const socket = await Bun.connect({
    hostname: '127.0.0.1',
    port: PORT,
    socket: {
      data(_s, data) {
        text += new TextDecoder().decode(data);
        if (text.includes('\r\n')) settle();
      },
      close: settle,
      error: settle,
    },
  });
  return {
    write: (data) => void socket.write(data),
    end: () => socket.end(),
    response: Promise.race([received, Bun.sleep(10000).then(() => '__TIMEOUT__')]),
  };
}

const putHead = (hash: string, contentLength: number) =>
  `PUT /v1/cache/${hash} HTTP/1.1\r\n` +
  `Host: 127.0.0.1:${PORT}\r\n` +
  `Authorization: Bearer ${E2E_ADMIN_TOKEN}\r\n` +
  `Content-Length: ${contentLength}\r\n` +
  `Connection: close\r\n\r\n`;

describe.skipIf(!ENDPOINT)('s3 storage e2e (MinIO)', () => {
  let server: SpawnedServer;

  beforeAll(async () => {
    server = await spawnServer(PORT, {
      STORAGE_STRATEGY: 's3',
      S3_BUCKET: Bun.env.S3_E2E_BUCKET ?? 'remotecache-e2e',
      S3_REGION: 'us-east-1',
      S3_ENDPOINT: ENDPOINT as string,
      S3_ACCESS_KEY_ID: Bun.env.S3_E2E_ACCESS_KEY ?? 'minioadmin',
      S3_SECRET_ACCESS_KEY: Bun.env.S3_E2E_SECRET_KEY ?? 'minioadmin',
    });
  });

  afterAll(async () => {
    await server?.stop();
  });

  it('round-trips a large artifact intact', async () => {
    const hash = `s3large${nonce}`;
    // 6 MiB is large enough to catch buffering and streaming regressions.
    const body = new Uint8Array(6 * 1024 * 1024).map((_, i) => i % 251);

    const put = await fetch(`${server.baseUrl}/v1/cache/${hash}`, {
      method: 'PUT',
      headers: authHeaders,
      body,
    });
    expect(put.status).toBe(200);

    const get = await fetch(`${server.baseUrl}/v1/cache/${hash}`, { headers: authHeaders });
    expect(get.status).toBe(200);
    // No Content-Length assertion here: Bun.serve streams a ReadableStream body
    // with Transfer-Encoding: chunked (no Content-Length) for BOTH backends,
    // filesystem included, so this would assert a property Bun 1.3.14 cannot
    // provide. Upstream Bun PR #27262 (closed unmerged) tracks preserving a
    // user-set Content-Length on streamed responses. The byte-exact check below
    // is the real integrity proof.
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(body);
  }, 60000);

  it('returns 409 for a second upload of the same hash', async () => {
    const hash = `s3conflict${nonce}`;
    const body = new Uint8Array(1024).fill(1);

    const first = await fetch(`${server.baseUrl}/v1/cache/${hash}`, {
      method: 'PUT',
      headers: authHeaders,
      body,
    });
    expect(first.status).toBe(200);

    const second = await fetch(`${server.baseUrl}/v1/cache/${hash}`, {
      method: 'PUT',
      headers: authHeaders,
      body,
    });
    expect(second.status).toBe(409);
  }, 30000);

  it('resolves concurrent same-hash uploads to one stored artifact', async () => {
    const hash = `s3concurrent${nonce}`;
    const bodyA = new Uint8Array(64 * 1024).fill(65);
    const bodyB = new Uint8Array(64 * 1024).fill(66);

    const [first, second] = await Promise.all([
      fetch(`${server.baseUrl}/v1/cache/${hash}`, {
        method: 'PUT',
        headers: authHeaders,
        body: bodyA,
      }),
      fetch(`${server.baseUrl}/v1/cache/${hash}`, {
        method: 'PUT',
        headers: authHeaders,
        body: bodyB,
      }),
    ]);

    expect([first.status, second.status].toSorted()).toEqual([200, 409]);
    const get = await fetch(`${server.baseUrl}/v1/cache/${hash}`, { headers: authHeaders });
    expect(get.status).toBe(200);
    const stored = new Uint8Array(await get.arrayBuffer());
    expect([bodyA[0], bodyB[0]]).toContain(stored[0]);
    expect(stored.every((byte) => byte === stored[0])).toBe(true);
  }, 30000);

  it('keeps the winning object when a concurrent failed upload aborts', async () => {
    const hash = `s3failedrace${nonce}`;
    const declared = 6 * 1024 * 1024;
    const failed = await openConnection();
    failed.write(putHead(hash, declared));
    failed.write(new Uint8Array(1024 * 1024).fill(9));
    await Bun.sleep(200);

    const winnerBody = new Uint8Array(1024).fill(3);
    const winner = await fetch(`${server.baseUrl}/v1/cache/${hash}`, {
      method: 'PUT',
      headers: authHeaders,
      body: winnerBody,
    });
    expect(winner.status).toBe(200);

    failed.end();
    await failed.response;
    await Bun.sleep(1000);

    const get = await fetch(`${server.baseUrl}/v1/cache/${hash}`, { headers: authHeaders });
    expect(get.status).toBe(200);
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(winnerBody);
  }, 30000);

  it('returns 404 for a missing hash', async () => {
    const res = await fetch(`${server.baseUrl}/v1/cache/s3missing${nonce}`, {
      headers: authHeaders,
    });
    expect(res.status).toBe(404);
  });

  it('does not commit an object when the client disconnects mid-body', async () => {
    const hash = `s3truncated${nonce}`;
    const declared = 6 * 1024 * 1024;
    // Raw socket: declare 6 MiB, send 1 MiB, hang up. The strategy must not
    // leave a truncated object behind.
    const socket = await Bun.connect({
      hostname: '127.0.0.1',
      port: PORT,
      socket: { data() {}, close() {}, error() {} },
    });
    socket.write(
      `PUT /v1/cache/${hash} HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${PORT}\r\n` +
        `Authorization: Bearer ${E2E_ADMIN_TOKEN}\r\n` +
        `Content-Length: ${declared}\r\n` +
        `Connection: close\r\n\r\n`,
    );
    socket.write(new Uint8Array(1024 * 1024).fill(2));
    await Bun.sleep(200);
    socket.end();
    await Bun.sleep(1000);

    const res = await fetch(`${server.baseUrl}/v1/cache/${hash}`, { headers: authHeaders });
    expect(res.status).toBe(404);
  }, 30000);
});

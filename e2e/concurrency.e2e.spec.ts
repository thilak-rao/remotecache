import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { E2E_ADMIN_TOKEN, spawnServer, type SpawnedServer } from './spawn-server';

const PORT = 4015;

interface RawConnection {
  write: (data: string | Uint8Array) => void;
  end: () => void;
  response: Promise<string>;
}

// Raw TCP so a request body can be streamed in stages; fetch() buffers the
// body, which would let one PUT fully commit before the other starts.
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
        // Bun.serve keeps a normally-completed connection open (it only
        // force-closes on early-rejection paths), so waiting for `close` would
        // hang past the timeout. The status line is all the tests read, and it
        // arrives with the first `\r\n`; resolve then. Mirrors the 413 socket test.
        if (text.includes('\r\n')) settle();
      },
      close() {
        settle();
      },
      error() {
        settle();
      },
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

describe('cache concurrency e2e', () => {
  let server: SpawnedServer;

  beforeAll(async () => {
    server = await spawnServer(PORT);
  });

  afterAll(async () => {
    await server?.stop();
  });

  it('resolves two concurrent uploads of one hash to a single 200 and a 409', async () => {
    const hash = 'concurrentputhash01';
    const size = 64 * 1024;
    const bodyA = new Uint8Array(size).fill(65); // 'A'
    const bodyB = new Uint8Array(size).fill(66); // 'B'

    const a = await openConnection();
    const b = await openConnection();

    // Interleave so both requests pass the exists() check before either commits.
    a.write(putHead(hash, size));
    b.write(putHead(hash, size));
    a.write(bodyA.slice(0, size / 2));
    b.write(bodyB.slice(0, size / 2));
    await Bun.sleep(150);
    a.write(bodyA.slice(size / 2));
    b.write(bodyB.slice(size / 2));

    const statuses = [await a.response, await b.response].map((r) => r.split(' ')[1]);
    expect(statuses.toSorted()).toEqual(['200', '409']);

    const res = await fetch(`${server.baseUrl}/v1/cache/${hash}`, {
      headers: { Authorization: `Bearer ${E2E_ADMIN_TOKEN}` },
    });
    expect(res.status).toBe(200);
    const stored = new Uint8Array(await res.arrayBuffer());
    expect(stored.length).toBe(size);
    // First-writer-wins must commit one intact artifact, never an interleaving.
    const first = stored[0];
    expect(stored.every((byte) => byte === first)).toBe(true);
  }, 20000);

  it('never stores a truncated upload after a client disconnect mid-body', async () => {
    const hash = 'truncatedputhash01';
    const conn = await openConnection();
    conn.write(putHead(hash, 1000));
    conn.write(new Uint8Array(500).fill(67));
    conn.end();
    await conn.response;
    await Bun.sleep(300);

    const res = await fetch(`${server.baseUrl}/v1/cache/${hash}`, {
      headers: { Authorization: `Bearer ${E2E_ADMIN_TOKEN}` },
    });
    expect(res.status).toBe(404);
  }, 15000);
});

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { E2E_ADMIN_TOKEN, spawnServer, type SpawnedServer } from './spawn-server';

const PORT = 4013;
const MAX = 150 * 1024 * 1024; // 150 MiB — above Bun's 128 MiB default cap

describe('upload limits e2e', () => {
  let server: SpawnedServer;

  beforeAll(async () => {
    server = await spawnServer(PORT, { MAX_UPLOAD_BYTES: String(MAX) });
  });

  afterAll(async () => {
    await server.stop();
  });

  it('accepts an upload between 128 MiB and MAX_UPLOAD_BYTES', async () => {
    const body = new Uint8Array(140 * 1024 * 1024);
    const res = await fetch(`${server.baseUrl}/v1/cache/largeuploadhash01`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${E2E_ADMIN_TOKEN}` },
      body,
    });
    expect(res.status).toBe(200);
  }, 30000);

  it('rejects a declared Content-Length above MAX_UPLOAD_BYTES with 413', async () => {
    // Raw socket: declare the oversize length without allocating a body —
    // the server must reject on the header alone.
    let responseText = '';
    let resolveResponse: (v: string) => void;
    const responsePromise = new Promise<string>((resolve) => {
      resolveResponse = resolve;
    });
    const socket = await Bun.connect({
      hostname: '127.0.0.1',
      port: PORT,
      socket: {
        data(_s, data) {
          responseText += new TextDecoder().decode(data);
        },
        close() {
          // The request sends Connection: close, so the full response
          // (headers and body) has arrived once the server closes.
          resolveResponse(responseText);
        },
        error() {
          resolveResponse(responseText);
        },
      },
    });
    socket.write(
      `PUT /v1/cache/oversizedeclare01 HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${PORT}\r\n` +
        `Authorization: Bearer ${E2E_ADMIN_TOKEN}\r\n` +
        `Content-Length: ${MAX + 1}\r\n` +
        `Connection: close\r\n\r\n`,
    );

    const response = await Promise.race([
      responsePromise,
      Bun.sleep(5000).then(() => '__TIMEOUT__'),
    ]);
    socket.end();
    expect(response.split('\r\n')[0]).toContain('413');
    // Pin the response to remotecache's handler rather than Bun's default
    // 128 MiB body backstop, which would answer with a different message.
    expect(response).toContain(`Upload exceeds the maximum allowed size of ${MAX} bytes`);
  });
});

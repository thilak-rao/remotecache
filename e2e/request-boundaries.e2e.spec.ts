import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { E2E_ADMIN_TOKEN, spawnServer, type SpawnedServer } from './spawn-server';

const PORT = 4019;
const RAW_REQUEST_TIMEOUT = Symbol('raw request timeout');

async function rawRequest(request: string, settleAfterHeaders = false): Promise<string> {
  // A streaming decoder keeps multi-byte sequences intact across chunks.
  const decoder = new TextDecoder();
  const received = Promise.withResolvers<void>();
  let responseText = '';

  const socket = await Bun.connect({
    hostname: '127.0.0.1',
    port: PORT,
    socket: {
      data(_socket, data) {
        responseText += decoder.decode(data, { stream: true });
        if (settleAfterHeaders && responseText.includes('\r\n\r\n')) received.resolve();
      },
      close: () => received.resolve(),
      error: () => received.resolve(),
    },
  });

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    socket.write(request);
    const result = await Promise.race([
      received.promise,
      new Promise<typeof RAW_REQUEST_TIMEOUT>((resolve) => {
        timeout = setTimeout(() => resolve(RAW_REQUEST_TIMEOUT), 5000);
      }),
    ]);
    if (result === RAW_REQUEST_TIMEOUT) {
      throw new Error('raw HTTP request timed out after 5000ms');
    }
  } finally {
    if (timeout) clearTimeout(timeout);
    socket.close();
  }

  return responseText;
}

describe('request boundaries e2e', () => {
  let server: SpawnedServer;

  beforeAll(async () => {
    server = await spawnServer(PORT);
  });

  afterAll(async () => {
    await server?.stop();
  });

  it('rejects malformed Authorization values', async () => {
    for (const authorization of ['Basic token', 'Bearer', 'Bearer   ', 'Token value']) {
      const response = await fetch(`${server.baseUrl}/v1/admin/tokens`, {
        headers: { Authorization: authorization },
      });

      expect(response.status).toBe(403);
    }
  });

  it('does not allow an encoded cache hash to escape the cache directory', async () => {
    const response = await fetch(`${server.baseUrl}/v1/cache/..%2Fescape`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${E2E_ADMIN_TOKEN}` },
      body: 'data',
    });

    expect([400, 404]).toContain(response.status);
    expect(existsSync(join(server.dir, 'escape'))).toBe(false);
  });

  it('commits a valid raw HTTP upload for a later exact read', async () => {
    const hash = 'rawputbodyhash';
    const response = await rawRequest(
      `PUT /v1/cache/${hash} HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${PORT}\r\n` +
        `Authorization: Bearer ${E2E_ADMIN_TOKEN}\r\n` +
        `Content-Length: 4\r\n` +
        `Connection: close\r\n\r\n` +
        `data`,
      true,
    );

    expect(response.split('\r\n')[0]).toContain('200');

    const get = await fetch(`${server.baseUrl}/v1/cache/${hash}`, {
      headers: { Authorization: `Bearer ${E2E_ADMIN_TOKEN}` },
    });
    expect(get.status).toBe(200);
    expect(await get.text()).toBe('data');
  }, 10000);

  it('rejects conflicting Content-Length headers without committing an artifact', async () => {
    const response = await rawRequest(
      `PUT /v1/cache/duplicatelengthhash HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${PORT}\r\n` +
        `Authorization: Bearer ${E2E_ADMIN_TOKEN}\r\n` +
        `Content-Length: 4\r\n` +
        `Content-Length: 5\r\n` +
        `Connection: close\r\n\r\n` +
        `data`,
    );

    expect(response.split('\r\n')[0]).toContain('400');

    const get = await fetch(`${server.baseUrl}/v1/cache/duplicatelengthhash`, {
      headers: { Authorization: `Bearer ${E2E_ADMIN_TOKEN}` },
    });
    expect(get.status).toBe(404);
  }, 10000);
});

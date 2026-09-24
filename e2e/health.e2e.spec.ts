import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { runHealthcheck, spawnServer, type SpawnedServer } from './spawn-server';

const PORT = 4010;

describe('health endpoint e2e', () => {
  let server: SpawnedServer;

  beforeAll(async () => {
    server = await spawnServer(PORT);
  });

  afterAll(async () => {
    await server?.stop();
  });

  it('returns OK without authentication', async () => {
    const response = await fetch(`${server.baseUrl}/health`);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/plain');
    expect(await response.text()).toBe('OK');
  });

  it('reports healthy from the container probe despite an inherited proxy', async () => {
    // Containers often inherit an outbound proxy; routing the loopback probe
    // through it would report the container unhealthy forever.
    const probe = await runHealthcheck({ HTTP_PROXY: 'http://127.0.0.1:9', PORT: String(PORT) });

    expect(probe).toEqual({ exitCode: 0, stderr: '' });
  });
});

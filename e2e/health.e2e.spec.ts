import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { spawnServer, type SpawnedServer } from './spawn-server';

describe('health endpoint e2e', () => {
  let server: SpawnedServer;

  beforeAll(async () => {
    server = await spawnServer(4010);
  });

  afterAll(async () => {
    await server.stop();
  });

  it('returns OK without authentication', async () => {
    const response = await fetch(`${server.baseUrl}/health`);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/plain');
    expect(await response.text()).toBe('OK');
  });
});

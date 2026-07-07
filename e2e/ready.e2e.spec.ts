import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { spawnServer, type SpawnedServer } from './spawn-server';

describe('ready endpoint e2e', () => {
  let server: SpawnedServer | undefined;

  beforeAll(async () => {
    server = await spawnServer(4018);
  });

  afterAll(async () => {
    await server?.stop();
  });

  it('returns OK without authentication when dependencies are ready', async () => {
    if (!server) throw new Error('server did not start');
    const response = await fetch(`${server.baseUrl}/ready`);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/plain');
    expect(await response.text()).toBe('OK');
  });
});

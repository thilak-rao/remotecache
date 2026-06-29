import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let baseUrl: string;
const adminToken = Bun.env.ADMIN_TOKEN ?? 'admin-token';

mock.module('../src/logger', () => ({ logger: console }));

describe('health endpoint e2e', () => {
  beforeAll(async () => {
    Bun.env.ADMIN_TOKEN = adminToken;
    Bun.env.CACHE_DIR = join(tmpdir(), `nx-cache-health-e2e-${randomUUID()}`);
    Bun.env.PORT = '4010';

    // Dynamic import keeps the env vars and logger mock in place before src/main starts the server.
    const { server } = await import('../src/main');
    baseUrl = server.url.origin;
  });

  it('returns OK without authentication', async () => {
    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/plain');
    expect(await response.text()).toBe('OK');
  });
});

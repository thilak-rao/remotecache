import { describe, expect, it, beforeAll, mock } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let baseUrl: string;
const adminToken = Bun.env.ADMIN_TOKEN ?? 'admin-token';

mock.module('../src/logger', () => ({ logger: console }));

const requestWithAuth = (path: string, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  if (!headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${adminToken}`);
  }
  return fetch(`${baseUrl}${path}`, { ...init, headers });
};

describe('token management e2e', () => {
  beforeAll(async () => {
    const tmpBase = join(tmpdir(), `nx-cache-e2e-${randomUUID()}`);
    Bun.env.CACHE_DIR = tmpBase;
    Bun.env.ADMIN_TOKEN = adminToken;
    Bun.env.PORT = '4010';

    await fs.rm('nx-cache-server-tokens.sqlite', { force: true });

    const { server } = await import('../src/main');
    baseUrl = server.url.origin;
  });

  it('lists empty, adds token, lists with token, deletes, and lists empty again', async () => {
    // Initial list should be empty
    const listEmpty = await requestWithAuth('/v1/admin/tokens');
    expect(listEmpty.status).toBe(200);
    const initial = await listEmpty.json();
    expect(initial).toEqual({ tokens: [] });

    // Add token
    const tokenId = `token-${randomUUID()}`;
    const addRes = await requestWithAuth('/v1/admin/tokens', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ id: tokenId, permission: 'readonly' }),
    });
    expect(addRes.status).toBe(200);
    const added = await addRes.json();
    expect(added.id).toBe(tokenId);
    expect(added.permission).toBe('readonly');
    expect(typeof added.value).toBe('string');

    const tokenValue = added.value as string;

    // List returns id + permission only; the token value is never exposed
    const listAfterAdd = await requestWithAuth('/v1/admin/tokens');
    expect(listAfterAdd.status).toBe(200);
    const afterAdd = await listAfterAdd.json();
    expect(afterAdd.tokens).toHaveLength(1);
    expect(afterAdd.tokens[0]).toEqual({ id: tokenId, permission: 'readonly' });

    // Delete token using the real token value
    const delRes = await requestWithAuth(`/v1/admin/tokens/${encodeURIComponent(tokenValue)}`, {
      method: 'DELETE',
    });
    expect(delRes.status).toBe(204);

    // List should be empty again
    const listAfterDelete = await requestWithAuth('/v1/admin/tokens');
    expect(listAfterDelete.status).toBe(200);
    const finalList = await listAfterDelete.json();
    expect(finalList).toEqual({ tokens: [] });
  });
});

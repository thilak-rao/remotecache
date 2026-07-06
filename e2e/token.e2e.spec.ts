import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { E2E_ADMIN_TOKEN, spawnServer, type SpawnedServer } from './spawn-server';

let server: SpawnedServer;

const requestWithAuth = (path: string, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  if (!headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${E2E_ADMIN_TOKEN}`);
  }
  return fetch(`${server.baseUrl}${path}`, { ...init, headers });
};

describe('token management e2e', () => {
  beforeAll(async () => {
    server = await spawnServer(4012);
  });

  afterAll(async () => {
    await server.stop();
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: tokenId, permission: 'readonly' }),
    });
    expect(addRes.status).toBe(200);
    const added = await addRes.json();
    expect(added.id).toBe(tokenId);
    expect(added.permission).toBe('readonly');
    expect(typeof added.value).toBe('string');

    // List returns id + permission only; the token value is never exposed
    const listAfterAdd = await requestWithAuth('/v1/admin/tokens');
    expect(listAfterAdd.status).toBe(200);
    const afterAdd = await listAfterAdd.json();
    expect(afterAdd.tokens).toHaveLength(1);
    expect(afterAdd.tokens[0]).toEqual({ id: tokenId, permission: 'readonly' });

    // Delete token by its id — the value is never needed (or wanted) in a URL
    const delRes = await requestWithAuth(`/v1/admin/tokens/${encodeURIComponent(tokenId)}`, {
      method: 'DELETE',
    });
    expect(delRes.status).toBe(204);

    // Deleting the same id again is a 404
    const delAgain = await requestWithAuth(`/v1/admin/tokens/${encodeURIComponent(tokenId)}`, {
      method: 'DELETE',
    });
    expect(delAgain.status).toBe(404);

    // List should be empty again
    const listAfterDelete = await requestWithAuth('/v1/admin/tokens');
    expect(listAfterDelete.status).toBe(200);
    const finalList = await listAfterDelete.json();
    expect(finalList).toEqual({ tokens: [] });
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { E2E_ADMIN_TOKEN, metricValue, spawnServer, type SpawnedServer } from './spawn-server';

let server: SpawnedServer;

const randomHash = () => randomUUID().replace(/-/g, '');

const withAdmin = (path: string, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${E2E_ADMIN_TOKEN}`);
  return fetch(`${server.baseUrl}${path}`, { ...init, headers });
};

describe('metrics endpoint e2e', () => {
  beforeAll(async () => {
    server = await spawnServer(4011);
  });

  afterAll(async () => {
    await server?.stop();
  });

  it('counts hits, misses, stores, CREEP-blocked writes, and uploaded bytes', async () => {
    const hash = randomHash();
    const body = 'hello-metrics';

    const miss = await withAdmin(`/v1/cache/${hash}`);
    expect(miss.status).toBe(404);

    // An unauthenticated write is rejected the same way a read-only (CREEP)
    // token is — both increment the PUT "forbidden" counter.
    const blocked = await fetch(`${server.baseUrl}/v1/cache/${randomHash()}`, {
      method: 'PUT',
      headers: { 'Content-Length': '4' },
      body: 'evil',
    });
    expect(blocked.status).toBe(403);

    const store = await withAdmin(`/v1/cache/${hash}`, {
      method: 'PUT',
      headers: { 'Content-Length': String(Buffer.byteLength(body)) },
      body,
    });
    expect(store.status).toBe(200);

    const hit = await withAdmin(`/v1/cache/${hash}`);
    expect(hit.status).toBe(200);

    const res = await fetch(`${server.baseUrl}/metrics`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/plain');
    const text = await res.text();

    expect(
      metricValue(text, 'nx_cache_requests_total{method="GET",result="hit"}'),
    ).toBeGreaterThanOrEqual(1);
    expect(
      metricValue(text, 'nx_cache_requests_total{method="GET",result="miss"}'),
    ).toBeGreaterThanOrEqual(1);
    expect(
      metricValue(text, 'nx_cache_requests_total{method="PUT",result="stored"}'),
    ).toBeGreaterThanOrEqual(1);
    expect(
      metricValue(text, 'nx_cache_requests_total{method="PUT",result="forbidden"}'),
    ).toBeGreaterThanOrEqual(1);
    expect(metricValue(text, 'nx_cache_uploaded_bytes_total')).toBeGreaterThanOrEqual(
      Buffer.byteLength(body),
    );
  });
});

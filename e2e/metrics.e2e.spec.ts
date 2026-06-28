import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let baseUrl: string;
// Match token.e2e's defaults so the two specs share one server instance: bun
// test shares a module registry, so whichever spec imports `../src/main` first
// starts the server, and the other reuses it. Aligning the port + admin token
// (and reading the exported server.url) keeps both order-independent.
const adminToken = Bun.env.ADMIN_TOKEN ?? 'admin-token';

mock.module('../src/logger', () => ({ logger: console }));

const randomHash = () => randomUUID().replace(/-/g, '');

const withAdmin = (path: string, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${adminToken}`);
  return fetch(`${baseUrl}${path}`, { ...init, headers });
};

function metricValue(text: string, series: string): number {
  const line = text.split('\n').find((l) => l.startsWith(series));
  return line ? Number(line.slice(series.length).trim()) : 0;
}

describe('metrics endpoint e2e', () => {
  beforeAll(async () => {
    Bun.env.ADMIN_TOKEN = adminToken;
    Bun.env.CACHE_DIR = join(tmpdir(), `nx-cache-metrics-e2e-${randomUUID()}`);
    Bun.env.PORT = '4010';

    const { server } = await import('../src/main');
    baseUrl = server.url.origin;
  });

  it('counts hits, misses, stores, CREEP-blocked writes, and uploaded bytes', async () => {
    const hash = randomHash();
    const body = 'hello-metrics';

    const miss = await withAdmin(`/v1/cache/${hash}`);
    expect(miss.status).toBe(404);

    // An unauthenticated write is rejected the same way a read-only (CREEP)
    // token is — both increment the PUT "forbidden" counter.
    const blocked = await fetch(`${baseUrl}/v1/cache/${randomHash()}`, {
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

    const res = await fetch(`${baseUrl}/metrics`);
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

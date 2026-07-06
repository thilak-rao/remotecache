import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { E2E_ADMIN_TOKEN, metricValue, spawnServer, type SpawnedServer } from './spawn-server';

const PORT = 4017;

describe('cache eviction e2e', () => {
  let server: SpawnedServer;

  beforeAll(async () => {
    server = await spawnServer(PORT, {
      CACHE_MAX_BYTES: '2500',
      CACHE_SWEEP_INTERVAL_MS: '200',
    });
  });

  afterAll(async () => {
    await server?.stop();
  });

  const put = (hash: string, bytes: number) =>
    fetch(`${server.baseUrl}/v1/cache/${hash}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${E2E_ADMIN_TOKEN}` },
      body: new Uint8Array(bytes),
    });
  const get = (hash: string) =>
    fetch(`${server.baseUrl}/v1/cache/${hash}`, {
      headers: { Authorization: `Bearer ${E2E_ADMIN_TOKEN}` },
    });

  it('evicts the least-recently-used entry once the cap is exceeded', async () => {
    expect((await put('evictolder01', 1000)).status).toBe(200);
    await Bun.sleep(50); // separate mtimes so LRU order is unambiguous
    expect((await put('evictstale02', 1000)).status).toBe(200);
    await Bun.sleep(50);
    // Freshen the first entry: a cache hit bumps recency, so the *second*
    // entry becomes the least recently used.
    expect((await get('evictolder01')).status).toBe(200);
    await Bun.sleep(50);
    // 3000 bytes total now exceeds the 2500-byte cap.
    expect((await put('evictnewer03', 1000)).status).toBe(200);

    // Poll /metrics for the sweep — polling the entry itself would bump its
    // recency and change the LRU order under test.
    let metricsText = '';
    for (let i = 0; i < 50; i++) {
      metricsText = await (await fetch(`${server.baseUrl}/metrics`)).text();
      if (metricValue(metricsText, 'nx_cache_evicted_entries_total') > 0) break;
      await Bun.sleep(100);
    }
    expect(metricValue(metricsText, 'nx_cache_evicted_entries_total')).toBe(1);
    expect(metricValue(metricsText, 'nx_cache_evicted_bytes_total')).toBe(1000);
    expect(metricValue(metricsText, 'nx_cache_size_bytes')).toBe(2000);

    expect((await get('evictstale02')).status).toBe(404);
    expect((await get('evictolder01')).status).toBe(200);
    expect((await get('evictnewer03')).status).toBe(200);
  }, 15000);
});

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { E2E_ADMIN_TOKEN, metricValue, spawnServer, type SpawnedServer } from './spawn-server';

let server: SpawnedServer;

const VALID_HASH = 'a'.repeat(64);

const cacheGet = (token: string) =>
  fetch(`${server.baseUrl}/v1/cache/${VALID_HASH}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

describe('auth throttling e2e', () => {
  beforeAll(async () => {
    server = await spawnServer(4021);
  });

  afterAll(async () => {
    await server?.stop();
  });

  it('throttles repeated authentication failures per client without valid traffic resetting it', async () => {
    const created = await fetch(`${server.baseUrl}/v1/admin/tokens`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${E2E_ADMIN_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: 'throttle-cache-token', permission: 'readonly' }),
    });
    expect(created.status).toBe(200);
    const readonlyToken = ((await created.json()) as { value: string }).value;

    // The first 10 failed guesses are plain 403s — the throttle only counts them.
    for (let i = 0; i < 10; i++) {
      const response = await cacheGet('wrong-token');
      expect(response.status).toBe(403);
    }

    // Guess 11 from the same address is blocked with a Retry-After hint.
    const blocked = await cacheGet('wrong-token');
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBe('60');

    // The bucket is per client, not per route: admin guesses are blocked too.
    const blockedAdmin = await fetch(`${server.baseUrl}/v1/admin/tokens`, {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    expect(blockedAdmin.status).toBe(429);

    // A valid token is never locked out for sharing an egress IP with a
    // guesser (NAT, CI runner pool)...
    const validWhileBlocked = await cacheGet(E2E_ADMIN_TOKEN);
    expect(validWhileBlocked.status).toBe(404);

    // A recognised cache token on an admin route fails *authorization*, not
    // authentication — it is refused with 403 even while the address is
    // blocked, and it never feeds the failure bucket.
    const cacheTokenOnAdmin = await fetch(`${server.baseUrl}/v1/admin/tokens`, {
      headers: { Authorization: `Bearer ${readonlyToken}` },
    });
    expect(cacheTokenOnAdmin.status).toBe(403);

    // ...but valid traffic must not reset the counter: otherwise a guesser
    // interleaving guesses with valid requests — or ordinary CI traffic on a
    // shared proxy address — would keep the bucket empty and never throttle.
    const afterValidTraffic = await cacheGet('wrong-token');
    expect(afterValidTraffic.status).toBe(429);

    // All three 429s above are visible to operators as a dedicated counter.
    const metrics = await (await fetch(`${server.baseUrl}/metrics`)).text();
    expect(metricValue(metrics, 'nx_cache_auth_throttled_total')).toBe(3);

    // Throttled cache requests still count toward the total cache-request
    // metric (as result="throttled"), so it never undercounts traffic. The
    // admin-route 429 is not a cache request and stays out of it.
    expect(metricValue(metrics, 'nx_cache_requests_total{method="GET",result="throttled"}')).toBe(
      2,
    );
  });
});

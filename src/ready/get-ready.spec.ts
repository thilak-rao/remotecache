import { describe, expect, it } from 'bun:test';
import { getReady, type ReadyDependency } from './get-ready';

const ready = (): ReadyDependency => ({ checkReady: () => Promise.resolve() });
const broken = (): ReadyDependency => ({
  checkReady: () => Promise.reject(new Error('backend unavailable')),
});

describe('getReady', () => {
  it('returns OK when token storage and cache storage are ready', async () => {
    const response = await getReady({ tokenStorage: ready(), storage: ready() });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/plain');
    expect(await response.text()).toBe('OK');
  });

  it('returns a static 503 when token storage is unavailable', async () => {
    const response = await getReady({ tokenStorage: broken(), storage: ready() });

    expect(response.status).toBe(503);
    expect(response.headers.get('Content-Type')).toContain('text/plain');
    expect(await response.text()).toBe('Not Ready');
  });

  it('returns a static 503 when cache storage is unavailable', async () => {
    const response = await getReady({ tokenStorage: ready(), storage: broken() });

    expect(response.status).toBe(503);
    expect(await response.text()).toBe('Not Ready');
  });
});

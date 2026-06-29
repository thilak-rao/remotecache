import { describe, expect, it } from 'bun:test';
import { getHealth } from './get-health';

describe('getHealth', () => {
  it('returns an unauthenticated OK response for probes', async () => {
    const response = getHealth();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/plain');
    expect(await response.text()).toBe('OK');
  });
});

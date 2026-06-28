import { describe, expect, it } from 'bun:test';
import { getMetrics } from './get-metrics';

describe('getMetrics', () => {
  it('returns the rendered registry as a Prometheus text response', async () => {
    const response = getMetrics({ render: () => 'BODY\n' });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/plain');
    expect(await response.text()).toBe('BODY\n');
  });
});

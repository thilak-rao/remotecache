import { describe, expect, it } from 'bun:test';
import { cacheResultLabel, MetricsRegistry } from './metrics-registry';

describe('cacheResultLabel', () => {
  it('maps GET statuses to read outcomes', () => {
    expect(cacheResultLabel('GET', 200)).toBe('hit');
    expect(cacheResultLabel('GET', 404)).toBe('miss');
    expect(cacheResultLabel('GET', 403)).toBe('forbidden');
    expect(cacheResultLabel('GET', 400)).toBe('bad_request');
    expect(cacheResultLabel('GET', 500)).toBe('error');
    expect(cacheResultLabel('GET', 418)).toBe('other');
  });

  it('maps PUT statuses to write outcomes (including the CREEP block)', () => {
    expect(cacheResultLabel('PUT', 200)).toBe('stored');
    // 403 on PUT is a read-only token attempting a write — the CREEP gate.
    expect(cacheResultLabel('PUT', 403)).toBe('forbidden');
    expect(cacheResultLabel('PUT', 409)).toBe('immutable');
    expect(cacheResultLabel('PUT', 413)).toBe('too_large');
    expect(cacheResultLabel('PUT', 400)).toBe('bad_request');
    expect(cacheResultLabel('PUT', 503)).toBe('error');
  });
});

describe('MetricsRegistry', () => {
  it('renders Prometheus exposition format with HELP/TYPE and seeded zero series', () => {
    const text = new MetricsRegistry().render();

    expect(text).toContain('# TYPE nx_cache_requests_total counter');
    expect(text).toContain('# HELP nx_cache_requests_total');
    // Seeded so hit-rate panels are well-defined from t=0.
    expect(text).toContain('nx_cache_requests_total{method="GET",result="hit"} 0');
    expect(text).toContain('nx_cache_requests_total{method="GET",result="miss"} 0');
    expect(text).toContain('nx_cache_requests_total{method="PUT",result="stored"} 0');
    expect(text).toContain('nx_cache_requests_total{method="PUT",result="forbidden"} 0');
    expect(text).toContain('# TYPE nx_cache_uploaded_bytes_total counter');
    expect(text).toContain('nx_cache_uploaded_bytes_total 0');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('counts cache requests by method and result', () => {
    const registry = new MetricsRegistry();
    registry.recordCacheRequest('GET', 200);
    registry.recordCacheRequest('GET', 200);
    registry.recordCacheRequest('GET', 404);
    registry.recordCacheRequest('PUT', 403);

    const text = registry.render();
    expect(text).toContain('nx_cache_requests_total{method="GET",result="hit"} 2');
    expect(text).toContain('nx_cache_requests_total{method="GET",result="miss"} 1');
    expect(text).toContain('nx_cache_requests_total{method="PUT",result="forbidden"} 1');
  });

  it('accumulates uploaded bytes only for successful stores', () => {
    const registry = new MetricsRegistry();
    registry.recordCacheRequest('PUT', 200, 1024);
    registry.recordCacheRequest('PUT', 200, 512);
    // A forbidden write carries no stored bytes even if a size is passed.
    registry.recordCacheRequest('PUT', 403, 999);

    const text = registry.render();
    expect(text).toContain('nx_cache_requests_total{method="PUT",result="stored"} 2');
    expect(text).toContain('nx_cache_uploaded_bytes_total 1536');
  });

  it('lazily adds unseeded results without dropping them', () => {
    const registry = new MetricsRegistry();
    registry.recordCacheRequest('GET', 418);

    expect(registry.render()).toContain('nx_cache_requests_total{method="GET",result="other"} 1');
  });
});

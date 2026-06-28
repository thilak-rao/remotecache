import { okResponse } from '../responses';
import type { MetricsRegistry } from './metrics-registry';

const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

/**
 * Render the metrics registry as a Prometheus exposition response. Pure and
 * unauthenticated: it exposes only aggregate counters (no tokens, no hashes),
 * and is meant to be scraped over a private network — the deployment gateway
 * blocks `/metrics` from the tailnet.
 */
export function getMetrics(registry: Pick<MetricsRegistry, 'render'>): Response {
  return okResponse({
    message: registry.render(),
    contentType: PROMETHEUS_CONTENT_TYPE,
  });
}

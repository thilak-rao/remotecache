export type CacheMethod = 'GET' | 'PUT';

// Results seeded to 0 so rate()/ratio panels are well-defined before the first
// real request. Unseeded statuses (mapped to 'other') are added on demand.
const SEEDED_RESULTS: Record<CacheMethod, readonly string[]> = {
  GET: ['hit', 'miss', 'forbidden', 'bad_request', 'error'],
  PUT: ['stored', 'forbidden', 'immutable', 'too_large', 'bad_request', 'error'],
};

/**
 * Map an HTTP status from a `/v1/cache/:hash` handler to a stable Prometheus
 * label. GET 200/404 drive the cache hit-rate; PUT 403 is the CREEP gate (a
 * read-only token rejected from writing).
 */
export function cacheResultLabel(method: CacheMethod, status: number): string {
  if (method === 'GET') {
    if (status === 200) return 'hit';
    if (status === 404) return 'miss';
  } else {
    if (status === 200) return 'stored';
    if (status === 409) return 'immutable';
    if (status === 413) return 'too_large';
  }
  if (status === 403) return 'forbidden';
  if (status === 400) return 'bad_request';
  if (status >= 500) return 'error';
  return 'other';
}

const seriesKey = (method: CacheMethod, result: string): string => `${method}|${result}`;

/**
 * In-process Prometheus counters for the cache server. Instantiated once in
 * `main.ts`; the cache handlers call `recordCacheRequest` and the `/metrics`
 * route renders the registry. No external dependency — Bun runs the server with
 * a zero-dependency runtime, so the exposition text is built by hand.
 */
export class MetricsRegistry {
  private readonly requests = new Map<string, number>();
  private uploadedBytes = 0;

  constructor() {
    for (const method of ['GET', 'PUT'] as const) {
      for (const result of SEEDED_RESULTS[method]) {
        this.requests.set(seriesKey(method, result), 0);
      }
    }
  }

  /** Record one cache request. `uploadedBytes` counts only on a successful store. */
  recordCacheRequest(method: CacheMethod, status: number, uploadedBytes = 0): void {
    const result = cacheResultLabel(method, status);
    const key = seriesKey(method, result);
    this.requests.set(key, (this.requests.get(key) ?? 0) + 1);
    // Bytes count only on a successful store, so a rejected write can never
    // inflate throughput regardless of what size the caller passes.
    if (result === 'stored') {
      this.uploadedBytes += uploadedBytes;
    }
  }

  /** Render the Prometheus text exposition format (version 0.0.4). */
  render(): string {
    const lines: string[] = [
      '# HELP nx_cache_requests_total Total Nx remote cache HTTP requests by method and result.',
      '# TYPE nx_cache_requests_total counter',
    ];

    for (const [key, value] of [...this.requests.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const [method, result] = key.split('|');
      lines.push(`nx_cache_requests_total{method="${method}",result="${result}"} ${value}`);
    }

    lines.push(
      '# HELP nx_cache_uploaded_bytes_total Total bytes accepted by successful cache uploads.',
      '# TYPE nx_cache_uploaded_bytes_total counter',
      `nx_cache_uploaded_bytes_total ${this.uploadedBytes}`,
    );

    return `${lines.join('\n')}\n`;
  }
}

---
title: 'Monitoring'
description: 'Prometheus metrics for the Nx remote cache server: hit rate, forbidden writes, eviction, and example alert rules.'
head:
  - tag: title
    content: 'Monitoring the Nx Remote Cache with Prometheus | remotecache'
---

The server exposes Prometheus metrics at `GET /metrics` in the text exposition format. The endpoint is unauthenticated and reports only aggregates — no token values, no cache hashes — but treat it as private operational data: scrape it over a private network and block `/metrics` at your public proxy.

## Metrics

| Metric                                   | Type    | Meaning                                                                                                                                                                                          |
| ---------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `nx_cache_requests_total{method,result}` | counter | Cache requests by method and outcome. `GET` results: `hit`, `miss`, `forbidden`, `bad_request`, `error`. `PUT` results: `stored`, `forbidden`, `immutable`, `too_large`, `bad_request`, `error`. |
| `nx_cache_uploaded_bytes_total`          | counter | Bytes accepted by successful uploads.                                                                                                                                                            |
| `nx_cache_evicted_entries_total`         | counter | Entries deleted by the eviction sweeper (filesystem strategy).                                                                                                                                   |
| `nx_cache_evicted_bytes_total`           | counter | Bytes reclaimed by the eviction sweeper.                                                                                                                                                         |
| `nx_cache_size_bytes`                    | gauge   | Committed cache size as of the last eviction sweep. Only updates when eviction is enabled.                                                                                                       |

Two results deserve a note:

- `PUT` `forbidden` counts every write rejected with `403`. This includes missing or invalid bearer tokens and valid `readonly` tokens; the label does not identify which case occurred. A steady nonzero rate means a job has an authentication or permission problem (see [CI recipes](/guides/ci-recipes/)) or someone is probing.
- `PUT` `immutable` counts attempts to overwrite an existing entry (`409`). Occasional occurrences are normal racing builds.

## Scraping

```yaml
scrape_configs:
  - job_name: nx-cache
    static_configs:
      - targets: ['nx-cache:3000']
```

## Useful queries

Cache hit rate over the last 15 minutes:

```promql
sum(rate(nx_cache_requests_total{method="GET",result="hit"}[15m]))
/
sum(rate(nx_cache_requests_total{method="GET",result=~"hit|miss"}[15m]))
```

Upload throughput:

```promql
rate(nx_cache_uploaded_bytes_total[15m])
```

## Example alert rules

```yaml
groups:
  - name: nx-cache
    rules:
      - alert: NxCacheDown
        expr: up{job="nx-cache"} == 0
        for: 5m
        labels: { severity: critical }
        annotations:
          summary: 'Nx cache server is unreachable'

      - alert: NxCacheHitRateLow
        expr: |
          sum(rate(nx_cache_requests_total{method="GET",result="hit"}[1h]))
          /
          sum(rate(nx_cache_requests_total{method="GET",result=~"hit|miss"}[1h])) < 0.5
        for: 2h
        labels: { severity: warning }
        annotations:
          summary: 'Cache hit rate below 50% — check for hash instability or recent eviction'

      - alert: NxCacheForbiddenWriteAttempts
        expr: increase(nx_cache_requests_total{method="PUT",result="forbidden"}[15m]) > 0
        labels: { severity: warning }
        annotations:
          summary: 'Cache writes were forbidden: check for missing, invalid, or readonly tokens'

      - alert: NxCacheNearCapacity
        # Replace 50000000000 with 90% of your CACHE_MAX_BYTES value; the cap
        # itself is not exported as a metric.
        expr: nx_cache_size_bytes > 50000000000
        for: 30m
        labels: { severity: warning }
        annotations:
          summary: 'Filesystem cache approaching CACHE_MAX_BYTES; sweeps will evict aggressively'
```

Tune the hit-rate threshold to your baseline; a monorepo with many long-lived branches naturally sits lower than one where most builds hit `main`-warmed entries.

## Readiness

Use token-free `GET /health` for liveness and `GET /ready` for dependency readiness. `/ready` asks the existing SQLite connection to run `SELECT 1` and probes the configured storage backend; filesystem storage probes `CACHE_DIR`. A `503 Not Ready` response means one of these runtime checks failed. Token database creation or open errors normally stop the server during startup. See [Troubleshooting](/guides/troubleshooting/).

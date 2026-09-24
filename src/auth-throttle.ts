import type { MetricsRegistry } from './metrics/metrics-registry';
import { tooManyRequests } from './responses';

// Upper bound on tracked clients; see docs-site guides/security.md#authentication-throttling.
const MAX_TRACKED_CLIENTS = 10_000;

/**
 * The throttle bucket for a peer address. IPv6 clients are keyed by their /64
 * prefix: one host is routinely handed a whole /64, so per-address buckets
 * would let it rotate source addresses to evade the counter. IPv4 and
 * IPv4-mapped IPv6 addresses (`::ffff:192.0.2.1`) stay per-address.
 */
export function clientKey(address: string): string {
  if (!address.includes(':') || address.includes('.')) return address;

  const [head = '', tail] = address.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const zeros = tail === undefined ? [] : Array<string>(8 - left.length - right.length).fill('0');
  const prefix = [...left, ...zeros, ...right].slice(0, 4);

  return `${prefix.map((group) => parseInt(group, 16).toString(16)).join(':')}::/64`;
}

export interface AuthThrottleOptions {
  maxFailures?: number;
  windowMs?: number;
  now?: () => number;
}

export class AuthThrottle {
  // Clients below the threshold, least recently failed first: every failure
  // re-inserts its client and a Map iterates in insertion order, so the first
  // entry is the cheapest one to evict, found in O(1).
  readonly #belowThreshold = new Map<string, number[]>();
  // Clients at or above the threshold.
  readonly #blocked = new Map<string, number[]>();
  // No blocked client can drop below the threshold before this time. A lower
  // bound: a client that leaves #blocked early can leave it stale, which costs
  // one extra scan, never a missed release.
  #nextReleaseAt = Infinity;
  readonly #maxFailures: number;
  readonly #windowMs: number;
  readonly #now: () => number;

  // performance.now(), not Date.now(): every comparison here is a duration
  // between two in-process readings, so it must not follow the wall clock. A
  // backwards step (NTP correcting a skewed RTC, a VM resumed from a snapshot)
  // would otherwise hold every tracked client blocked long past its
  // Retry-After and stall the release gate for the length of the jump,
  // silently leaving new addresses untracked and unthrottled.
  constructor({
    maxFailures = 10,
    windowMs = 60_000,
    now = () => performance.now(),
  }: AuthThrottleOptions = {}) {
    this.#maxFailures = maxFailures;
    this.#windowMs = windowMs;
    this.#now = now;
  }

  get retryAfterSeconds(): number {
    return Math.ceil(this.#windowMs / 1000);
  }

  /**
   * Record one authentication failure from `address` and report whether its
   * bucket was already blocked. Returns `true` without recording for a blocked
   * bucket, so retries never push the release past their Retry-After. Returns
   * `false` without recording for a new client when every tracker slot holds a
   * live block: that client stays untracked (see #makeRoom).
   */
  recordFailure(address: string): boolean {
    const client = clientKey(address);
    const now = this.#now();
    const stored = this.#blocked.get(client) ?? this.#belowThreshold.get(client) ?? [];
    // Timestamps are ascending: blocked iff the max-th newest is still in the window.
    const max = this.#maxFailures;
    if (stored.length >= max && stored[stored.length - max] > now - this.#windowMs) return true;

    const recent = this.#recent(stored, now);

    this.#blocked.delete(client);
    this.#belowThreshold.delete(client);

    // A spray across many source addresses must not grow the map without bound.
    if (recent.length === 0 && this.#size >= MAX_TRACKED_CLIENTS && !this.#makeRoom(now)) {
      return false;
    }

    recent.push(now);
    if (recent.length < this.#maxFailures) {
      this.#belowThreshold.set(client, recent);
    } else {
      this.#blocked.set(client, recent);
      // The oldest failure aging out is what drops this client below the threshold.
      this.#nextReleaseAt = Math.min(this.#nextReleaseAt, recent[0] + this.#windowMs);
    }
    return false;
  }

  get #size(): number {
    return this.#belowThreshold.size + this.#blocked.size;
  }

  #recent(attempts: number[], now: number): number[] {
    const cutoff = now - this.#windowMs;
    return attempts.filter((at) => at > cutoff);
  }

  // Releases aged-out blocks first; only if that frees no slot does it evict
  // the least recently failed client below the threshold. Blocked clients are
  // never evicted, so when every slot holds a live block this refuses the new
  // client instead: a spray from 10k throwaway addresses costs the attacker
  // their own bucket too — it can churn the unblocked slots, but it cannot buy
  // back a clean one.
  #makeRoom(now: number): boolean {
    this.#releaseExpiredBlocks(now);
    if (this.#size < MAX_TRACKED_CLIENTS) return true;

    const oldest = this.#belowThreshold.keys().next();
    if (oldest.done) return false;
    this.#belowThreshold.delete(oldest.value);
    return true;
  }

  // Walks the blocked clients only once one of them can have dropped below the
  // threshold. Without that gate a tracker saturated with live blocks would be
  // rescanned on every failure from a new address — a spray's cheapest way to
  // burn CPU. Released clients are appended to #belowThreshold, so they rank
  // as most recently failed even when clients already there failed later.
  // Eviction order is therefore approximate after a release: a released client
  // can outlast a more recently failed one. That only decides which
  // sub-threshold history is dropped first, so it is not worth a sort.
  #releaseExpiredBlocks(now: number): void {
    if (now < this.#nextReleaseAt) return;

    this.#nextReleaseAt = Infinity;

    for (const [client, attempts] of this.#blocked) {
      const releaseAt = attempts[0] + this.#windowMs;
      if (releaseAt > now) {
        this.#nextReleaseAt = Math.min(this.#nextReleaseAt, releaseAt);
        continue;
      }
      this.#blocked.delete(client);
      const recent = this.#recent(attempts, now);
      if (recent.length > 0) this.#belowThreshold.set(client, recent);
    }
  }
}

/**
 * Records one authentication failure (a missing or unknown token) from
 * `address` and returns the `429` to send if its bucket is blocked, or `null`
 * to let the handler continue.
 *
 * Call it only for authentication failures — never for authorization failures
 * (a recognised token lacking the required permission) or token-store faults.
 * A request without a peer `address` is neither counted nor throttled. Why:
 * docs-site guides/security.md#authentication-throttling.
 */
export function throttleAuthFailure(
  throttle: Pick<AuthThrottle, 'recordFailure' | 'retryAfterSeconds'>,
  metrics: Pick<MetricsRegistry, 'recordAuthThrottled'>,
  address: string | undefined,
): Response | null {
  if (!address || !throttle.recordFailure(address)) return null;

  metrics.recordAuthThrottled();
  return tooManyRequests('Too many failed authentication attempts', throttle.retryAfterSeconds);
}

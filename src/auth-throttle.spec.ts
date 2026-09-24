import { describe, expect, it } from 'bun:test';
import { AuthThrottle, clientKey, throttleAuthFailure } from './auth-throttle';

describe('AuthThrottle', () => {
  const makeThrottle = (maxFailures = 3, windowMs = 1000) => {
    let clock = 1_000_000;
    const throttle = new AuthThrottle({ maxFailures, windowMs, now: () => clock });
    return { throttle, advance: (ms: number) => (clock += ms) };
  };

  const fail = (throttle: AuthThrottle, client: string, times: number) => {
    for (let i = 0; i < times; i++) throttle.recordFailure(client);
  };

  it('does not block a client until the threshold is reached', () => {
    const { throttle } = makeThrottle();

    expect(throttle.recordFailure('1.2.3.4')).toBe(false);
    expect(throttle.recordFailure('1.2.3.4')).toBe(false);
    expect(throttle.recordFailure('1.2.3.4')).toBe(false);
    expect(throttle.recordFailure('1.2.3.4')).toBe(true);
  });

  it('releases a client once failures age out of the window', () => {
    const { throttle, advance } = makeThrottle();

    fail(throttle, '1.2.3.4', 3);
    expect(throttle.recordFailure('1.2.3.4')).toBe(true);

    advance(1001);

    expect(throttle.recordFailure('1.2.3.4')).toBe(false);
  });

  it('releases a client as soon as its oldest failure ages out', () => {
    // The window slides per failure: a block lifts when the oldest counted
    // failure expires, not when the newest one does.
    const { throttle, advance } = makeThrottle();

    throttle.recordFailure('1.2.3.4');
    advance(400);
    throttle.recordFailure('1.2.3.4');
    advance(400);
    throttle.recordFailure('1.2.3.4');
    advance(201);

    expect(throttle.recordFailure('1.2.3.4')).toBe(false);
    expect(throttle.recordFailure('1.2.3.4')).toBe(true);
  });

  it('does not extend a block with the requests it rejects', () => {
    // A blocked client retrying must be released within its Retry-After;
    // counting the rejected retries would keep pushing the release back.
    const { throttle, advance } = makeThrottle();

    fail(throttle, '1.2.3.4', 3);
    advance(500);
    expect(throttle.recordFailure('1.2.3.4')).toBe(true);

    advance(501);

    expect(throttle.recordFailure('1.2.3.4')).toBe(false);
  });

  it('shares one bucket across an IPv6 /64', () => {
    // A host handed a /64 must not evade the counter by rotating addresses.
    const { throttle } = makeThrottle();

    throttle.recordFailure('2001:db8:1:2::1');
    throttle.recordFailure('2001:db8:1:2::2');
    throttle.recordFailure('2001:db8:1:2:ffff:ffff:ffff:ffff');

    expect(throttle.recordFailure('2001:db8:1:2::3')).toBe(true);
    expect(throttle.recordFailure('2001:db8:1:3::1')).toBe(false);
  });

  it('keeps an active block while a many-address spray fills the tracker', () => {
    // Bounding memory must not release live blocks: an attacker with a rotating
    // source pool would otherwise spray throwaway addresses to clear their own
    // bucket, dropping back to ordinary 403s and out of the throttle metric.
    const { throttle } = makeThrottle();

    fail(throttle, 'blocked-client', 3);

    for (let i = 0; i < 12_000; i++) throttle.recordFailure(`spray-${i}`);

    expect(throttle.recordFailure('blocked-client')).toBe(true);
  });

  it('evicts unblocked clients once the tracker is full', () => {
    // The map stays bounded by dropping the entries that cost the least to
    // rebuild — clients still below the threshold, least recently failed first.
    const { throttle } = makeThrottle();

    fail(throttle, 'below-threshold', 2);

    for (let i = 0; i < 12_000; i++) throttle.recordFailure(`spray-${i}`);

    // Evicted, so its two prior failures are gone: two more must not block it.
    fail(throttle, 'below-threshold', 2);
    expect(throttle.recordFailure('below-threshold')).toBe(false);
  });

  it('keeps admitting new clients while any tracked client is below the threshold', () => {
    // With 9,999 blocked clients, each new address must still displace the
    // least recently failed unblocked one. Refusing it instead would leave a
    // fresh guesser untracked — and unthrottled — while evictable slots exist.
    const { throttle } = makeThrottle();

    for (let i = 0; i < 9_999; i++) fail(throttle, `blocked-${i}`, 3);
    throttle.recordFailure('below-threshold');
    throttle.recordFailure('first-new');

    fail(throttle, 'second-new', 3);
    expect(throttle.recordFailure('second-new')).toBe(true);
  });

  it('tracks a steady stream of fresh addresses without rescanning the tracker', () => {
    // ~166 new addresses/s keeps a full tracker with one aged-out slot per
    // arrival. Walking all 10,000 entries to recycle that one slot would let a
    // modest spray burn CPU on every failed request.
    const { throttle, advance } = makeThrottle(10, 60_000);

    const started = performance.now();
    for (let i = 0; i < 30_000; i++) {
      throttle.recordFailure(`spray-${i}`);
      advance(6);
    }

    // ~50ms today; a per-failure scan took ~6s. The wide margin keeps slow CI
    // and coverage runs from flaking while still catching that regression.
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it('resumes tracking new clients once blocked failures age out', () => {
    // A full tracker of blocked clients must start admitting again the moment
    // one of them drops below the threshold. Get that moment wrong and the
    // tracker wedges: it refuses every new client forever, disabling the
    // throttle for everyone but the attacker who filled it.
    const { throttle, advance } = makeThrottle();

    for (let i = 0; i < 10_100; i++) fail(throttle, `spray-${i}`, 3);

    advance(1001);

    fail(throttle, 'new-client', 3);
    expect(throttle.recordFailure('new-client')).toBe(true);
  });

  it('reclaims aged-out blocks while a client below the threshold lingers', () => {
    // One lingering unblocked client must not pin the release scan off. If it
    // did, expired blocks would hold their slots indefinitely and new guessers
    // would share the single evictable slot, evicting each other's failures
    // before any of them reached the threshold.
    const { throttle, advance } = makeThrottle();

    for (let i = 0; i < 9_999; i++) fail(throttle, `spray-${i}`, 3);
    throttle.recordFailure('lingering');

    advance(1001);

    for (let i = 0; i < 3; i++) {
      throttle.recordFailure('guesser-a');
      throttle.recordFailure('guesser-b');
    }
    expect(throttle.recordFailure('guesser-a')).toBe(true);
    expect(throttle.recordFailure('guesser-b')).toBe(true);
  });

  it('keeps the live failures of a released client when the release frees room', () => {
    // A client released from a block still holds failures inside the window;
    // evicting it after the release scan already freed a slot would hand it a
    // clean bucket and delay its next block.
    const { throttle, advance } = makeThrottle();

    fail(throttle, 'expired', 3);
    throttle.recordFailure('released');
    advance(500);
    fail(throttle, 'released', 2);
    advance(100);
    for (let i = 0; i < 9_998; i++) fail(throttle, `spray-${i}`, 3);

    // 'expired' ages out entirely, freeing its slot; 'released' drops below the
    // threshold with two live failures; the spray stays blocked.
    advance(401);
    throttle.recordFailure('new-client');

    expect(throttle.recordFailure('released')).toBe(false);
    expect(throttle.recordFailure('released')).toBe(true);
  });
});

describe('clientKey', () => {
  it('keys IPv6 addresses by their /64 prefix in any textual form', () => {
    expect(clientKey('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2::/64');
    expect(clientKey('2001:0DB8:0001:0002::7')).toBe('2001:db8:1:2::/64');
    expect(clientKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(clientKey('2001:db8:1:2::')).toBe('2001:db8:1:2::/64');
    expect(clientKey('::1')).toBe('0:0:0:0::/64');
  });

  it('keeps IPv4 and IPv4-mapped IPv6 clients per-address', () => {
    // A /64-style prefix of a mapped address is ::ffff:0:0 for every IPv4
    // client, which would pool all of them into one bucket.
    expect(clientKey('192.0.2.1')).toBe('192.0.2.1');
    expect(clientKey('::ffff:192.0.2.1')).toBe('::ffff:192.0.2.1');
    expect(clientKey('::ffff:192.0.2.2')).not.toBe(clientKey('::ffff:192.0.2.1'));
  });
});

describe('throttleAuthFailure', () => {
  const setup = () => {
    const throttle = new AuthThrottle({ maxFailures: 1 });
    const metrics = { throttled: 0, recordAuthThrottled: () => metrics.throttled++ };
    return { throttle, metrics };
  };

  it('rejects a blocked client with 429 and counts it', () => {
    const { throttle, metrics } = setup();

    expect(throttleAuthFailure(throttle, metrics, '192.0.2.1')).toBeNull();
    expect(throttleAuthFailure(throttle, metrics, '192.0.2.1')?.status).toBe(429);
    expect(metrics.throttled).toBe(1);
  });

  it('does not count requests without a peer address', () => {
    // They cannot be keyed to a client; pooling them would let a few of them
    // 429 unrelated address-less traffic.
    const { throttle, metrics } = setup();

    expect(throttleAuthFailure(throttle, metrics, undefined)).toBeNull();
    expect(throttleAuthFailure(throttle, metrics, undefined)).toBeNull();
    expect(metrics.throttled).toBe(0);
  });
});

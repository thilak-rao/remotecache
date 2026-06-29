import { describe, expect, it } from 'bun:test';
import { shouldRefreshCredentials } from './s3';

describe('shouldRefreshCredentials', () => {
  const now = 1_000_000_000_000;

  it('never refreshes when expiration is null (static credentials)', () => {
    expect(shouldRefreshCredentials(null, now)).toBe(false);
  });

  it('refreshes within five minutes of expiry', () => {
    expect(shouldRefreshCredentials(now + 4 * 60 * 1000, now)).toBe(true);
  });

  it('does not refresh comfortably before expiry', () => {
    expect(shouldRefreshCredentials(now + 30 * 60 * 1000, now)).toBe(false);
  });

  it('refreshes when already expired', () => {
    expect(shouldRefreshCredentials(now - 1000, now)).toBe(true);
  });
});

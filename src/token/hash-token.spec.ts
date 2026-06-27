import { describe, expect, it } from 'bun:test';
import { hashToken } from './hash-token';

describe('hashToken', () => {
  it('produces a 64-char lowercase hex SHA-256 digest', () => {
    expect(hashToken('my-token')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is deterministic for the same input', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
  });

  it('differs for different inputs', () => {
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
  });

  it('never returns the raw token', () => {
    expect(hashToken('plaintext-token')).not.toBe('plaintext-token');
  });
});

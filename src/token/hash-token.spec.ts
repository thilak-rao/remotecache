import { describe, expect, it } from 'bun:test';
import { hashToken } from './hash-token';

describe('hashToken', () => {
  it('returns the lowercase SHA-256 digest of the UTF-8 token', () => {
    expect(hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

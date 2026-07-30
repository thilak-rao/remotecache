import { describe, expect, it } from 'bun:test';
import { isValidHash } from './is-valid-hash';

describe('isValidHash', () => {
  it('accepts typical Nx cache hashes', () => {
    expect(isValidHash('a1b2c3d4e5f6')).toBe(true);
    expect(isValidHash('1234567890abcdefABCDEF')).toBe(true);
    expect(isValidHash('hash-with-dashes_and_underscores')).toBe(true);
  });

  it('rejects dots so a hash cannot collide with the .tmp write path or the cache dir', () => {
    expect(isValidHash('.')).toBe(false);
    expect(isValidHash('..')).toBe(false);
    expect(isValidHash('abc.tmp')).toBe(false);
    expect(isValidHash('file.tar.gz')).toBe(false);
  });

  it('rejects path separators and traversal sequences', () => {
    expect(isValidHash('../etc/passwd')).toBe(false);
    expect(isValidHash('foo/bar')).toBe(false);
    expect(isValidHash('foo\\bar')).toBe(false);
  });

  it('rejects empty, undefined, and out-of-charset values', () => {
    expect(isValidHash('')).toBe(false);
    expect(isValidHash(undefined)).toBe(false);
    for (const hash of ['has space', 'ümlaut', 'line\nbreak', 'null\0byte', 'foo%2Fbar']) {
      expect(isValidHash(hash)).toBe(false);
    }
  });

  it('caps length at 128 characters', () => {
    expect(isValidHash('a'.repeat(128))).toBe(true);
    expect(isValidHash('a'.repeat(129))).toBe(false);
  });
});

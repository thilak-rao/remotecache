import { describe, expect, it } from 'bun:test';
import { safeEqual } from './safe-equal';

describe('safeEqual', () => {
  it('returns true for identical strings', () => {
    expect(safeEqual('s3cr3t-admin-token', 's3cr3t-admin-token')).toBe(true);
  });

  it('returns false for different strings of equal length', () => {
    expect(safeEqual('s3cr3t', 'S3CR3T')).toBe(false);
  });

  it('returns false for different-length strings without throwing', () => {
    expect(safeEqual('short', 'a-considerably-longer-secret')).toBe(false);
  });

  it('treats empty strings consistently', () => {
    expect(safeEqual('', '')).toBe(true);
    expect(safeEqual('', 'x')).toBe(false);
  });
});

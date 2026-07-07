/**
 * Validate a cache hash for use as a filesystem path segment or object key.
 *
 * Allows only `[A-Za-z0-9_-]`, length 1–128. Dots are rejected so a hash can
 * never collide with the filesystem strategy's `${hash}.tmp` write path or
 * resolve to the cache directory (`.`) or its parent (`..`).
 */
export function isValidHash(hash: string | undefined): boolean {
  return typeof hash === 'string' && hash.length <= 128 && /^[A-Za-z0-9_-]+$/.test(hash);
}

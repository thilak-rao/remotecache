import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Compares two strings in constant time to avoid leaking a secret through a
 * timing side channel.
 *
 * Both inputs are reduced to their SHA-256 digests before comparison, so the
 * work done is independent of the inputs' length and content. This prevents an
 * attacker from recovering a secret (such as the admin token) byte by byte by
 * measuring how long a naive `===` comparison takes to reject a guess.
 *
 * @param a - first string to compare
 * @param b - second string to compare
 * @returns `true` when the strings are equal, `false` otherwise
 */
export function safeEqual(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a).digest();
  const digestB = createHash('sha256').update(b).digest();
  return timingSafeEqual(digestA, digestB);
}

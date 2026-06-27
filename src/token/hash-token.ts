import { createHash } from 'node:crypto';

/**
 * Hashes a token for storage and lookup.
 *
 * Tokens are high-entropy random values, so a fast cryptographic hash
 * (SHA-256) is enough: there is no low-entropy password to brute-force. Storing
 * only the hash means a leaked database file exposes no usable tokens, and a
 * lookup stays a single indexed equality check against the hash.
 *
 * @param value - the raw token value
 * @returns the SHA-256 digest of the token as a lowercase hex string
 */
export function hashToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

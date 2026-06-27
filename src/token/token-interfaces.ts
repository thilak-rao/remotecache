export type TokenPermission = 'readonly' | 'full';

export interface TokenRecord {
  id: string;
  value: string;
  permission: TokenPermission;
}

/**
 * A token without its secret value. This is all the store can return once
 * tokens are hashed at rest, since the plaintext is never persisted.
 */
export type TokenSummary = Omit<TokenRecord, 'value'>;

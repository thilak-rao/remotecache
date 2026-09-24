import { logger } from '../logger';
import { safeEqual } from '../safe-equal';
import type { TokenPermission } from './token-interfaces';
import type { TokenStorage } from './token-storage';

export interface ResolvedToken {
  permission: TokenPermission | null;
  isAdmin: boolean;
  /** A missing or unknown token: what the auth throttle counts. */
  authFailed: boolean;
}

/**
 * Resolve a bearer token value to its permission. The admin token resolves to
 * `full`. A missing or unknown token is an authentication failure. A
 * token-store fault is logged and denies the request, but is not an
 * authentication failure: a flaky database is not a guesser.
 */
export function resolveToken(
  tokenValue: string,
  tokenStorage: Pick<TokenStorage, 'findToken'>,
  adminToken: string,
): ResolvedToken {
  if (!tokenValue) return { permission: null, isAdmin: false, authFailed: true };
  if (safeEqual(tokenValue, adminToken)) {
    return { permission: 'full', isAdmin: true, authFailed: false };
  }
  try {
    const permission = tokenStorage.findToken(tokenValue)?.permission ?? null;
    return { permission, isAdmin: false, authFailed: permission === null };
  } catch (error) {
    logger.error(error);
    return { permission: null, isAdmin: false, authFailed: false };
  }
}

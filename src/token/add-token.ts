import {
  accessForbidden,
  badRequest,
  conflictError,
  internalServerError,
  okResponse,
} from '../responses';
import { TokenPermission, TokenRecord } from './token-interfaces';
import { TokenStorage } from './token-storage';
import { logger } from '../logger';

const validPermissions = ['full', 'readonly'] as const satisfies TokenPermission[];

const parseJsonSafe = async (jsonBody: () => Promise<unknown>) => {
  try {
    return await jsonBody();
  } catch (error) {
    logger.error(error);
    return null;
  }
};

const isTokenPermission = (value: unknown): value is TokenPermission =>
  typeof value === 'string' && validPermissions.includes(value as TokenPermission);

export async function randomToken(): Promise<string> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);

  const digest = await crypto.subtle.digest('SHA-256', bytes);

  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function addToken(
  hasAdminRights: boolean,
  tokenStorage: Pick<TokenStorage, 'addToken'>,
  jsonBody: () => Promise<unknown>,
) {
  if (!hasAdminRights) {
    return accessForbidden();
  }

  const body = await parseJsonSafe(jsonBody);
  if (!body || typeof body !== 'object') {
    return badRequest('Invalid JSON body');
  }

  const { id, permission } = body as { id?: unknown; permission?: unknown };
  if (!id || typeof id !== 'string') {
    return badRequest('id is required and must be a string');
  }

  if (!isTokenPermission(permission)) {
    return badRequest(
      'permission is required, must be a string and one of: ' + validPermissions.join(', '),
    );
  }

  const value = await randomToken();
  const tokenRecord: TokenRecord = { value, id, permission };

  const { result, error } = tokenStorage.addToken(tokenRecord);

  if (result) {
    return okResponse({
      message: JSON.stringify(tokenRecord),
      contentType: 'application/json; charset=utf-8',
    });
  }

  switch (error) {
    case 'tokenIdAlreadyExists':
      return conflictError('Conflict: token id already exists');
    case 'tokenValueAlreadyExists':
      return conflictError('Conflict: token value already exists');
    default:
      return internalServerError('Failed to add token');
  }
}

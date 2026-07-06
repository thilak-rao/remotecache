import {
  accessForbidden,
  badRequest,
  internalServerError,
  noContentResponse,
  notFoundError,
} from '../responses';
import { TokenStorage } from './token-storage';

export async function deleteToken(
  hasAdminRights: boolean,
  tokenStorage: Pick<TokenStorage, 'removeTokenById'>,
  idToDelete: string,
) {
  if (!hasAdminRights) {
    return accessForbidden();
  }

  if (!idToDelete) {
    return badRequest('id is required');
  }
  const { result, error } = tokenStorage.removeTokenById(idToDelete);

  if (error) {
    return internalServerError('An error occurred while deleting the token');
  }

  if (!result) {
    return notFoundError('Token not found');
  }
  return noContentResponse();
}

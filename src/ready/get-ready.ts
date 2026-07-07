import { logger } from '../logger';
import { okResponse, serviceUnavailable } from '../responses';

export interface ReadyDependency {
  checkReady(): Promise<void>;
}

export async function getReady({
  tokenStorage,
  storage,
}: {
  tokenStorage: ReadyDependency;
  storage: ReadyDependency;
}) {
  try {
    await tokenStorage.checkReady();
    await storage.checkReady();
    return okResponse({ message: 'OK', contentType: 'text/plain' });
  } catch (error) {
    logger.error(error);
    return serviceUnavailable('Not Ready');
  }
}

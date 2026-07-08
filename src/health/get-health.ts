import { okResponse } from '../responses';

/**
 * Return a lightweight unauthenticated health response for container and
 * orchestrator probes. This checks that the process is accepting requests; it
 * does not validate token DB or storage backend reachability.
 */
export function getHealth(): Response {
  return okResponse({ message: 'OK', contentType: 'text/plain; charset=utf-8' });
}

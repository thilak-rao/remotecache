import { okResponse } from '../responses';

const HEALTH_CONTENT_TYPE = 'text/plain; charset=utf-8';

/**
 * Return a lightweight unauthenticated health response for container and
 * orchestrator probes. This checks that the process is accepting requests; it
 * does not validate filesystem or S3 backend reachability.
 */
export function getHealth(): Response {
  return okResponse({
    message: 'OK',
    contentType: HEALTH_CONTENT_TYPE,
  });
}

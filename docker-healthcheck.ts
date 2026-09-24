import { bindAddress, directTlsEnabled, listenPort } from './src/config';
import { logger } from './src/logger';

// Container HEALTHCHECK probe (see Dockerfile). Follows PORT and BIND_ADDRESS
// so the probe targets an interface the server actually listens on: wildcard
// binds probe loopback in the matching family, and a concrete address is
// probed directly. Direct TLS uses HTTPS; certificate validation is skipped
// because the probe may use loopback while the certificate names a public host.
const bind = bindAddress(Bun.env);
const host = bind === '0.0.0.0' ? '127.0.0.1' : bind === '::' ? '::1' : bind;
const port = listenPort(Bun.env);

// Bun's fetch honors HTTP_PROXY/HTTPS_PROXY (and lowercase), which a container often
// inherits for outbound traffic; a proxy cannot reach this container's
// loopback, so the probe would report unhealthy forever. `proxy: false` is
// ignored by Bun 1.3/1.4, but NO_PROXY is read at fetch time. Bun prefers the
// lowercase variable, so set both.
Bun.env.NO_PROXY = '*';
Bun.env.no_proxy = '*';

const directTls = directTlsEnabled(Bun.env);
const url = `${directTls ? 'https' : 'http'}://${host.includes(':') ? `[${host}]` : host}:${port}/health`;

// A refused connection is the expected failure while the server is starting.
// Report it as one line: a stack trace here lands in `docker inspect`'s health
// log, which is the first place an operator looks.
try {
  const response = await fetch(url, directTls ? { tls: { rejectUnauthorized: false } } : undefined);
  if (response.ok) process.exit(0);
  logger.error(`unhealthy: GET ${url} returned ${response.status}`);
  process.exit(1);
} catch (error) {
  logger.error(
    `unhealthy: GET ${url} failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}

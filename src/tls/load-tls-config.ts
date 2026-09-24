import { directTlsEnabled } from '../config';

export interface TlsConfig {
  cert: ReturnType<typeof Bun.file>;
  key: ReturnType<typeof Bun.file>;
}

/**
 * Resolve direct-TLS configuration from `TLS_CERT_PATH` and `TLS_KEY_PATH`.
 *
 * - neither set: returns `undefined` (serve plain HTTP).
 * - both set with readable files: returns `BunFile` handles for `cert` and `key`.
 * - exactly one set: throws (caller logs and exits).
 * - a referenced file is missing: throws (caller logs and exits).
 *
 * Reverse-proxy or ingress TLS is preferred for most deployments; this is for
 * direct exposure, local testing, or containers that terminate TLS themselves.
 */
export async function loadTlsConfig(env: typeof Bun.env): Promise<TlsConfig | undefined> {
  if (!directTlsEnabled(env)) {
    if (env.TLS_CERT_PATH || env.TLS_KEY_PATH) {
      throw new Error('TLS misconfigured: set both TLS_CERT_PATH and TLS_KEY_PATH, or neither.');
    }
    return undefined;
  }

  const { TLS_CERT_PATH: certPath, TLS_KEY_PATH: keyPath } = env;

  const cert = Bun.file(certPath);
  const key = Bun.file(keyPath);

  if (!(await cert.exists())) {
    throw new Error(`TLS_CERT_PATH file not found: ${certPath}`);
  }
  if (!(await key.exists())) {
    throw new Error(`TLS_KEY_PATH file not found: ${keyPath}`);
  }

  return { cert, key };
}

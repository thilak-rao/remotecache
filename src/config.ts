// Listen settings shared by the server (src/main.ts, src/tls/load-tls-config.ts)
// and the container healthcheck probe (docker-healthcheck.ts), so the probe
// targets exactly what the server binds, over the same protocol.
// Side-effect free: the probe must not import main.ts, which starts a server.

type ListenEnv = Record<string, string | undefined>;

/** The `PORT` value as a number (default 3000). Not validated; main.ts rejects invalid ports. */
export const listenPort = (env: ListenEnv): number => Number(env.PORT ?? '3000');

/**
 * The `BIND_ADDRESS` value (default `0.0.0.0`). `||`, not `??`: a blank value
 * (an unset Helm value still renders the env var) means the default rather
 * than binding the process to localhost only.
 */
export const bindAddress = (env: ListenEnv): string => env.BIND_ADDRESS || '0.0.0.0';

/** Direct TLS is on only when both `TLS_CERT_PATH` and `TLS_KEY_PATH` are set. */
export const directTlsEnabled = (
  env: ListenEnv,
): env is ListenEnv & { TLS_CERT_PATH: string; TLS_KEY_PATH: string } =>
  Boolean(env.TLS_CERT_PATH && env.TLS_KEY_PATH);

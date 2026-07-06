import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const E2E_ADMIN_TOKEN = 'e2e-admin-token-0123456789abcdef';

export interface SpawnedServer {
  baseUrl: string;
  dir: string;
  stop: () => Promise<void>;
}

/**
 * Starts `src/main.ts` in a child process with an isolated temp dir for the
 * cache and token DB. Each spec gets its own server and port, so specs never
 * share module state or depend on import order.
 */
export async function spawnServer(
  port: number,
  env: Record<string, string> = {},
): Promise<SpawnedServer> {
  const dir = mkdtempSync(join(tmpdir(), 'rc-e2e-'));
  // Redirect child output to files rather than pipes: an undrained pipe could
  // fill and stall the child, and stderr still lets us surface startup failures.
  const stderrPath = join(dir, 'stderr.log');
  const stdoutPath = join(dir, 'stdout.log');
  const inheritedEnv: Record<string, string> = {};
  for (const name of ['HOME', 'PATH', 'TMPDIR', 'TEMP', 'TMP']) {
    const value = Bun.env[name];
    if (value) inheritedEnv[name] = value;
  }
  const proc = Bun.spawn(['bun', 'src/main.ts'], {
    env: {
      ...inheritedEnv,
      ADMIN_TOKEN: E2E_ADMIN_TOKEN,
      PORT: String(port),
      CACHE_DIR: join(dir, 'cache'),
      TOKENS_DB_PATH: join(dir, 'tokens.sqlite'),
      STORAGE_STRATEGY: 'filesystem',
      ...env,
    },
    stdout: Bun.file(stdoutPath),
    stderr: Bun.file(stderrPath),
  });
  const baseUrl = `http://127.0.0.1:${port}`;

  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${baseUrl}/health`)).ok) {
        return {
          baseUrl,
          dir,
          stop: async () => {
            proc.kill();
            await proc.exited;
            rmSync(dir, { recursive: true, force: true });
          },
        };
      }
    } catch {}
    await Bun.sleep(100);
  }

  proc.kill();
  await proc.exited;
  let stderr = '';
  try {
    stderr = await Bun.file(stderrPath).text();
  } catch {}
  rmSync(dir, { recursive: true, force: true });
  throw new Error(
    `remotecache did not become healthy on port ${port}${stderr ? `\n${stderr}` : ''}`,
  );
}

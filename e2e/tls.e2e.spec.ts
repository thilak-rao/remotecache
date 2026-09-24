import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { baseEnv, runHealthcheck } from './spawn-server';

const PORT = 4020;

let dir: string;
let baseUrl: string;
let proc: ReturnType<typeof Bun.spawn>;

describe('tls e2e', () => {
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'rc-tls-e2e-'));
    const keyPath = join(dir, 'key.pem');
    const certPath = join(dir, 'cert.pem');

    const gen = Bun.spawnSync([
      'openssl',
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      keyPath,
      '-out',
      certPath,
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
    ]);
    if (gen.exitCode !== 0) {
      throw new Error(`openssl failed: ${gen.stderr.toString()}`);
    }

    proc = Bun.spawn(['bun', 'src/main.ts'], {
      env: {
        ...baseEnv(),
        ADMIN_TOKEN: 'e2e-admin-token-0123456789abcdef',
        PORT: String(PORT),
        CACHE_DIR: join(dir, 'cache'),
        TOKENS_DB_PATH: join(dir, 'tokens.sqlite'),
        TLS_CERT_PATH: certPath,
        TLS_KEY_PATH: keyPath,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    let up = false;
    for (let i = 0; i < 50; i++) {
      try {
        const res = await fetch(`https://127.0.0.1:${PORT}/health`, {
          tls: { rejectUnauthorized: false },
        });
        if (res.ok) {
          up = true;
          break;
        }
      } catch {}
      await Bun.sleep(100);
    }
    if (!up) throw new Error('TLS server did not start in time');
    baseUrl = `https://127.0.0.1:${PORT}`;
  });

  afterAll(() => {
    proc?.kill();
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves /health over HTTPS without authentication', async () => {
    expect(baseUrl.startsWith('https://')).toBe(true);
    const res = await fetch(`${baseUrl}/health`, { tls: { rejectUnauthorized: false } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('OK');
  });

  it('reports healthy from the container probe when direct TLS is enabled', async () => {
    // Containers often inherit an outbound proxy; routing the loopback probe
    // through it would report the container unhealthy forever.
    const probe = await runHealthcheck({
      HTTPS_PROXY: 'http://127.0.0.1:9',
      PORT: String(PORT),
      TLS_CERT_PATH: join(dir, 'cert.pem'),
      TLS_KEY_PATH: join(dir, 'key.pem'),
    });

    expect(probe).toEqual({ exitCode: 0, stderr: '' });
  });
});

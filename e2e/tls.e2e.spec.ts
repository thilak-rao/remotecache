import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
        ...process.env,
        ADMIN_TOKEN: 'admin-token',
        PORT: '4020',
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
        const res = await fetch('https://127.0.0.1:4020/health', {
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
    baseUrl = 'https://127.0.0.1:4020';
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
});

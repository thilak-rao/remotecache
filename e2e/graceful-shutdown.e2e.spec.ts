import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('graceful shutdown e2e', () => {
  it('drains and exits 0 on SIGTERM', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rc-sigterm-'));
    const proc = Bun.spawn(['bun', 'src/main.ts'], {
      env: {
        ...process.env,
        ADMIN_TOKEN: 'admin-token',
        PORT: '4030',
        CACHE_DIR: join(dir, 'cache'),
        TOKENS_DB_PATH: join(dir, 'tokens.sqlite'),
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    let up = false;
    for (let i = 0; i < 50; i++) {
      try {
        const res = await fetch('http://127.0.0.1:4030/health');
        if (res.ok) {
          up = true;
          break;
        }
      } catch {}
      await Bun.sleep(100);
    }
    expect(up).toBe(true);

    proc.kill('SIGTERM');
    const exitCode = await proc.exited;
    rmSync(dir, { recursive: true, force: true });

    expect(exitCode).toBe(0);
  });
});

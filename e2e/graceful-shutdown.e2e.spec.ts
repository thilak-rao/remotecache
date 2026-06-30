import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('graceful shutdown e2e', () => {
  it('drains and exits 0 on SIGTERM', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rc-sigterm-'));
    const proc = Bun.spawn(['bun', 'src/main.ts'], {
      env: {
        ...Bun.env,
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

  it('drains an in-flight upload when SIGTERM arrives mid-write', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rc-sigterm-upload-'));
    const port = 4031;
    const hash = 'sigtermuploadhash01';
    const proc = Bun.spawn(['bun', 'src/main.ts'], {
      env: {
        ...Bun.env,
        ADMIN_TOKEN: 'admin-token',
        PORT: String(port),
        CACHE_DIR: join(dir, 'cache'),
        TOKENS_DB_PATH: join(dir, 'tokens.sqlite'),
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    let up = false;
    for (let i = 0; i < 50; i++) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) {
          up = true;
          break;
        }
      } catch {}
      await Bun.sleep(100);
    }
    expect(up).toBe(true);

    // Stream the upload over a raw socket so we can pause mid-body, fire
    // SIGTERM, then finish writing — exercising the drain path. A graceful
    // shutdown must let this PUT complete with 200, not cut the connection.
    const bodyBytes = new TextEncoder().encode('x'.repeat(2000));
    const reqHead =
      `PUT /v1/cache/${hash} HTTP/1.1\r\n` +
      `Host: 127.0.0.1:${port}\r\n` +
      `Authorization: Bearer admin-token\r\n` +
      `Content-Length: ${bodyBytes.length}\r\n` +
      `Connection: close\r\n\r\n`;

    let responseText = '';
    let resolveResponse: (value: string) => void;
    const responsePromise = new Promise<string>((resolve) => {
      resolveResponse = resolve;
    });
    const maybeResolve = () => {
      if (responseText.includes('\r\n')) resolveResponse(responseText);
    };

    const socket = await Bun.connect({
      hostname: '127.0.0.1',
      port,
      socket: {
        data(_s, data) {
          responseText += new TextDecoder().decode(data);
          maybeResolve();
        },
        close() {
          resolveResponse(responseText);
        },
        error() {
          resolveResponse(responseText);
        },
      },
    });

    socket.write(reqHead);
    socket.write(bodyBytes.slice(0, 1000));
    await Bun.sleep(150);
    proc.kill('SIGTERM');
    await Bun.sleep(300);
    socket.write(bodyBytes.slice(1000));

    const response = await Promise.race([
      responsePromise,
      Bun.sleep(5000).then(() => '__TIMEOUT__'),
    ]);
    const exitCode = await proc.exited;
    const stored = existsSync(join(dir, 'cache', hash));
    rmSync(dir, { recursive: true, force: true });

    expect(response.split('\r\n')[0]).toContain('200');
    expect(stored).toBe(true);
    expect(exitCode).toBe(0);
  });
});

import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { baseEnv, E2E_ADMIN_TOKEN, spawnServer } from './spawn-server';

const newHealthRequestGets200 = async (port: number): Promise<boolean> => {
  let responseText = '';
  let resolveResponse!: (value: string) => void;
  const responsePromise = new Promise<string>((resolve) => {
    resolveResponse = resolve;
  });

  try {
    const socket = await Bun.connect({
      hostname: '127.0.0.1',
      port,
      socket: {
        data(_s, data) {
          responseText += new TextDecoder().decode(data);
          if (responseText.includes('\r\n')) resolveResponse(responseText);
        },
        close() {
          resolveResponse(responseText);
        },
        error() {
          resolveResponse(responseText);
        },
      },
    });
    socket.write(
      `GET /health HTTP/1.1\r\n` + `Host: 127.0.0.1:${port}\r\n` + `Connection: close\r\n\r\n`,
    );
    const response = await Promise.race([responsePromise, Bun.sleep(500).then(() => '')]);
    try {
      socket.end();
    } catch {}
    return response.startsWith('HTTP/1.1 200') || response.startsWith('HTTP/1.0 200');
  } catch {
    return false;
  }
};

describe('graceful shutdown e2e', () => {
  it('drains and exits 0 on SIGTERM', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rc-sigterm-'));
    const proc = Bun.spawn(['bun', 'src/main.ts'], {
      env: {
        ...baseEnv(),
        ADMIN_TOKEN: 'e2e-admin-token-0123456789abcdef',
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
        ...baseEnv(),
        ADMIN_TOKEN: 'e2e-admin-token-0123456789abcdef',
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
      `Authorization: Bearer e2e-admin-token-0123456789abcdef\r\n` +
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

    expect(await newHealthRequestGets200(port)).toBe(false);

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

  it('exits after SHUTDOWN_DRAIN_TIMEOUT_MS when an upload stalls', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rc-sigterm-stall-'));
    const port = 4032;
    const proc = Bun.spawn(['bun', 'src/main.ts'], {
      env: {
        ...baseEnv(),
        ADMIN_TOKEN: 'e2e-admin-token-0123456789abcdef',
        PORT: String(port),
        CACHE_DIR: join(dir, 'cache'),
        TOKENS_DB_PATH: join(dir, 'tokens.sqlite'),
        SHUTDOWN_DRAIN_TIMEOUT_MS: '500',
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

    // Start an upload and never finish the body: without a deadline the drain
    // would wait forever and SIGKILL (exit code ≠ 0) would be the only way out.
    const socket = await Bun.connect({
      hostname: '127.0.0.1',
      port,
      socket: { data() {}, close() {}, error() {} },
    });
    socket.write(
      `PUT /v1/cache/stalleduploadhash1 HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${port}\r\n` +
        `Authorization: Bearer e2e-admin-token-0123456789abcdef\r\n` +
        `Content-Length: 2000\r\n` +
        `Connection: close\r\n\r\n`,
    );
    socket.write('x'.repeat(100));
    await Bun.sleep(150);

    const started = performance.now();
    proc.kill('SIGTERM');
    const exitCode = await proc.exited;
    const elapsed = performance.now() - started;
    socket.end();
    rmSync(dir, { recursive: true, force: true });

    expect(exitCode).toBe(0);
    expect(elapsed).toBeGreaterThanOrEqual(400);
    expect(elapsed).toBeLessThan(5000);
  }, 15000);

  it('exits promptly on SIGTERM after a 409 whose body arrived after the response', async () => {
    const port = 4033;
    const hash = 'earlyconflicthash01';
    const drainTimeoutMs = 3000;
    const server = await spawnServer(port, { SHUTDOWN_DRAIN_TIMEOUT_MS: String(drainTimeoutMs) });
    const auth = { Authorization: `Bearer ${E2E_ADMIN_TOKEN}` };
    const first = await fetch(`${server.baseUrl}/v1/cache/${hash}`, {
      method: 'PUT',
      headers: auth,
      body: 'first',
    });
    expect(first.status).toBe(200);

    // Send the headers, pause, then send the body on a keep-alive connection.
    // A server that answers 409 without reading the body responds during the
    // pause and Bun drains the body afterwards; that connection then blocks a
    // graceful stop, so SIGTERM waits out the full drain timeout with no
    // request in flight. The pause makes this ordering deterministic on every
    // OS (with fetch it depends on socket buffering).
    let responseText = '';
    let resolveStatusLine!: () => void;
    const statusLine = new Promise<void>((resolve) => {
      resolveStatusLine = resolve;
    });
    const socket = await Bun.connect({
      hostname: '127.0.0.1',
      port,
      socket: {
        data(_s, data) {
          responseText += new TextDecoder().decode(data);
          if (responseText.includes('\r\n')) resolveStatusLine();
        },
        close: () => resolveStatusLine(),
        error: () => resolveStatusLine(),
      },
    });
    const body = new Uint8Array(64 * 1024).fill(66);
    socket.write(
      `PUT /v1/cache/${hash} HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${port}\r\n` +
        `Authorization: Bearer ${E2E_ADMIN_TOKEN}\r\n` +
        `Content-Length: ${body.length}\r\n\r\n`,
    );
    await Bun.sleep(200);
    // A short write would leave the body incomplete, a different state.
    expect(socket.write(body)).toBe(body.length);
    await Promise.race([statusLine, Bun.sleep(2000)]);
    expect(responseText.split('\r\n')[0]).toContain('409');
    await Bun.sleep(200);

    const started = performance.now();
    await server.stop();
    const elapsed = performance.now() - started;
    socket.end();

    expect(elapsed).toBeLessThan(drainTimeoutMs / 2);
  }, 15000);

  it('delivers a download still streaming when SIGTERM arrives', async () => {
    const port = 4034;
    const hash = 'streamingdownload01';
    const drainTimeoutMs = 5000;
    const server = await spawnServer(port, { SHUTDOWN_DRAIN_TIMEOUT_MS: String(drainTimeoutMs) });
    // Larger than loopback socket buffers, so the response cannot finish
    // while the client is paused.
    const artifact = new Uint8Array(32 * 1024 * 1024).fill(67);
    const put = await fetch(`${server.baseUrl}/v1/cache/${hash}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${E2E_ADMIN_TOKEN}` },
      body: artifact,
    });
    expect(put.status).toBe(200);

    let received = 0;
    let resolveClosed!: () => void;
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    const socket = await Bun.connect({
      hostname: '127.0.0.1',
      port,
      socket: {
        data(_s, data) {
          received += data.byteLength;
        },
        close: () => resolveClosed(),
        error: () => resolveClosed(),
      },
    });
    // Stop reading before the response starts, so it stays in flight after
    // the handler has returned.
    socket.pause();
    socket.write(
      `GET /v1/cache/${hash} HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${port}\r\n` +
        `Authorization: Bearer ${E2E_ADMIN_TOKEN}\r\n` +
        `Connection: close\r\n\r\n`,
    );
    await Bun.sleep(300);
    expect(received).toBeLessThan(artifact.length);

    const stopped = server.stop();
    await Bun.sleep(300);
    socket.resume();
    await Promise.race([closed, Bun.sleep(drainTimeoutMs)]);
    await stopped;

    // Status line and headers precede the body, so a complete download
    // delivers more than the artifact's byte count.
    expect(received).toBeGreaterThan(artifact.length);
  }, 20000);
});

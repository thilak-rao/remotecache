import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { baseEnv } from './spawn-server';

async function runStartup(
  env: Record<string, string>,
): Promise<{ exitCode: number | null; stderr: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'rc-startup-'));
  let proc: Bun.ReadableSubprocess | undefined;

  try {
    proc = Bun.spawn(['bun', 'src/main.ts'], {
      env: {
        ...baseEnv(),
        ADMIN_TOKEN: 'e2e-admin-token-0123456789abcdef',
        PORT: '4014',
        CACHE_DIR: join(dir, 'cache'),
        TOKENS_DB_PATH: join(dir, 'tokens.sqlite'),
        ...env,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const exitCode = await Promise.race([proc.exited, Bun.sleep(1000).then(() => null)]);
    if (exitCode === null) proc.kill();
    await proc.exited;
    const stderr = await new Response(proc.stderr).text();
    return { exitCode, stderr };
  } finally {
    try {
      if (proc?.exitCode === null) {
        proc.kill();
        await proc.exited;
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

describe('startup validation e2e', () => {
  it('refuses to start when ADMIN_TOKEN is shorter than 16 characters', async () => {
    const { exitCode, stderr } = await runStartup({ ADMIN_TOKEN: 'short' });

    expect(exitCode).toBe(1);
    expect(stderr).toContain('at least 16 characters');
  });

  it('refuses to start on an unknown STORAGE_STRATEGY', async () => {
    const { exitCode, stderr } = await runStartup({ STORAGE_STRATEGY: 'azure' });

    expect(exitCode).toBe(1);
    expect(stderr).toContain('Unknown STORAGE_STRATEGY');
  });

  it('refuses to start when gcs storage has no bucket', async () => {
    const { exitCode, stderr } = await runStartup({ STORAGE_STRATEGY: 'gcs' });

    expect(exitCode).toBe(1);
    expect(stderr).toContain('GCS_BUCKET');
  });

  it('refuses to start when eviction is configured with s3 storage', async () => {
    const { exitCode, stderr } = await runStartup({
      STORAGE_STRATEGY: 's3',
      S3_BUCKET: 'irrelevant',
      S3_REGION: 'us-east-1',
      CACHE_MAX_BYTES: '1000000',
    });

    expect(exitCode).toBe(1);
    expect(stderr).toContain('apply only to STORAGE_STRATEGY=filesystem');
    expect(stderr).toContain('object storage');
    expect(stderr).toContain('lifecycle rules');
  });

  it('refuses to start when eviction is configured with gcs storage', async () => {
    const { exitCode, stderr } = await runStartup({
      STORAGE_STRATEGY: 'gcs',
      GCS_BUCKET: 'irrelevant',
      CACHE_MAX_BYTES: '1000000',
    });

    expect(exitCode).toBe(1);
    expect(stderr).toContain('apply only to STORAGE_STRATEGY=filesystem');
    expect(stderr).toContain('object storage');
    expect(stderr).toContain('lifecycle rules');
  });

  it.each([
    ['PORT', '4014.5'],
    ['MAX_UPLOAD_BYTES', '1.5'],
    ['SHUTDOWN_DRAIN_TIMEOUT_MS', '1.5'],
    ['CACHE_MAX_BYTES', '1.5'],
    ['CACHE_SWEEP_INTERVAL_MS', '1.5'],
    ['MAX_UPLOAD_BYTES', '9007199254740992'],
  ])('refuses to start when %s=%s', async (name, value) => {
    const { exitCode, stderr } = await runStartup({ [name]: value });

    expect(exitCode).toBe(1);
    expect(stderr).toContain(name);
  });

  it('refuses a cache sweep interval above the timer delay limit', async () => {
    const { exitCode, stderr } = await runStartup({
      CACHE_MAX_BYTES: '1',
      CACHE_SWEEP_INTERVAL_MS: '2147483648',
    });

    expect(exitCode).toBe(1);
    expect(stderr).toContain('CACHE_SWEEP_INTERVAL_MS');
  });

  it('starts with the maximum supported cache sweep interval', async () => {
    const { exitCode } = await runStartup({
      CACHE_MAX_BYTES: '1',
      CACHE_SWEEP_INTERVAL_MS: '2147483647',
    });

    expect(exitCode).toBeNull();
  });

  it('refuses a cache TTL whose millisecond conversion overflows', async () => {
    const { exitCode, stderr } = await runStartup({ CACHE_TTL_HOURS: '1e308' });

    expect(exitCode).toBe(1);
    expect(stderr).toContain('CACHE_TTL_HOURS');
  });
});

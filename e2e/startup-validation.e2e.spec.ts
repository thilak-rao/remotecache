import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { baseEnv } from './spawn-server';

describe('startup validation e2e', () => {
  it('refuses to start when ADMIN_TOKEN is shorter than 16 characters', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rc-startup-'));
    const proc = Bun.spawn(['bun', 'src/main.ts'], {
      env: {
        ...baseEnv(),
        ADMIN_TOKEN: 'short',
        PORT: '4014',
        CACHE_DIR: join(dir, 'cache'),
        TOKENS_DB_PATH: join(dir, 'tokens.sqlite'),
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();
    rmSync(dir, { recursive: true, force: true });

    expect(exitCode).toBe(1);
    expect(stderr).toContain('at least 16 characters');
  });

  it('refuses to start on an unknown STORAGE_STRATEGY', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rc-startup-storage-'));
    const proc = Bun.spawn(['bun', 'src/main.ts'], {
      env: {
        ...baseEnv(),
        ADMIN_TOKEN: 'e2e-admin-token-0123456789abcdef',
        PORT: '4014',
        STORAGE_STRATEGY: 'gcs',
        CACHE_DIR: join(dir, 'cache'),
        TOKENS_DB_PATH: join(dir, 'tokens.sqlite'),
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();
    rmSync(dir, { recursive: true, force: true });

    expect(exitCode).toBe(1);
    expect(stderr).toContain('Unknown STORAGE_STRATEGY');
  });

  it('refuses to start when eviction is configured with the s3 strategy', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rc-startup-eviction-'));
    const proc = Bun.spawn(['bun', 'src/main.ts'], {
      env: {
        ...baseEnv(),
        ADMIN_TOKEN: 'e2e-admin-token-0123456789abcdef',
        PORT: '4014',
        STORAGE_STRATEGY: 's3',
        S3_BUCKET: 'irrelevant',
        S3_REGION: 'us-east-1',
        CACHE_MAX_BYTES: '1000000',
        TOKENS_DB_PATH: join(dir, 'tokens.sqlite'),
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();
    rmSync(dir, { recursive: true, force: true });

    expect(exitCode).toBe(1);
    expect(stderr).toContain('lifecycle rules');
  });
});

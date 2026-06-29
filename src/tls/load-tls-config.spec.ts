import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTlsConfig } from './load-tls-config';

const asEnv = (o: Record<string, string>) => o as unknown as typeof Bun.env;

describe('loadTlsConfig', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rc-tls-cfg-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns undefined when neither path is set', async () => {
    expect(await loadTlsConfig(asEnv({}))).toBeUndefined();
  });

  it('throws when only one path is set', async () => {
    await expect(loadTlsConfig(asEnv({ TLS_CERT_PATH: '/x/cert.pem' }))).rejects.toThrow(/both/i);
    await expect(loadTlsConfig(asEnv({ TLS_KEY_PATH: '/x/key.pem' }))).rejects.toThrow(/both/i);
  });

  it('throws when a referenced file is missing', async () => {
    const cert = join(dir, 'cert.pem');
    writeFileSync(cert, 'cert');
    await expect(
      loadTlsConfig(asEnv({ TLS_CERT_PATH: cert, TLS_KEY_PATH: join(dir, 'missing.pem') })),
    ).rejects.toThrow(/not found/i);
  });

  it('returns file handles when both files exist', async () => {
    const cert = join(dir, 'cert.pem');
    const key = join(dir, 'key.pem');
    writeFileSync(cert, 'cert-bytes');
    writeFileSync(key, 'key-bytes');
    const cfg = await loadTlsConfig(asEnv({ TLS_CERT_PATH: cert, TLS_KEY_PATH: key }));
    expect(cfg).toBeDefined();
    expect(await cfg!.cert.text()).toBe('cert-bytes');
    expect(await cfg!.key.text()).toBe('key-bytes');
  });
});

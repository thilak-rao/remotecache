import { afterEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { TokenStorage } from './token-storage';
import { hashToken } from './hash-token';

const dbDirs = new Set<string>();

const freshDbPath = async () => {
  const dir = join(tmpdir(), `nx-cache-token-db-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  dbDirs.add(dir);
  return join(dir, 'tokens.sqlite');
};

afterEach(async () => {
  await Promise.all([...dbDirs].map((dir) => fs.rm(dir, { recursive: true, force: true })));
  dbDirs.clear();
});

const readStoredValue = (dbPath: string, id: string) => {
  const db = new Database(dbPath, { strict: true });
  const row = db.query('SELECT value FROM tokens WHERE id = $id').get({ id }) as {
    value: string;
  } | null;
  db.close();
  return row?.value;
};

describe('TokenStorage', () => {
  it('creates the sqlite db at the provided path and looks tokens up by raw value', async () => {
    const dbPath = await freshDbPath();
    const storage = new TokenStorage(dbPath);
    const token = { id: 't1', value: 'value-1', permission: 'readonly' as const };

    expect(storage.addToken(token)).toEqual({ result: true, error: null });
    expect(storage.findToken(token.value)).toEqual({ id: 't1', permission: 'readonly' });

    const stat = await fs.stat(dbPath);
    expect(stat.isFile()).toBe(true);
  });

  it('stores the hash of the token, never the plaintext value', async () => {
    const dbPath = await freshDbPath();
    const storage = new TokenStorage(dbPath);
    storage.addToken({ id: 't1', value: 'value-1', permission: 'full' });

    expect(readStoredValue(dbPath, 't1')).toBe(hashToken('value-1'));
    expect(readStoredValue(dbPath, 't1')).not.toBe('value-1');
  });

  it('removes a token by its id', async () => {
    const dbPath = await freshDbPath();
    const storage = new TokenStorage(dbPath);
    storage.addToken({ id: 't1', value: 'value-1', permission: 'readonly' });

    expect(storage.removeTokenById('t1')).toEqual({ result: true, error: null });
    expect(storage.findToken('value-1')).toBeNull();
    expect(storage.removeTokenById('t1')).toEqual({ result: false, error: null });
  });

  it('lists tokens as id + permission only, without any value', async () => {
    const dbPath = await freshDbPath();
    const storage = new TokenStorage(dbPath);
    storage.addToken({ id: 'b', value: 'value-b', permission: 'readonly' });
    storage.addToken({ id: 'a', value: 'value-a', permission: 'full' });

    expect(storage.listTokens()).toEqual([
      { id: 'a', permission: 'full' },
      { id: 'b', permission: 'readonly' },
    ]);
  });

  it('migrates a pre-existing plaintext database to hashed values on open', async () => {
    const dbPath = await freshDbPath();

    // Simulate the old format: plaintext value, user_version still 0.
    const legacy = new Database(dbPath, { create: true, strict: true });
    legacy.run(`
      CREATE TABLE IF NOT EXISTS tokens (
        id TEXT NOT NULL UNIQUE,
        value TEXT PRIMARY KEY,
        permission TEXT NOT NULL CHECK (permission IN ('readonly', 'full'))
      );
    `);
    legacy.run(
      "INSERT INTO tokens (id, value, permission) VALUES ('legacy', 'plaintext-token', 'full')",
    );
    legacy.close();

    const storage = new TokenStorage(dbPath);

    // The original token still authenticates after migration...
    expect(storage.findToken('plaintext-token')).toEqual({ id: 'legacy', permission: 'full' });
    // ...and the plaintext is gone from disk.
    expect(readStoredValue(dbPath, 'legacy')).toBe(hashToken('plaintext-token'));
    expect(readStoredValue(dbPath, 'legacy')).not.toBe('plaintext-token');
  });

  it("migrates when one plaintext token equals another token's hash", async () => {
    const dbPath = await freshDbPath();
    const hashLookingToken = hashToken('a');
    const legacy = new Database(dbPath, { create: true, strict: true });
    legacy.run(`
      CREATE TABLE IF NOT EXISTS tokens (
        id TEXT NOT NULL UNIQUE,
        value TEXT PRIMARY KEY,
        permission TEXT NOT NULL CHECK (permission IN ('readonly', 'full'))
      );
    `);
    const insert = legacy.query(
      'INSERT INTO tokens (id, value, permission) VALUES ($id, $value, $permission)',
    );
    insert.run({ id: 'plain', value: 'a', permission: 'full' });
    insert.run({ id: 'hash-looking', value: hashLookingToken, permission: 'readonly' });
    legacy.close();

    const storage = new TokenStorage(dbPath);

    expect(storage.findToken('a')).toEqual({ id: 'plain', permission: 'full' });
    expect(storage.findToken(hashLookingToken)).toEqual({
      id: 'hash-looking',
      permission: 'readonly',
    });
  });

  it('checks readiness through the operational token columns', async () => {
    const dbPath = await freshDbPath();
    const storage = new TokenStorage(dbPath);

    await expect(storage.checkReady()).resolves.toBeUndefined();
  });

  it('fails readiness when the tokens table is unusable', async () => {
    const dbPath = await freshDbPath();
    const storage = new TokenStorage(dbPath);
    const corruptor = new Database(dbPath, { strict: true });
    corruptor.run('DROP TABLE tokens');
    corruptor.close();

    await expect(storage.checkReady()).rejects.toThrow();
  });
});

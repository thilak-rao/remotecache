import { Database, SQLiteError } from 'bun:sqlite';
import { TokenRecord, TokenSummary } from './token-interfaces';
import { logger } from '../logger';
import { hashToken } from './hash-token';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type DatabaseOperation<DatabaseError> =
  | { result: true; error: null }
  | { result: false; error: DatabaseError };

type UnknownError = 'unknownError';
type AddTokenError = 'tokenIdAlreadyExists' | 'tokenValueAlreadyExists' | UnknownError;

// Bumped whenever the on-disk token format changes. Version 1 means the `value`
// column holds a SHA-256 hash of the token rather than its plaintext.
const SCHEMA_VERSION = 1;

export class TokenStorage {
  readonly #db: Database;

  constructor(dbPath: string = './data/nx-cache-server-tokens.sqlite') {
    mkdirSync(dirname(dbPath), { recursive: true });

    this.#db = new Database(dbPath, { create: true, strict: true });

    this.#db.run(`
      CREATE TABLE IF NOT EXISTS tokens (
        id TEXT NOT NULL UNIQUE,
        value TEXT PRIMARY KEY,
        permission TEXT NOT NULL CHECK (permission IN ('readonly', 'full'))
      );
    `);

    this.#migrateToHashedTokens();
  }

  /**
   * Hashes any plaintext token values left over from before tokens were hashed
   * at rest. A raw token like `abc` and its hash are both 64-hex strings once
   * generated, so the format alone cannot tell them apart; `PRAGMA user_version`
   * is the durable marker that records whether this database has been migrated.
   * Existing tokens keep working because lookups hash the incoming value too.
   */
  #migrateToHashedTokens() {
    const versionRow = this.#db.query('PRAGMA user_version').get() as {
      user_version: number;
    } | null;
    if ((versionRow?.user_version ?? 0) >= SCHEMA_VERSION) return;

    const legacyValues = this.#db
      .query<{ value: string }, Record<string, never>>('SELECT value FROM tokens')
      .all({});
    const update = this.#db.query('UPDATE tokens SET value = $hash WHERE value = $value');

    const migrate = this.#db.transaction((rows: { value: string }[]) => {
      for (const { value } of rows) {
        update.run({ value, hash: hashToken(value) });
      }
      this.#db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    });
    migrate(legacyValues);
  }

  #getAddTokenError({ code, message }: SQLiteError): AddTokenError {
    let error: AddTokenError = 'unknownError';

    if (code === 'SQLITE_CONSTRAINT_UNIQUE') {
      if (message.includes('tokens.id')) {
        error = 'tokenIdAlreadyExists';
      }
      if (message.includes('tokens.value')) {
        error = 'tokenValueAlreadyExists';
      }
    }
    return error;
  }

  addToken({ id, value, permission }: TokenRecord): DatabaseOperation<AddTokenError> {
    const insertStatement = this.#db.query(
      'INSERT INTO tokens (id, value, permission) VALUES ($id, $value, $permission)',
    );

    try {
      insertStatement.run({ id, value: hashToken(value), permission });
      return { result: true, error: null };
    } catch (exception: unknown) {
      logger.error(exception);
      return { result: false, error: this.#getAddTokenError(exception as SQLiteError) };
    }
  }

  removeToken(value: string): DatabaseOperation<UnknownError> {
    const deleteStatement = this.#db.query('DELETE FROM tokens WHERE value = $value');

    try {
      const deleted = deleteStatement.run({ value: hashToken(value) });
      return { result: deleted.changes > 0, error: null };
    } catch (error) {
      logger.error(error);
      return { result: false, error: 'unknownError' };
    }
  }

  listTokens(): TokenSummary[] {
    const selectStatement = this.#db.query<TokenSummary, Record<string, never>>(
      'SELECT id, permission FROM tokens ORDER BY id ASC',
    );

    try {
      return selectStatement.all({}) ?? [];
    } catch (error) {
      logger.error(error);
      return [];
    }
  }

  findToken(value: string): TokenSummary | null {
    const selectStatement = this.#db.query<TokenSummary, Pick<TokenRecord, 'value'>>(
      'SELECT id, permission FROM tokens WHERE value = $value LIMIT 1',
    );

    try {
      return selectStatement.get({ value: hashToken(value) }) ?? null;
    } catch (error) {
      logger.error(error);
      return null;
    }
  }
}

import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { logger } from '../logger';
import { resolveToken } from './resolve-token';

const ADMIN_TOKEN = 'admin-token-0123456789';

const makeStorage = (findToken: ReturnType<typeof mock>) => ({ findToken });

describe('resolveToken', () => {
  afterEach(() => {
    mock.restore();
  });

  it('resolves the admin token to full admin access without a store lookup', () => {
    const storage = makeStorage(mock());

    expect(resolveToken(ADMIN_TOKEN, storage, ADMIN_TOKEN)).toEqual({
      permission: 'full',
      isAdmin: true,
      authFailed: false,
    });
    expect(storage.findToken).not.toHaveBeenCalled();
  });

  it('counts a missing token as an authentication failure', () => {
    const storage = makeStorage(mock());

    expect(resolveToken('', storage, ADMIN_TOKEN)).toEqual({
      permission: null,
      isAdmin: false,
      authFailed: true,
    });
  });

  it('counts an unknown token as an authentication failure', () => {
    const storage = makeStorage(mock().mockReturnValue(null));

    expect(resolveToken('guess', storage, ADMIN_TOKEN)).toEqual({
      permission: null,
      isAdmin: false,
      authFailed: true,
    });
  });

  it('resolves a known token to its permission', () => {
    const storage = makeStorage(mock().mockReturnValue({ id: 'ci', permission: 'readonly' }));

    expect(resolveToken('ci-token', storage, ADMIN_TOKEN)).toEqual({
      permission: 'readonly',
      isAdmin: false,
      authFailed: false,
    });
  });

  it('denies but does not count a request the token store fails to resolve', () => {
    // A database fault must not feed the auth throttle: every client with a
    // valid token would be 429ed as a guesser while the store is down.
    const logError = spyOn(logger, 'error').mockImplementation(() => {});
    const storage = makeStorage(
      mock(() => {
        throw new Error('database is locked');
      }),
    );

    expect(resolveToken('ci-token', storage, ADMIN_TOKEN)).toEqual({
      permission: null,
      isAdmin: false,
      authFailed: false,
    });
    expect(logError).toHaveBeenCalled();
  });
});

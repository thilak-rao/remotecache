import { describe, expect, it, mock } from 'bun:test';
import { addToken } from './add-token';
import { TokenStorage } from './token-storage';

const logger = { error: mock() };
mock.module('../logger', () => ({ logger }));

describe('addToken', () => {
  it('returns 403 when caller lacks admin rights and does not call storage', async () => {
    const storage = { addToken: mock() };
    const jsonBody = mock();
    const response = await addToken(false, storage, jsonBody);

    expect(response.status).toBe(403);
    expect(response.headers.get('Content-Type')).toBe('text/plain');
    expect(await response.text()).toBe('Access forbidden');
    expect(storage.addToken).not.toHaveBeenCalled();
    expect(jsonBody).not.toHaveBeenCalled();
  });

  it('rejects invalid JSON bodies', async () => {
    const storage = { addToken: mock() };
    const jsonBodyError = new Error('boom');
    const jsonBody = mock().mockRejectedValue(jsonBodyError);
    const response = await addToken(true, storage, jsonBody);

    expect(response.status).toBe(400);
    expect(await response.text()).toBe('Invalid JSON body');
    expect(storage.addToken).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(jsonBodyError);
  });

  it('rejects non-object bodies', async () => {
    const storage = { addToken: mock() };
    const jsonBody = mock().mockResolvedValue('not-object');
    const response = await addToken(true, storage, jsonBody);

    expect(response.status).toBe(400);
    expect(await response.text()).toBe('Invalid JSON body');
    expect(storage.addToken).not.toHaveBeenCalled();
  });

  it('requires id and permission validation', async () => {
    const storage = { addToken: mock() };
    const jsonBody = mock()
      .mockResolvedValueOnce({ permission: 'full' })
      .mockResolvedValueOnce({ id: 'x', permission: 'bad' });

    const missingId = await addToken(true, storage, jsonBody);
    expect(missingId.status).toBe(400);
    expect(await missingId.text()).toBe('id is required and must be a string');

    const badPermission = await addToken(true, storage, jsonBody);
    expect(badPermission.status).toBe(400);
    expect(await badPermission.text()).toBe(
      'permission is required, must be a string and one of: full, readonly',
    );

    expect(storage.addToken).not.toHaveBeenCalled();
  });

  it('returns conflicts for duplicate id or value', async () => {
    const storage = {
      addToken: mock<TokenStorage['addToken']>()
        .mockReturnValueOnce({ result: false, error: 'tokenIdAlreadyExists' })
        .mockReturnValueOnce({ result: false, error: 'tokenValueAlreadyExists' }),
    };
    const jsonBody = mock()
      .mockResolvedValueOnce({ id: 'x', permission: 'full' })
      .mockResolvedValueOnce({ id: 'y', permission: 'full' });

    const first = await addToken(true, storage, jsonBody);
    expect(first.status).toBe(409);
    expect(await first.text()).toBe('Conflict: token id already exists');

    const second = await addToken(true, storage, jsonBody);
    expect(second.status).toBe(409);
    expect(await second.text()).toBe('Conflict: token value already exists');

    expect(storage.addToken).toHaveBeenCalledTimes(2);
  });

  it('returns 500 on unknown add error', async () => {
    const storage = {
      addToken: mock<TokenStorage['addToken']>().mockReturnValue({
        result: false,
        error: 'unknownError',
      }),
    };
    const jsonBody = mock().mockResolvedValue({
      id: 'x',
      permission: 'readonly',
    });

    const response = await addToken(true, storage, jsonBody);

    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Failed to add token');
  });

  it('returns 200 with JSON body when token is added', async () => {
    const storage = {
      addToken: mock<TokenStorage['addToken']>().mockReturnValue({ result: true, error: null }),
    };
    const jsonBody = mock().mockResolvedValue({
      id: 'x',
      permission: 'readonly',
    });

    const response = await addToken(true, storage, jsonBody);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    const body = await response.text();

    const expectedTokenRecord = {
      id: 'x',
      permission: 'readonly',
      value: expect.any(String),
    };

    expect(JSON.parse(body)).toEqual(expectedTokenRecord);
    expect(storage.addToken).toHaveBeenCalledWith(expectedTokenRecord);
  });
});

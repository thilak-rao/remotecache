import { describe, expect, it, mock } from 'bun:test';
import { listTokens } from './list-tokens';
import { TokenSummary } from './token-interfaces';
import { TokenStorage } from './token-storage';

const createMockedStorage = (tokens: ReturnType<TokenStorage['listTokens']>) => ({
  listTokens: mock().mockReturnValue(tokens),
});

describe('listTokens', () => {
  it('returns 403 when caller lacks admin rights', async () => {
    const storage = createMockedStorage([]);
    const response = listTokens(false, storage);

    expect(response.status).toBe(403);
    expect(response.headers.get('Content-Type')).toBe('text/plain');
    expect(await response.text()).toBe('Access forbidden');
    expect(storage.listTokens).not.toHaveBeenCalled();
  });

  it('returns id + permission token summaries as JSON with status 200 for an admin', async () => {
    const tokens: TokenSummary[] = [
      { id: 'a', permission: 'full' },
      { id: 'b', permission: 'readonly' },
    ];
    const response = listTokens(true, createMockedStorage(tokens));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');

    const body = await response.text();
    const parsed = JSON.parse(body);
    expect(parsed).toEqual({ tokens });
  });
});

import { describe, expect, it, vi } from 'vitest';
import { ApiError, buildQuery, createApi } from './api';

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function setup(responses: Response[], token: string | null = 'tok') {
  const fetchImpl = vi.fn(async () => responses.shift()!);
  const refreshToken = vi.fn(async () => 'nuovo');
  const api = createApi({ baseUrl: 'https://api.test', getToken: async () => token, refreshToken, fetchImpl: fetchImpl as unknown as typeof fetch });
  return { api, fetchImpl, refreshToken };
}

describe('client API', () => {
  it('costruisce la query ignorando i valori vuoti', () => {
    expect(buildQuery({ city: 'Roma', rooms: 2, minPrice: undefined, maxPrice: NaN, x: '' })).toBe('?city=Roma&rooms=2');
    expect(buildQuery({})).toBe('');
  });

  it('GET pubblico: nessun Authorization', async () => {
    const { api, fetchImpl } = setup([json(200, { items: [], total: 0 })]);
    await api.listProperties({ city: 'Roma', limit: 12 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/properties?city=Roma&limit=12');
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('chiamata autenticata: Bearer con l\'access token e body JSON', async () => {
    const { api, fetchImpl } = setup([json(201, { id: '1' })]);
    await api.createOffer('5', { amount: 100 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/properties/5/offers');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(init.body).toBe('{"amount":100}');
  });

  it('204 -> undefined', async () => {
    const { api } = setup([new Response(null, { status: 204 })]);
    await expect(api.deleteFile('9')).resolves.toBeUndefined();
  });

  it('errore nel formato del contratto', async () => {
    const { api } = setup([json(403, { error: { code: 'FORBIDDEN', message: 'Non sei il proprietario' } })]);
    await expect(api.deleteProperty('1')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN', message: 'Non sei il proprietario' });
  });

  it('errore con body non JSON', async () => {
    const { api } = setup([new Response('Bad Gateway', { status: 502 })]);
    const e = await api.listProperties().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 502, code: 'HTTP_502' });
  });

  it('errore di rete -> ApiError NETWORK', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('failed'); });
    const api = createApi({ baseUrl: 'x', getToken: async () => null, fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(api.listProperties()).rejects.toMatchObject({ status: 0, code: 'NETWORK' });
  });

  it('senza token una chiamata autenticata fallisce senza rete', async () => {
    const { api, fetchImpl } = setup([], null);
    await expect(api.getMe()).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('su 401 rinnova il token e ritenta una volta', async () => {
    const { api, fetchImpl, refreshToken } = setup([json(401, { message: 'Unauthorized' }), json(200, { sub: 'a' })]);
    await expect(api.getMe()).resolves.toEqual({ sub: 'a' });
    expect(refreshToken).toHaveBeenCalledOnce();
    const init = (fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer nuovo');
  });

  it('410 su PUT /users/me e\' riconoscibile', async () => {
    const { api } = setup([json(410, { error: { code: 'GONE', message: 'Utente cancellato' } })]);
    await expect(api.putMe({})).rejects.toMatchObject({ status: 410 });
  });
});

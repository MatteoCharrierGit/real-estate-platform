// Client API tipizzato (fetch). Le chiamate autenticate portano l'ACCESS token (mai l'ID token):
// `Authorization: Bearer <access token>`. Errori nel formato del contratto:
//   {"error": {"code": "FORBIDDEN", "message": "..."}}  con status 400/401/403/404/409/410/422/500.
import type {
  FileItem, Offer, PresignedPost, Property, PropertyFilters, PropertyInput, PublicUser, User,
} from './types';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiDeps {
  baseUrl: string;
  /** Restituisce un access token valido (rinnovandolo se serve) o null se l'utente non e' loggato. */
  getToken: () => Promise<string | null>;
  /** Chiamato su 401 per tentare il rinnovo forzato; ritorna il nuovo token o null. */
  refreshToken?: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

interface ReqOpts {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  auth?: boolean;
}

export function buildQuery(q: Record<string, string | number | undefined> = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== '' && !(typeof v === 'number' && Number.isNaN(v))) p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Estrae {status, code, message} da una risposta non OK, tollerando body vuoti o non JSON. */
export async function parseError(res: Response): Promise<ApiError> {
  let code = 'HTTP_' + res.status;
  let message = `Errore ${res.status}`;
  try {
    const data = (await res.json()) as { error?: { code?: string; message?: string } };
    if (data?.error) {
      code = data.error.code ?? code;
      message = data.error.message ?? message;
    }
  } catch {
    /* body non JSON (es. 401 dell'authorizer o 5xx del gateway): restano i valori di default */
  }
  return new ApiError(res.status, code, message);
}

export function createApi(deps: ApiDeps) {
  const f = deps.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));

  async function send(method: string, path: string, opts: ReqOpts, token: string | null): Promise<Response> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    try {
      return await f(`${deps.baseUrl}${path}${buildQuery(opts.query)}`, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
    } catch {
      throw new ApiError(0, 'NETWORK', 'Impossibile contattare il server. Controlla la connessione e riprova.');
    }
  }

  async function request<T>(method: string, path: string, opts: ReqOpts = {}): Promise<T> {
    let token: string | null = null;
    if (opts.auth) {
      token = await deps.getToken();
      if (!token) throw new ApiError(401, 'UNAUTHENTICATED', 'Devi accedere per continuare.');
    }
    let res = await send(method, path, opts, token);
    if (res.status === 401 && opts.auth && deps.refreshToken) {
      const fresh = await deps.refreshToken();
      if (fresh) res = await send(method, path, opts, fresh);
    }
    if (!res.ok) throw await parseError(res);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  const A = { auth: true };
  return {
    request,
    listProperties: (f: PropertyFilters = {}) =>
      request<{ items: Property[]; total: number }>('GET', '/properties', { query: { ...f } }),
    getProperty: (id: string) =>
      request<{ property: Property; agent: PublicUser | null }>('GET', `/properties/${enc(id)}`),
    createProperty: (b: PropertyInput) => request<Property>('POST', '/properties', { ...A, body: b }),
    updateProperty: (id: string, b: Partial<PropertyInput>) =>
      request<Property>('PUT', `/properties/${enc(id)}`, { ...A, body: b }),
    deleteProperty: (id: string) => request<void>('DELETE', `/properties/${enc(id)}`, A),

    getMe: () => request<User>('GET', '/users/me', A),
    /** 201 se la riga e' stata creata, 200 se aggiornata, 410 (ApiError) se l'utente aveva gia' cancellato i dati. */
    putMe: (b: { displayName?: string; phone?: string; bio?: string } = {}) =>
      request<User>('PUT', '/users/me', { ...A, body: b }),
    deleteMe: () => request<void>('DELETE', '/users/me', A),
    getUser: (id: string) => request<PublicUser>('GET', `/users/${enc(id)}`),

    createOffer: (propertyId: string, b: { amount: number; message?: string }) =>
      request<Offer>('POST', `/properties/${enc(propertyId)}/offers`, { ...A, body: b }),
    listOffers: () => request<{ items: Offer[] }>('GET', '/offers', A),
    decideOffer: (id: string, status: 'accepted' | 'rejected') =>
      request<Offer>('PUT', `/offers/${enc(id)}`, { ...A, body: { status } }),
    withdrawOffer: (id: string) => request<void>('DELETE', `/offers/${enc(id)}`, A),

    requestUpload: (propertyId: string, b: { contentType: string; size: number }) =>
      request<PresignedPost>('POST', `/properties/${enc(propertyId)}/uploads`, { ...A, body: b }),
    listFiles: (propertyId: string) =>
      request<{ items: FileItem[] }>('GET', `/properties/${enc(propertyId)}/files`),
    deleteFile: (id: string) => request<void>('DELETE', `/files/${enc(id)}`, A),
  };
}

const enc = encodeURIComponent;
export type Api = ReturnType<typeof createApi>;

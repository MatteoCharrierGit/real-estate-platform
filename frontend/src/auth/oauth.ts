// Flusso OAuth 2.0 authorization code + PKCE verso il login gestito di Cognito, scritto a mano.
import { config } from '../config';
import { createPkce } from '../lib/pkce';
import { deleteCognitoUser, revokeRefreshToken } from '../lib/cognito';
import { ApiError } from '../lib/api';
import {
  PKCE_KEY, clearSession, getState, getTokens, safe, setAnonymous, setNotice, setTokens, type Tokens,
} from './session';
import { api } from '../apiInstance';

const SCOPE = 'openid email aws.cognito.signin.user.admin';
const redirectUri = () => `${window.location.origin}/callback`;

export type LoginPurpose = 'login' | 'delete-account';

interface PendingLogin {
  verifier: string;
  state: string;
  returnTo: string;
  purpose: LoginPurpose;
  silent: boolean;
}

export interface LoginOptions {
  returnTo?: string;
  /** prompt=login: forza una nuova autenticazione anche se il cookie del login gestito e' ancora valido. */
  forceLogin?: boolean;
  /** Apre la schermata di registrazione (/signup) invece del login. */
  signup?: boolean;
  /** prompt=none: giro silenzioso, fallisce con login_required se non c'e' una sessione valida. */
  silent?: boolean;
  purpose?: LoginPurpose;
}

/** Costruisce l'URL del login gestito (funzione pura rispetto a verifier/challenge/state forniti). */
export function buildAuthorizeUrl(p: {
  challenge: string; state: string; signup?: boolean; prompt?: 'login' | 'none';
}): string {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: redirectUri(),
    scope: SCOPE,
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
    state: p.state,
  });
  if (p.prompt) q.set('prompt', p.prompt);
  return `${config.cognitoDomain}${p.signup ? '/signup' : '/oauth2/authorize'}?${q}`;
}

export async function startLogin(opts: LoginOptions = {}): Promise<void> {
  const { verifier, challenge, state } = await createPkce();
  const pending: PendingLogin = {
    verifier,
    state,
    returnTo: opts.returnTo ?? '/',
    purpose: opts.purpose ?? 'login',
    silent: !!opts.silent,
  };
  safe(() => sessionStorage.setItem(PKCE_KEY, JSON.stringify(pending)));
  const prompt = opts.silent ? 'none' : opts.forceLogin ? 'login' : undefined;
  window.location.assign(buildAuthorizeUrl({ challenge, state, signup: opts.signup, prompt }));
}

async function tokenRequest(params: Record<string, string>): Promise<Tokens> {
  const res = await fetch(`${config.cognitoDomain}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.clientId, ...params }),
  });
  if (!res.ok) throw new Error(`Cognito ha rifiutato la richiesta di token (${res.status}).`);
  const d = (await res.json()) as {
    id_token: string; access_token: string; refresh_token?: string; expires_in: number;
  };
  return {
    idToken: d.id_token,
    accessToken: d.access_token,
    refreshToken: d.refresh_token ?? null,
    expiresAt: Date.now() + d.expires_in * 1000,
  };
}

export interface CallbackResult {
  returnTo: string;
  /** true se il giro era silenzioso e non c'e' una sessione: l'utente resta anonimo senza errori. */
  anonymous?: boolean;
  /** Messaggio d'errore da mostrare (giro non silenzioso). */
  error?: string;
}

let callbackPromise: Promise<CallbackResult> | null = null;

/** Gestisce /callback. Idempotente: il code e' monouso e React StrictMode puo' eseguire l'effetto due volte. */
export function completeLogin(search: string): Promise<CallbackResult> {
  callbackPromise ??= doComplete(search);
  return callbackPromise;
}

async function doComplete(search: string): Promise<CallbackResult> {
  const params = new URLSearchParams(search);
  const raw = safe(() => sessionStorage.getItem(PKCE_KEY));
  safe(() => sessionStorage.removeItem(PKCE_KEY));
  const pending = raw ? (JSON.parse(raw) as PendingLogin) : null;

  const oauthError = params.get('error');
  if (oauthError) {
    if (pending?.silent) {
      clearSession('anonymous');
      return { returnTo: pending.returnTo, anonymous: true };
    }
    setAnonymous();
    return { returnTo: '/', error: params.get('error_description') ?? oauthError };
  }
  const code = params.get('code');
  if (!pending || !code || params.get('state') !== pending.state) {
    setAnonymous();
    return { returnTo: '/', error: 'Risposta di accesso non valida o scaduta. Riprova ad accedere.' };
  }
  try {
    const t = await tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      code_verifier: pending.verifier,
    });
    setTokens(t, { reauthForDelete: pending.purpose === 'delete-account' });
  } catch (e) {
    setAnonymous();
    return { returnTo: '/', error: e instanceof Error ? e.message : 'Accesso non riuscito.' };
  }

  // Dopo ogni login: crea/aggiorna la riga utente. 410 = l'utente aveva gia' confermato la cancellazione
  // (database anonimizzato) ma DeleteUser su Cognito era fallito: si completa direttamente (cognito.md).
  try {
    await api.putMe({});
  } catch (e) {
    if (e instanceof ApiError && e.status === 410) {
      try {
        await deleteCognitoUser(getTokens()!.accessToken);
        setNotice('Il tuo account era in cancellazione ed e\' stato eliminato definitivamente.');
      } catch {
        setNotice('Cancellazione dell\'account non completata: riprova ad accedere.');
      }
      await logout();
      return { returnTo: '/' };
    }
    // Altri errori (rete, 5xx): l'accesso resta valido, la riga si ricrea al prossimo login.
  }
  return { returnTo: pending.purpose === 'delete-account' ? '/profile/delete' : pending.returnTo };
}

let refreshing: Promise<string | null> | null = null;

/** Rinnova i token con il refresh token (grant_type=refresh_token). Una sola richiesta alla volta. */
export function refreshTokens(): Promise<string | null> {
  refreshing ??= (async () => {
    const rt = getTokens()?.refreshToken;
    if (!rt) return null;
    try {
      const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: rt });
      setTokens(t);
      return t.accessToken;
    } catch {
      clearSession('anonymous');
      return null;
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/** Access token valido: rinnova se scade entro 60 secondi. */
export async function getAccessToken(): Promise<string | null> {
  const t = getTokens();
  if (!t) return null;
  if (t.expiresAt - Date.now() > 60_000) return t.accessToken;
  return refreshTokens();
}

/** Logout: RevokeToken sul refresh token, token via dalla memoria, redirect a /logout del dominio. */
export async function logout(): Promise<void> {
  const rt = getTokens()?.refreshToken;
  if (rt) {
    try {
      await revokeRefreshToken(rt);
    } catch {
      /* se la revoca fallisce (rete, utente gia' cancellato) si prosegue comunque con il logout locale */
    }
  }
  clearSession('anonymous');
  const q = new URLSearchParams({ client_id: config.clientId, logout_uri: `${window.location.origin}/` });
  window.location.assign(`${config.cognitoDomain}/logout?${q}`);
}

export const isLoggedIn = () => getState().status === 'authenticated';

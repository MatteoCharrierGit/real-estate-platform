// Sessione in MEMORIA: i token vivono solo in questa variabile di modulo (mai in localStorage), cosi' uno script
// iniettato non li trova in uno storage persistente. In sessionStorage restano solo:
//   - `re.pkce`   verifier/state per il giro del redirect (cancellato appena letto);
//   - `re.hint`   flag NON sensibile "l'utente era loggato": al ricaricamento fa rifare il giro silenzioso;
//   - `re.notice` messaggio da mostrare dopo un logout/redirect.
import { useSyncExternalStore } from 'react';
import { userFromIdToken, type Role } from '../lib/jwt';

export interface Tokens {
  idToken: string;
  accessToken: string;
  refreshToken: string | null;
  /** epoch ms di scadenza dell'access token */
  expiresAt: number;
}

export interface SessionState {
  status: 'loading' | 'anonymous' | 'authenticated';
  user: { sub: string; email: string; groups: Role[] } | null;
  /** true se l'utente ha appena rifatto il login con prompt=login per cancellare l'account */
  reauthForDelete: boolean;
}

let tokens: Tokens | null = null;
let state: SessionState = { status: 'loading', user: null, reauthForDelete: false };
const listeners = new Set<() => void>();

function set(next: Partial<SessionState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export const getState = () => state;
export const getTokens = () => tokens;
export const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const useSession = () => useSyncExternalStore(subscribe, getState);

export function setTokens(t: Tokens, opts: { reauthForDelete?: boolean } = {}) {
  // Un refresh non restituisce un nuovo refresh token (a meno di rotazione): si tiene quello vecchio.
  const refreshToken = t.refreshToken ?? tokens?.refreshToken ?? null;
  tokens = { ...t, refreshToken };
  set({
    status: 'authenticated',
    user: userFromIdToken(t.idToken),
    reauthForDelete: opts.reauthForDelete ?? state.reauthForDelete,
  });
  safe(() => sessionStorage.setItem(HINT, '1'));
}

export function clearSession(status: 'anonymous' | 'loading' = 'anonymous') {
  tokens = null;
  set({ status, user: null, reauthForDelete: false });
  safe(() => sessionStorage.removeItem(HINT));
}

export function setAnonymous() {
  set({ status: 'anonymous' });
}

export const HINT = 're.hint';
export const NOTICE = 're.notice';
export const PKCE_KEY = 're.pkce';

export function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}
export const hasHint = () => safe(() => sessionStorage.getItem(HINT)) === '1';
export function setNotice(msg: string) {
  safe(() => sessionStorage.setItem(NOTICE, msg));
}
export function takeNotice(): string | null {
  const v = safe(() => sessionStorage.getItem(NOTICE));
  safe(() => sessionStorage.removeItem(NOTICE));
  return v;
}

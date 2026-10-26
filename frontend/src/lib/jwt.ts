// Decodifica (NON verifica la firma) del payload di un JWT. La verifica la fa l'authorizer di API Gateway;
// qui serve solo a mostrare chi e' loggato e a decidere cosa mostrare (UX, non sicurezza).

export interface IdClaims {
  sub: string;
  email?: string;
  'cognito:groups'?: string[];
  exp?: number;
  [k: string]: unknown;
}

export function decodeJwt<T = Record<string, unknown>>(token: string): T {
  const part = token.split('.')[1];
  if (!part) throw new Error('JWT non valido');
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

export type Role = 'buyer' | 'agent' | 'admin';
const ROLES: Role[] = ['buyer', 'agent', 'admin'];

/** Gruppi noti dal claim `cognito:groups` (ignora valori sconosciuti). */
export function groupsFromClaims(claims: { 'cognito:groups'?: unknown }): Role[] {
  const g = claims['cognito:groups'];
  if (!Array.isArray(g)) return [];
  return ROLES.filter((r) => g.includes(r));
}

export function userFromIdToken(idToken: string): { sub: string; email: string; groups: Role[] } {
  const c = decodeJwt<IdClaims>(idToken);
  return { sub: String(c.sub), email: c.email ?? '', groups: groupsFromClaims(c) };
}

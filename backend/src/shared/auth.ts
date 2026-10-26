import type { Queryable } from "./db";
import { ForbiddenError, UnauthorizedError } from "./errors";

export { ForbiddenError, UnauthorizedError } from "./errors";

export interface CurrentUser {
  sub: string;
  groups: string[];
}

/** Evento API Gateway HTTP API (payload 2.0): ci serve solo la parte dei claim. */
export interface EventWithClaims {
  requestContext?: unknown;
}
type ClaimsContext = { authorizer?: { jwt?: { claims?: Record<string, unknown> } } };

/**
 * `cognito:groups` arriva come stringa ("[buyer agent]"), non come array JSON (api-gateway.md).
 * Accetta anche un array vero, o una stringa con virgole/virgolette, per non dipendere dal formato esatto.
 */
export function parseGroups(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw !== "string") return [];
  return raw
    .replace(/^\s*\[|\]\s*$/g, "")
    .split(/[\s,]+/)
    .map((g) => g.replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

/** Identità e gruppi dai claim già validati dall'authorizer. Il `sub` viene SOLO da qui, mai dal body. */
export function currentUser(event: EventWithClaims): CurrentUser {
  const claims = (event.requestContext as ClaimsContext | undefined)?.authorizer?.jwt?.claims;
  if (!claims) throw new UnauthorizedError();
  // L'ID token di Cognito passerebbe l'authorizer (ha `aud`): qui lo rifiutiamo.
  if (claims.token_use !== "access") throw new UnauthorizedError("serve un access token");
  const sub = claims.sub;
  if (typeof sub !== "string" || sub === "") throw new UnauthorizedError();
  return { sub, groups: parseGroups(claims["cognito:groups"]) };
}

export function hasGroup(user: CurrentUser, ...groups: string[]): boolean {
  return groups.some((g) => user.groups.includes(g));
}

/** Ruolo richiesto: basta uno dei gruppi indicati. */
export function requireGroup(user: CurrentUser, ...groups: string[]): CurrentUser {
  if (!hasGroup(user, ...groups)) throw new ForbiddenError(`serve il gruppo ${groups.join(" o ")}`);
  return user;
}

/**
 * Rifiuta le scritture di chi ha già cancellato l'account (token emesso prima, valido fino a 60 minuti).
 * Una riga mancante NON è un account cancellato: manca solo per chi non ha ancora fatto PUT /users/me.
 */
export async function requireActiveUser(db: Queryable, user: CurrentUser): Promise<CurrentUser> {
  const { rows } = await db.query<{ deleted_at: Date | null }>("SELECT deleted_at FROM users WHERE sub = $1", [
    user.sub,
  ]);
  if (rows[0] && rows[0].deleted_at !== null) throw new ForbiddenError("account cancellato");
  return user;
}

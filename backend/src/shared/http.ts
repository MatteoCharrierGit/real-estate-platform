import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { currentUser, type CurrentUser } from "./auth";
import { BadRequestError, HttpError, NotFoundError } from "./errors";
import { errorInfo, log } from "./log";

export type HttpResult = APIGatewayProxyStructuredResultV2;
export type ApiEvent = APIGatewayProxyEventV2;

const MAX_BODY_BYTES = 100 * 1024;

export function json(statusCode: number, body: unknown): HttpResult {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

/** 204: niente body e niente content-type. */
export function noContent(): HttpResult {
  return { statusCode: 204 };
}

export function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

/**
 * Errori -> risposta nel formato del contratto. Gli HttpError passano così come sono;
 * alcuni errori di PostgreSQL diventano 409/422; tutto il resto è un 500 generico (senza dettagli al client).
 */
export function toErrorResponse(err: unknown): HttpResult {
  if (err instanceof HttpError) return json(err.status, errorBody(err.code, err.message));

  const pgCode = (err as { code?: unknown } | undefined)?.code;
  if (pgCode === "23503" || pgCode === "23505") {
    return json(409, errorBody("CONFLICT", "conflitto con i dati esistenti (profilo utente o risorsa collegata mancante)"));
  }
  if (pgCode === "23514" || pgCode === "22003" || pgCode === "22P02") {
    return json(422, errorBody("VALIDATION_ERROR", "valore non accettato dal database"));
  }
  // Errori di PostgreSQL: solo metadati (tabella, vincolo...), perché il messaggio può citare i valori inviati.
  // Altri errori: il messaggio serve a capire cosa è successo (le nostre eccezioni non contengono dati personali).
  const pg = err as { severity?: unknown; table?: string; constraint?: string; column?: string };
  const detail = pg?.severity ? { table: pg.table, constraint: pg.constraint, column: pg.column } : { message: err instanceof Error ? err.message : undefined };
  log("ERROR", "UNHANDLED_ERROR", { ...errorInfo(err), ...detail });
  return json(500, errorBody("INTERNAL_ERROR", "errore interno"));
}

/** Contesto di una richiesta, passato ai gestori delle route. */
export interface RequestContext {
  event: ApiEvent;
  /** Utente dai claim JWT (401 se mancano: lo si chiama solo nelle route autenticate). */
  user(): CurrentUser;
  /** Parametro di percorso, per esempio `id` in /properties/{id}. */
  param(name: string): string;
  query: Record<string, string>;
  /** Body JSON (deve essere un oggetto). */
  body(): Record<string, unknown>;
}

export type RouteHandler = (ctx: RequestContext) => Promise<HttpResult>;
/** Chiave = `routeKey` dell'evento 2.0, cioè "METODO /percorso/{param}" come configurato in API Gateway. */
export type Routes = Record<string, RouteHandler>;

/** Parsing sicuro del body: dimensione limitata, base64, JSON valido e oggetto. Vuoto -> {}. */
export function parseBody(event: Pick<ApiEvent, "body" | "isBase64Encoded">): Record<string, unknown> {
  const raw = event.body;
  if (raw === undefined || raw === null || raw === "") return {};
  const text = event.isBase64Encoded ? Buffer.from(raw, "base64").toString("utf8") : raw;
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) throw new BadRequestError("body troppo grande");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BadRequestError("il body non è un JSON valido");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new BadRequestError("il body deve essere un oggetto JSON");
  }
  return parsed as Record<string, unknown>;
}

/** Trova la route per `routeKey`; null se non esiste. */
export function findRoute(routes: Routes, routeKey: string | undefined): RouteHandler | null {
  if (!routeKey || !Object.hasOwn(routes, routeKey)) return null;
  return routes[routeKey] ?? null;
}

export function makeContext(event: ApiEvent): RequestContext {
  return {
    event,
    user: () => currentUser(event),
    param(name) {
      const v = event.pathParameters?.[name];
      if (!v) throw new BadRequestError(`parametro ${name} mancante`);
      return v;
    },
    query: Object.fromEntries(Object.entries(event.queryStringParameters ?? {}).flatMap(([k, v]) => (v === undefined ? [] : [[k, v]]))),
    body: () => parseBody(event),
  };
}

/** Router interno dello scope: sceglie il gestore dalla routeKey, e trasforma ogni errore in una risposta. */
export function createApiHandler(routes: Routes) {
  return async (event: ApiEvent): Promise<HttpResult> => {
    try {
      const route = findRoute(routes, event.routeKey);
      if (!route) throw new NotFoundError("route inesistente");
      return await route(makeContext(event));
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}

/** ID numerico (bigint) come stringa: solo cifre, altrimenti 404 (non può esistere). */
export function parseId(value: string, what = "risorsa"): string {
  if (!/^[0-9]{1,18}$/.test(value)) throw new NotFoundError(`${what} non trovata`);
  return value;
}

import type { EventType, NotificationEvent } from "../../shared/sns";

export const EVENT_TYPES: readonly EventType[] = ["WELCOME", "OFFER_CREATED", "OFFER_ACCEPTED", "OFFER_REJECTED", "OFFER_WITHDRAWN"];

/** Errore non ritentabile: messaggio malformato, email non verificata... Il messaggio qui è sempre statico (niente dati). */
export class PermanentError extends Error {
  override name = "PermanentError";
}

/** Corpo del messaggio SQS (RawMessageDelivery: è l'evento così come l'ha pubblicato la Lambda) -> evento valido. */
export function parseEvent(body: string): NotificationEvent {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    throw new PermanentError("JSON non valido");
  }
  if (typeof raw !== "object" || raw === null) throw new PermanentError("messaggio non è un oggetto");
  const e = raw as Record<string, unknown>;
  if (typeof e.type !== "string" || !(EVENT_TYPES as readonly string[]).includes(e.type)) {
    throw new PermanentError("tipo di evento sconosciuto o mancante");
  }
  if (typeof e.recipientSub !== "string" || e.recipientSub === "") throw new PermanentError("campi obbligatori mancanti");
  const data = typeof e.data === "object" && e.data !== null && !Array.isArray(e.data) ? (e.data as Record<string, unknown>) : {};
  return {
    eventId: typeof e.eventId === "string" ? e.eventId : "",
    type: e.type as EventType,
    recipientSub: e.recipientSub,
    occurredAt: typeof e.occurredAt === "string" ? e.occurredAt : "",
    data,
  };
}

// ---- Classificazione degli errori (lambda-mailer.md) ---------------------------------------------------------------

// Errori AWS che ritentare non cambia: utente inesistente, destinatario/mittente rifiutato da SES, parametri non validi.
const PERMANENT_AWS_ERRORS = new Set(["UserNotFoundException", "MessageRejected", "InvalidParameterException"]);

export type ErrorClass = "temporary" | "permanent" | "recipient-deleted";

export function classifyError(err: unknown): ErrorClass {
  const name = (err as { name?: string } | undefined)?.name;
  if (name === "UserNotFoundException") return "recipient-deleted"; // previsto: l'utente ha cancellato l'account
  if (err instanceof PermanentError || (name !== undefined && PERMANENT_AWS_ERRORS.has(name))) return "permanent";
  // Tutto il resto (throttling, 5xx, timeout di rete, SendingPausedException, errori di configurazione) è temporaneo:
  // il messaggio torna in coda e, dopo 5 ricezioni, finisce nella DLQ (che ha il suo allarme).
  return "temporary";
}

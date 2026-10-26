// Errori tipizzati: ognuno porta lo status HTTP e il `code` del contratto ({"error": {"code", "message"}}).
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class BadRequestError extends HttpError {
  constructor(message = "richiesta non valida") {
    super(400, "BAD_REQUEST", message);
  }
}
export class UnauthorizedError extends HttpError {
  constructor(message = "autenticazione richiesta") {
    super(401, "UNAUTHORIZED", message);
  }
}
export class ForbiddenError extends HttpError {
  constructor(message = "operazione non consentita") {
    super(403, "FORBIDDEN", message);
  }
}
export class NotFoundError extends HttpError {
  constructor(message = "risorsa non trovata") {
    super(404, "NOT_FOUND", message);
  }
}
export class ConflictError extends HttpError {
  constructor(message = "conflitto con lo stato attuale della risorsa") {
    super(409, "CONFLICT", message);
  }
}
export class GoneError extends HttpError {
  constructor(message = "risorsa non più disponibile") {
    super(410, "GONE", message);
  }
}
export class ValidationError extends HttpError {
  constructor(message = "dati non validi") {
    super(422, "VALIDATION_ERROR", message);
  }
}

// Log strutturati: una riga JSON con `level` e `code` al livello più alto, perché i metric filter di
// CloudWatch (config/cloudwatch-metric-filter-*.json) leggono `$.level` e `$.code`.
// Si scrive con process.stdout.write e non con console.log: console.log in formato "testo" aggiunge un prefisso
// (data, request id, livello) e la riga non sarebbe più JSON, quindi il filtro non la vedrebbe.
// MAI email, token o altri dati personali nei campi: solo id, tipi di evento, nomi di errore.
export type Level = "INFO" | "WARN" | "ERROR";

export function log(level: Level, code: string, fields: Record<string, unknown> = {}): void {
  process.stdout.write(JSON.stringify({ level, code, ...fields, ts: new Date().toISOString() }) + "\n");
}

/** Nome (e codice) di un errore, senza il messaggio, che può contenere dati. */
export function errorInfo(err: unknown): { error: string; errorCode?: string } {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    return typeof code === "string" ? { error: err.name, errorCode: code } : { error: err.name };
  }
  return { error: typeof err };
}

import { Signer } from "@aws-sdk/rds-signer";
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

/** Ciò che serve alla logica applicativa: una query parametrizzata ($1, $2...). */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<R>>;
}

export interface Db extends Queryable {
  /** BEGIN ... COMMIT (ROLLBACK se `fn` lancia). `q` usa la stessa connessione della transazione. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
}

// Il token IAM vale 15 minuti. Lo rigeneriamo ogni 10: la password serve solo all'apertura di una NUOVA connessione
// (una connessione già aperta non si chiude alla scadenza), ma una Lambda "calda" può restare viva per ore.
const TOKEN_TTL_MS = 10 * 60 * 1000;

function iamPassword(host: string, port: number, user: string): () => Promise<string> {
  const signer = new Signer({ hostname: host, port, username: user, region: process.env.AWS_REGION ?? "eu-south-1" });
  let cached: { token: string; at: number } | undefined;
  // pg accetta una funzione async come `password` e la chiama a ogni nuova connessione.
  return async () => {
    if (!cached || Date.now() - cached.at > TOKEN_TTL_MS) {
      cached = { token: await signer.getAuthToken(), at: Date.now() }; // calcolo locale (SigV4), nessuna rete
    }
    return cached.token;
  };
}

/** Errori tipici di una connessione rimasta aperta mentre l'ambiente Lambda era congelato. */
export function isStaleConnection(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | undefined;
  return (
    e?.code === "ECONNRESET" ||
    e?.code === "EPIPE" ||
    e?.code === "ETIMEDOUT" ||
    /Connection terminated|connection error/i.test(e?.message ?? "")
  );
}

/**
 * Crea il pool. Va chiamato FUORI dall'handler (livello modulo): la connessione si apre alla prima query e poi
 * resta aperta tra le invocazioni "calde". Un'istanza Lambda gestisce una richiesta alla volta: 1 connessione basta;
 * il numero totale di connessioni lo tiene sotto controllo l'RDS Proxy.
 */
export function createDb(env: NodeJS.ProcessEnv = process.env): Db {
  const host = env.DB_HOST ?? "";
  const port = Number(env.DB_PORT ?? "5432");
  const user = env.DB_USER ?? "";
  const pool = new Pool({
    host,
    port,
    database: env.DB_NAME ?? "realestate",
    user,
    password: iamPassword(host, port, user),
    ssl: { rejectUnauthorized: true }, // il certificato del proxy è di una CA pubblica (Amazon Trust Services)
    max: 1,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  return wrapPool(pool);
}

/** Aggiunge a un pool la query con retry delle letture e la transazione. (Separata da createDb per poterla provare.) */
export function wrapPool(pool: Pool): Db {
  // Un errore su una connessione inattiva non deve far cadere il processo: il pool la scarta e ne apre un'altra.
  pool.on("error", () => {});

  return {
    async query<R extends QueryResultRow>(text: string, params?: unknown[]) {
      try {
        return await pool.query<R>(text, params);
      } catch (err) {
        // Solo le letture si ritentano: ripetere una scrittura potrebbe duplicarla.
        if (isStaleConnection(err) && /^\s*select\b/i.test(text)) return pool.query<R>(text, params);
        throw err;
      }
    },

    async tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
      const client = await beginWithRetry(pool);
      let failure: unknown;
      try {
        const result = await fn({ query: (text, params) => client.query(text, params) });
        await client.query("COMMIT");
        return result;
      } catch (err) {
        failure = err;
        try {
          await client.query("ROLLBACK");
        } catch {
          // connessione compromessa: viene distrutta dal release(err)
        }
        throw err;
      } finally {
        client.release(failure === undefined ? undefined : isStaleConnection(failure) ? true : undefined);
      }
    },
  };
}

/** BEGIN è la prima istruzione: se la connessione è morta si può ritentare senza rischi. */
async function beginWithRetry(pool: Pool): Promise<PoolClient> {
  for (let attempt = 0; ; attempt++) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      return client;
    } catch (err) {
      client.release(true); // distrugge la connessione
      if (attempt > 0 || !isStaleConnection(err)) throw err;
    }
  }
}

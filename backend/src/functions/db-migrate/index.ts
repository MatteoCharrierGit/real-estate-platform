// ============================================================================================================
// FUNZIONE TEMPORANEA: da CANCELLARE a fine setup (Lambda, ruolo IAM, regola di rete e questo codice).
//
// Perché esiste: il database sta in subnet private senza Internet e senza accesso dalla console, quindi non c'è un
// modo semplice di lanciare schema.sql e roles.sql da fuori. Questa Lambda gira DENTRO la VPC, si collega
// DIRETTAMENTE all'istanza RDS (non al proxy: il proxy accetta solo gli utenti applicativi, che ancora non esistono)
// con l'utente master, e applica gli SQL incorporati nel bundle.
//
// Come si usa (console Lambda, tab "Test", evento JSON):
//   { "action": "migrate", "masterUser": "...", "masterPassword": "...",
//     "passwords": { "property_user": "...", "users_user": "...", "offers_user": "...",
//                    "files_user": "...", "presigned_user": "..." } }
//   { "action": "status", "masterUser": "...", "masterPassword": "..." }     // sola lettura
// Le password dei 5 utenti sono quelle dei secret che legge l'RDS Proxy.
//
// Sicurezza: nessuna password nei log (nemmeno negli errori); il master non va tenuto in variabili d'ambiente né nel
// codice: sta solo nell'evento di test (che la console non salva se non lo chiedi). Rieseguirla è innocuo.
// ============================================================================================================
import { Client } from "pg";
import caBundle from "./rds-ca-eu-south-1.pem";
import rolesSql from "../../../../database/roles.sql";
import schemaSql from "../../../../database/schema.sql";
import { log } from "../../shared/log";
import { ensureDatabase, redact, renderRolesSql, summarize, validateDbName, validatePasswords, type Passwords, type Summary } from "./migrate";

interface MigrateEvent {
  action?: string;
  masterUser?: string;
  masterPassword?: string;
  passwords?: unknown;
}

export interface Deps {
  /** Apre una connessione come master al database indicato. */
  connect(database: string, user: string, password: string): Promise<Client>;
  dbName: string;
}

async function connectDirect(database: string, user: string, password: string): Promise<Client> {
  const client = new Client({
    host: process.env.DB_HOST, // endpoint dell'ISTANZA RDS, non del proxy
    port: Number(process.env.DB_PORT ?? "5432"),
    database,
    user,
    password,
    // L'istanza usa un certificato di una CA di RDS, che non è nei certificati di Node: usiamo il bundle regionale.
    ssl: { rejectUnauthorized: true, ca: caBundle },
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  return client;
}

export function createHandler(deps: Deps) {
  return async (event: MigrateEvent) => {
    const secrets: string[] = [];
    let step = "validazione";
    const opened: Client[] = [];
    try {
      const action = event.action ?? "status";
      if (action !== "migrate" && action !== "status") throw new Error('action deve essere "migrate" o "status"');
      if (typeof event.masterUser !== "string" || typeof event.masterPassword !== "string" || !event.masterUser || !event.masterPassword) {
        throw new Error("masterUser e masterPassword sono obbligatori");
      }
      secrets.push(event.masterPassword);
      if (event.passwords && typeof event.passwords === "object") {
        for (const v of Object.values(event.passwords)) if (typeof v === "string") secrets.push(v);
      }
      const dbName = validateDbName(deps.dbName);
      const { masterUser, masterPassword } = event;
      const open = async (db: string) => {
        const c = await deps.connect(db, masterUser, masterPassword);
        opened.push(c);
        return c;
      };

      step = "connessione a postgres";
      const admin = await open("postgres");

      if (action === "status") {
        const exists = (await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName])).rowCount === 1;
        let summary: Summary | null = null;
        if (exists) {
          step = "lettura dello stato";
          summary = await summarize(await open(dbName));
        }
        log("INFO", "DB_MIGRATE_STATUS", { database: dbName, exists });
        return { ok: true, action, database: { name: dbName, exists }, summary };
      }

      const problems = validatePasswords(event.passwords);
      if (problems.length > 0) throw new Error(problems.join("; "));
      const passwords = event.passwords as Passwords;

      step = "creazione del database";
      const created = await ensureDatabase(admin, dbName);

      const db = await open(dbName);
      step = "schema.sql";
      await db.query(schemaSql); // più istruzioni in un solo invio: PostgreSQL le esegue in un'unica transazione
      step = "roles.sql";
      await db.query(renderRolesSql(rolesSql, passwords));
      step = "riepilogo";
      const summary = await summarize(db);

      log("INFO", "DB_MIGRATE_DONE", { database: dbName, created, tables: summary.tables.length });
      return { ok: true, action, database: { name: dbName, created }, summary };
    } catch (err) {
      const e = err as { name?: string; code?: string; message?: string };
      const message = redact(e.message ?? String(err), secrets);
      log("ERROR", "DB_MIGRATE_FAILED", { step, error: e.name, errorCode: e.code, message });
      return { ok: false, step, error: message, pgCode: e.code };
    } finally {
      await Promise.allSettled(opened.map((c) => c.end()));
    }
  };
}

export const handler = createHandler({
  connect: connectDirect,
  dbName: process.env.DB_NAME ?? "realestate",
});

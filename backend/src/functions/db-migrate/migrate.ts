import { escapeIdentifier, escapeLiteral, type ClientBase } from "pg";

export const APP_ROLES = ["property_user", "users_user", "offers_user", "files_user", "presigned_user"] as const;
export type AppRole = (typeof APP_ROLES)[number];
export type Passwords = Record<AppRole, string>;

// Le variabili di roles.sql (stile psql `:'nome'`) e il ruolo a cui appartengono.
const VARIABLES: Record<string, AppRole> = {
  property_password: "property_user",
  users_password: "users_user",
  offers_password: "offers_user",
  files_password: "files_user",
  presigned_password: "presigned_user",
};

const MIN_PASSWORD_LENGTH = 12;

/** Controlla il campo `passwords` dell'evento. Restituisce l'elenco dei problemi (mai i valori). */
export function validatePasswords(p: unknown): string[] {
  if (typeof p !== "object" || p === null) return ["passwords: oggetto obbligatorio"];
  const problems: string[] = [];
  for (const role of APP_ROLES) {
    const v = (p as Record<string, unknown>)[role];
    if (typeof v !== "string" || v.length < MIN_PASSWORD_LENGTH || v.includes("\0")) {
      problems.push(`passwords.${role}: stringa di almeno ${MIN_PASSWORD_LENGTH} caratteri`);
    }
  }
  return problems;
}

/**
 * Sostituisce `:'variabile'` con un literal SQL correttamente quotato (escapeLiteral di pg: raddoppia gli apici,
 * usa E'' se ci sono backslash). È l'equivalente di ciò che fa psql, e il testo risultante contiene la password
 * solo dentro un literal: non può uscire dalla stringa.
 */
export function renderRolesSql(sql: string, passwords: Passwords): string {
  const out = sql.replace(/:'([a-z_]+)'/g, (_m, name: string) => {
    const role = VARIABLES[name];
    if (!role) throw new Error(`variabile sconosciuta in roles.sql: ${name}`);
    return escapeLiteral(passwords[role]);
  });
  return out;
}

/** Toglie dai messaggi di errore ogni password (per sicurezza: i log non devono contenerne). */
export function redact(message: string, secrets: string[]): string {
  return secrets.filter((s) => s.length > 0).reduce((m, s) => m.split(s).join("***"), message);
}

export function validateDbName(name: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) throw new Error("DB_NAME non valido");
  return name;
}

/** Crea il database se manca (CREATE DATABASE non è parametrizzabile: il nome è validato e quotato). */
export async function ensureDatabase(adminClient: ClientBase, dbName: string): Promise<boolean> {
  const { rowCount } = await adminClient.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
  if (rowCount && rowCount > 0) return false;
  await adminClient.query(`CREATE DATABASE ${escapeIdentifier(validateDbName(dbName))}`);
  return true;
}

export interface Summary {
  tables: string[];
  indexes: number;
  roles: Record<string, { exists: boolean; tablePrivileges: Record<string, string[]>; columnPrivileges: Record<string, string[]> }>;
}

/** Cosa c'è nel database adesso: tabelle, indici, ruoli applicativi e i loro GRANT (nessuna password). */
export async function summarize(client: ClientBase): Promise<Summary> {
  const tables = await client.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1",
  );
  const indexes = await client.query<{ n: string }>("SELECT count(*) AS n FROM pg_indexes WHERE schemaname = 'public'");
  const existing = await client.query<{ rolname: string }>("SELECT rolname FROM pg_roles WHERE rolname = ANY($1)", [[...APP_ROLES]]);
  const tp = await client.query<{ grantee: string; table_name: string; privilege_type: string }>(
    `SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND grantee = ANY($1) ORDER BY 1, 2, 3`,
    [[...APP_ROLES]],
  );
  const cp = await client.query<{ grantee: string; table_name: string; privilege_type: string; columns: string[] }>(
    `SELECT grantee, table_name, privilege_type, array_agg(column_name::text ORDER BY column_name) AS columns
       FROM information_schema.column_privileges
      WHERE table_schema = 'public' AND grantee = ANY($1)
        AND NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants t
                         WHERE t.table_schema = 'public' AND t.table_name = column_privileges.table_name
                           AND t.grantee = column_privileges.grantee AND t.privilege_type = column_privileges.privilege_type)
      GROUP BY grantee, table_name, privilege_type ORDER BY 1, 2, 3`,
    [[...APP_ROLES]],
  );

  const roles: Summary["roles"] = {};
  for (const r of APP_ROLES) roles[r] = { exists: existing.rows.some((x) => x.rolname === r), tablePrivileges: {}, columnPrivileges: {} };
  for (const g of tp.rows) (roles[g.grantee]!.tablePrivileges[g.table_name] ??= []).push(g.privilege_type);
  for (const g of cp.rows) (roles[g.grantee]!.columnPrivileges[`${g.table_name}.${g.privilege_type}`] ??= []).push(...g.columns);
  return { tables: tables.rows.map((t) => t.table_name), indexes: Number(indexes.rows[0]?.n ?? 0), roles };
}

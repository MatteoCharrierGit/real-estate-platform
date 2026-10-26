import type { S3Client } from "@aws-sdk/client-s3";
import { hasGroup, requireActiveUser, requireGroup } from "../../shared/auth";
import type { Db } from "../../shared/db";
import { ConflictError, ForbiddenError, NotFoundError } from "../../shared/errors";
import { json, noContent, parseId, type Routes } from "../../shared/http";
import { errorInfo, log } from "../../shared/log";
import { buildInsert, buildListWhere, buildUpdateSet, mapProperty, parseListQuery, parsePropertyInput, PROPERTY_SELECT, type PropertyRow } from "./model";
import { deleteAllUnderPrefix } from "./s3cleanup";

interface Deps {
  db: Db;
  s3: S3Client;
  bucket: string;
}

export function createRoutes({ db, s3, bucket }: Deps): Routes {
  async function findProperty(id: string) {
    const { rows } = await db.query<PropertyRow>(`${PROPERTY_SELECT} WHERE p.id = $1`, [id]);
    return rows[0];
  }

  /** Esiste, e chi lo chiama è il proprietario o admin (404 / 403). */
  async function loadForWrite(id: string, user: { sub: string; groups: string[] }) {
    const row = await findProperty(id);
    if (!row) throw new NotFoundError("immobile non trovato");
    if (row.owner_id !== user.sub && !hasGroup(user, "admin")) throw new ForbiddenError("non sei il proprietario");
    return row;
  }

  return {
    // Pubblica: solo immobili active, con filtri, paginazione e total.
    "GET /properties": async (ctx) => {
      const f = parseListQuery(ctx.query);
      const { where, params } = buildListWhere(f);
      const n = params.length;
      const list = await db.query<PropertyRow>(
        `${PROPERTY_SELECT} WHERE ${where} ORDER BY p.created_at DESC, p.id DESC LIMIT $${n + 1} OFFSET $${n + 2}`,
        [...params, f.limit, f.offset],
      );
      const count = await db.query<{ total: string }>(`SELECT count(*) AS total FROM properties p WHERE ${where}`, params);
      return json(200, { items: list.rows.map(mapProperty), total: Number(count.rows[0]?.total ?? 0) });
    },

    // Pubblica: dettaglio con l'agente (assente se ritirato o se ha cancellato l'account).
    "GET /properties/{id}": async (ctx) => {
      const id = parseId(ctx.param("id"), "immobile");
      const { rows } = await db.query<PropertyRow & { agent_name: string | null; agent_bio: string | null; agent_sub: string | null }>(
        `SELECT p.*, u.sub AS agent_sub, u.display_name AS agent_name, u.bio AS agent_bio
           FROM (${PROPERTY_SELECT} WHERE p.id = $1) p
           LEFT JOIN users u ON u.sub = p.owner_id AND u.deleted_at IS NULL`,
        [id],
      );
      const row = rows[0];
      if (!row) throw new NotFoundError("immobile non trovato");
      const agent =
        row.status === "active" && row.agent_sub
          ? { sub: row.agent_sub, displayName: row.agent_name, bio: row.agent_bio }
          : null;
      return json(200, { property: mapProperty(row), agent });
    },

    "POST /properties": async (ctx) => {
      const user = requireGroup(ctx.user(), "agent");
      await requireActiveUser(db, user);
      const input = parsePropertyInput(ctx.body(), "create");
      // owner_id è sempre il sub dei claim. Nomi di colonna dalla whitelist, valori solo come parametri.
      const { columns, holders, params } = buildInsert(user.sub, input);
      const ins = await db.query<{ id: string }>(`INSERT INTO properties (${columns}) VALUES (${holders}) RETURNING id`, params);
      const row = await findProperty(ins.rows[0]!.id);
      return json(201, mapProperty(row!));
    },

    "PUT /properties/{id}": async (ctx) => {
      const user = ctx.user();
      await requireActiveUser(db, user);
      const id = parseId(ctx.param("id"), "immobile");
      const input = parsePropertyInput(ctx.body(), "update");
      const current = await loadForWrite(id, user);
      if (current.status === "withdrawn") throw new ConflictError("immobile ritirato: non si modifica");
      if (Object.keys(input).length > 0) {
        const { set, params } = buildUpdateSet(input, 2);
        const upd = await db.query(`UPDATE properties SET ${set} WHERE id = $1 AND status = 'active'`, [id, ...params]);
        if (upd.rowCount === 0) throw new ConflictError("immobile ritirato o cancellato nel frattempo");
      }
      const row = await findProperty(id);
      if (!row) throw new NotFoundError("immobile non trovato");
      return json(200, mapProperty(row));
    },

    "DELETE /properties/{id}": async (ctx) => {
      const user = ctx.user();
      await requireActiveUser(db, user);
      const id = parseId(ctx.param("id"), "immobile");
      await loadForWrite(id, user); // 404 / 403: se non va, non si tocca niente

      // 1. Prima il database (una transazione: le righe di offers e files spariscono con la cascata)...
      const del = await db.query("DELETE FROM properties WHERE id = $1", [id]);
      if (del.rowCount === 0) throw new NotFoundError("immobile non trovato");

      // 2. ...poi S3. Se fallisce, l'immobile è comunque cancellato: si logga (c'è un allarme) e si risponde 204.
      try {
        await deleteAllUnderPrefix(s3, bucket, `uploads/${id}/`);
      } catch (err) {
        log("ERROR", "FILES_CLEANUP_FAILED", { propertyId: id, ...errorInfo(err) });
      }
      return noContent();
    },
  };
}

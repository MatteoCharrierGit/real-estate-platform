import type { Db } from "../../shared/db";
import { GoneError, NotFoundError } from "../../shared/errors";
import { json, noContent, type Routes } from "../../shared/http";
import type { Publisher } from "../../shared/sns";
import { Fields } from "../../shared/validation";

interface Deps {
  db: Db;
  publish: Publisher;
}

interface UserRow {
  sub: string;
  display_name: string | null;
  phone: string | null;
  bio: string | null;
  created_at: Date;
}

const toUser = (r: UserRow) => ({
  sub: r.sub,
  displayName: r.display_name,
  phone: r.phone,
  bio: r.bio,
  createdAt: r.created_at.toISOString(),
});

export interface WithdrawnOffer {
  id: string;
  property_id: string;
  buyer_id: string;
  owner_id: string;
  title: string;
  amount: string;
}

/**
 * A chi va l'avviso di un'offerta ritirata dalla cancellazione di `sub`: all'ALTRA parte.
 * Se l'utente era l'acquirente avvisiamo il proprietario, se era il proprietario avvisiamo l'acquirente.
 * Nessun avviso a chi si sta cancellando (o se acquirente e proprietario coincidono).
 */
export function otherParty(offer: Pick<WithdrawnOffer, "buyer_id" | "owner_id">, sub: string): string | null {
  const other = offer.buyer_id === sub ? offer.owner_id : offer.buyer_id;
  return other === sub ? null : other;
}

export function createRoutes({ db, publish }: Deps): Routes {
  return {
    "GET /users/me": async (ctx) => {
      const { sub } = ctx.user();
      const { rows } = await db.query<UserRow & { deleted_at: Date | null }>(
        "SELECT sub, display_name, phone, bio, created_at, deleted_at FROM users WHERE sub = $1",
        [sub],
      );
      const row = rows[0];
      if (!row) throw new NotFoundError("profilo non ancora creato");
      if (row.deleted_at) throw new GoneError("account cancellato");
      return json(200, toUser(row));
    },

    // Chiamata dalla SPA dopo ogni login: crea la riga o aggiorna i campi presenti nel body.
    "PUT /users/me": async (ctx) => {
      const { sub } = ctx.user(); // il sub viene solo dai claim: un sub nel body è ignorato
      const f = new Fields(ctx.body());
      const displayName = f.string("displayName", { nullable: true, max: 100 });
      const phone = f.string("phone", { nullable: true, max: 30 });
      const bio = f.string("bio", { nullable: true, max: 2000 });
      f.done();

      // Un solo statement: INSERT, oppure UPDATE se la riga c'è (ma solo se NON è cancellata: il WHERE della
      // DO UPDATE la lascia intatta e allora non torna nessuna riga -> 410). (xmax = 0) dice che la riga è nuova.
      // Un campo assente nel body non si tocca ($n = false); presente (anche null) si sovrascrive.
      const { rows } = await db.query<UserRow & { created: boolean }>(
        `INSERT INTO users (sub, display_name, phone, bio) VALUES ($1, $2, $3, $4)
         ON CONFLICT (sub) DO UPDATE SET
           display_name = CASE WHEN $5 THEN EXCLUDED.display_name ELSE users.display_name END,
           phone        = CASE WHEN $6 THEN EXCLUDED.phone        ELSE users.phone END,
           bio          = CASE WHEN $7 THEN EXCLUDED.bio          ELSE users.bio END
         WHERE users.deleted_at IS NULL
         RETURNING sub, display_name, phone, bio, created_at, (xmax = 0) AS created`,
        [sub, displayName ?? null, phone ?? null, bio ?? null, displayName !== undefined, phone !== undefined, bio !== undefined],
      );
      const row = rows[0];
      if (!row) throw new GoneError("account cancellato");
      if (row.created) await publish("WELCOME", sub, {});
      return json(row.created ? 201 : 200, toUser(row));
    },

    // Anonimizzazione in UNA transazione (lambda-users.md). Nessun DELETE: solo UPDATE.
    "DELETE /users/me": async (ctx) => {
      const { sub } = ctx.user();
      const withdrawn = await db.tx(async (q) => {
        // 1. Il profilo: resta il solo sub. COALESCE tiene la data della prima cancellazione (richiamabile senza danni).
        await q.query(
          `UPDATE users SET display_name = NULL, phone = NULL, bio = NULL, deleted_at = COALESCE(deleted_at, now())
            WHERE sub = $1`,
          [sub],
        );
        // 2. I suoi immobili: ritirati.
        await q.query("UPDATE properties SET status = 'withdrawn' WHERE owner_id = $1 AND status = 'active'", [sub]);
        // 3. Le offerte in sospeso, fatte da lui o ricevute sui suoi immobili: ritirate.
        const res = await q.query<WithdrawnOffer>(
          `UPDATE offers o SET status = 'withdrawn'
             FROM properties p
            WHERE p.id = o.property_id AND o.status = 'pending' AND (o.buyer_id = $1 OR p.owner_id = $1)
        RETURNING o.id, o.property_id, o.buyer_id, p.owner_id, p.title, o.amount`,
          [sub],
        );
        return res.rows;
      });

      // Dopo il COMMIT: un evento per ogni offerta ritirata, verso l'altra parte. Non lanciano mai.
      for (const o of withdrawn) {
        const recipient = otherParty(o, sub);
        if (recipient) {
          await publish("OFFER_WITHDRAWN", recipient, {
            propertyId: o.property_id,
            propertyTitle: o.title,
            offerId: o.id,
            amount: Number(o.amount),
          });
        }
      }
      return noContent();
    },

    // Pubblica: profilo pubblico dell'agente. 404 se assente o cancellato.
    "GET /users/{id}": async (ctx) => {
      const id = ctx.param("id");
      if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(id)) throw new NotFoundError("utente non trovato");
      const { rows } = await db.query<{ sub: string; display_name: string | null; bio: string | null }>(
        "SELECT sub, display_name, bio FROM users WHERE sub = $1 AND deleted_at IS NULL",
        [id],
      );
      const row = rows[0];
      if (!row) throw new NotFoundError("utente non trovato");
      return json(200, { sub: row.sub, displayName: row.display_name, bio: row.bio });
    },
  };
}

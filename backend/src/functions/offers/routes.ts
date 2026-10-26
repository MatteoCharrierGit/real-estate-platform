import { requireActiveUser, requireGroup, type CurrentUser } from "../../shared/auth";
import type { Db } from "../../shared/db";
import { ConflictError, ForbiddenError, NotFoundError } from "../../shared/errors";
import { json, noContent, parseId, type Routes } from "../../shared/http";
import type { Publisher } from "../../shared/sns";
import { Fields } from "../../shared/validation";

interface Deps {
  db: Db;
  publish: Publisher;
}

interface OfferRow {
  id: string;
  property_id: string;
  property_title: string;
  owner_id: string;
  buyer_id: string;
  amount: string;
  message: string | null;
  status: "pending" | "accepted" | "rejected" | "withdrawn";
  created_at: Date;
  updated_at: Date;
}

// Offerta + titolo e proprietario dell'immobile (servono al ruolo, ai controlli e agli eventi).
const OFFER_SELECT = `
  SELECT o.id, o.property_id, p.title AS property_title, p.owner_id, o.buyer_id, o.amount, o.message,
         o.status, o.created_at, o.updated_at
    FROM offers o JOIN properties p ON p.id = o.property_id`;

/** "buyer" se l'ha fatta il chiamante, altrimenti "owner" (l'ha ricevuta sul suo immobile). */
export function roleOf(row: Pick<OfferRow, "buyer_id">, sub: string): "buyer" | "owner" {
  return row.buyer_id === sub ? "buyer" : "owner";
}

export function mapOffer(r: OfferRow, sub: string) {
  return {
    id: r.id,
    propertyId: r.property_id,
    propertyTitle: r.property_title,
    buyerId: r.buyer_id,
    amount: Number(r.amount),
    message: r.message,
    status: r.status,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    role: roleOf(r, sub),
  };
}

const eventData = (r: OfferRow) => ({
  propertyId: r.property_id,
  propertyTitle: r.property_title,
  offerId: r.id,
  amount: Number(r.amount),
});

export function createRoutes({ db, publish }: Deps): Routes {
  async function loadOffer(id: string): Promise<OfferRow> {
    const { rows } = await db.query<OfferRow>(`${OFFER_SELECT} WHERE o.id = $1`, [id]);
    if (!rows[0]) throw new NotFoundError("offerta non trovata");
    return rows[0];
  }

  /** UPDATE condizionato a `pending`: se nel frattempo è cambiata, 409. */
  async function setStatus(id: string, status: "accepted" | "rejected" | "withdrawn"): Promise<void> {
    const res = await db.query("UPDATE offers SET status = $2 WHERE id = $1 AND status = 'pending'", [id, status]);
    if (res.rowCount === 0) throw new ConflictError("l'offerta non è più in sospeso");
  }

  return {
    "POST /properties/{id}/offers": async (ctx) => {
      const user = requireGroup(ctx.user(), "buyer");
      await requireActiveUser(db, user);
      const propertyId = parseId(ctx.param("id"), "immobile");
      const f = new Fields(ctx.body());
      const amount = f.money("amount", { required: true, min: 0.01 });
      const message = f.string("message", { nullable: true, max: 2000 });
      f.done();

      const prop = await db.query<{ owner_id: string; status: string; title: string }>(
        "SELECT owner_id, status, title FROM properties WHERE id = $1",
        [propertyId],
      );
      const p = prop.rows[0];
      if (!p) throw new NotFoundError("immobile non trovato");
      if (p.status !== "active") throw new ConflictError("immobile ritirato: non riceve offerte");

      // buyer_id è sempre il sub dei claim, mai un campo del body.
      const ins = await db.query<{ id: string }>(
        "INSERT INTO offers (property_id, buyer_id, amount, message) VALUES ($1, $2, $3, $4) RETURNING id",
        [propertyId, user.sub, amount, message ?? null],
      );
      const offer = await loadOffer(ins.rows[0]!.id);
      await publish("OFFER_CREATED", p.owner_id, eventData(offer)); // al proprietario; non lancia
      return json(201, mapOffer(offer, user.sub));
    },

    "GET /offers": async (ctx) => {
      const { sub } = ctx.user();
      // Fatte dal chiamante o ricevute sui suoi immobili. Tetto di 500: il contratto non prevede paginazione.
      const { rows } = await db.query<OfferRow>(
        `${OFFER_SELECT} WHERE o.buyer_id = $1 OR p.owner_id = $1 ORDER BY o.created_at DESC, o.id DESC LIMIT 500`,
        [sub],
      );
      return json(200, { items: rows.map((r) => mapOffer(r, sub)) });
    },

    // Accetta o rifiuta: SOLO il proprietario dell'immobile (più restrittivo di api-gateway.md, vedi il contratto).
    "PUT /offers/{id}": async (ctx) => {
      const user = ctx.user();
      await requireActiveUser(db, user);
      const id = parseId(ctx.param("id"), "offerta");
      const f = new Fields(ctx.body());
      const status = f.oneOf("status", ["accepted", "rejected"] as const, { required: true });
      f.done();

      const offer = await loadOffer(id);
      if (offer.owner_id !== user.sub) throw new ForbiddenError("solo il proprietario dell'immobile può rispondere");
      if (offer.status !== "pending") throw new ConflictError("l'offerta non è più in sospeso");
      await setStatus(id, status!);

      const updated = await loadOffer(id);
      await publish(status === "accepted" ? "OFFER_ACCEPTED" : "OFFER_REJECTED", offer.buyer_id, eventData(updated));
      return json(200, mapOffer(updated, user.sub));
    },

    // Ritiro: non toglie la riga, la porta a `withdrawn`. Lo può fare chi l'ha fatta o il proprietario.
    "DELETE /offers/{id}": async (ctx) => {
      const user: CurrentUser = ctx.user();
      await requireActiveUser(db, user);
      const id = parseId(ctx.param("id"), "offerta");
      const offer = await loadOffer(id);
      if (offer.buyer_id !== user.sub && offer.owner_id !== user.sub) throw new ForbiddenError("l'offerta non è tua");
      if (offer.status !== "pending") throw new ConflictError("l'offerta non è più in sospeso");
      await setStatus(id, "withdrawn");
      return noContent();
    },
  };
}

import { ValidationError } from "../../shared/errors";
import { Fields, queryNumber } from "../../shared/validation";

export const LISTING_TYPES = ["sale", "rent"] as const;

/** Colonne dell'immobile + prima foto (coverKey = prima immagine registrata, per id). */
export const PROPERTY_SELECT = `
  SELECT p.id, p.owner_id, p.title, p.description, p.price, p.city, p.address, p.listing_type,
         p.rooms, p.bathrooms, p.area_sqm, p.status, p.created_at,
         (SELECT f.object_key FROM files f
           WHERE f.property_id = p.id AND f.content_type LIKE 'image/%'
           ORDER BY f.id LIMIT 1) AS cover_key
    FROM properties p`;

export interface PropertyRow {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  price: string;
  city: string;
  address: string | null;
  listing_type: string | null;
  rooms: number | null;
  bathrooms: number | null;
  area_sqm: number | null;
  status: "active" | "withdrawn";
  created_at: Date;
  cover_key: string | null;
}

/** Riga -> oggetto Property del contratto (ownerId assente se ritirato: l'agente non si mostra). */
export function mapProperty(r: PropertyRow) {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    price: Number(r.price),
    city: r.city,
    address: r.address,
    listingType: r.listing_type,
    rooms: r.rooms,
    bathrooms: r.bathrooms,
    areaSqm: r.area_sqm,
    status: r.status,
    ...(r.status === "withdrawn" ? {} : { ownerId: r.owner_id }),
    coverKey: r.cover_key,
    createdAt: r.created_at.toISOString(),
  };
}

// ---- GET /properties: filtri e paginazione -------------------------------------------------------------------------

export interface ListFilters {
  city?: string;
  listingType?: (typeof LISTING_TYPES)[number];
  minPrice?: number;
  maxPrice?: number;
  rooms?: number;
  limit: number;
  offset: number;
}

export function parseListQuery(query: Record<string, string>): ListFilters {
  const f: ListFilters = {
    limit: queryNumber(query, "limit", { min: 1, max: 50, integer: true }) ?? 20,
    offset: queryNumber(query, "offset", { min: 0, max: 1_000_000, integer: true }) ?? 0,
  };
  const city = query.city?.trim();
  if (city) {
    if (city.length > 100) throw new ValidationError("city: troppo lungo");
    f.city = city;
  }
  if (query.listingType) {
    if (!(LISTING_TYPES as readonly string[]).includes(query.listingType)) {
      throw new ValidationError("listingType: deve essere sale o rent");
    }
    f.listingType = query.listingType as ListFilters["listingType"];
  }
  const minPrice = queryNumber(query, "minPrice", { min: 0 });
  const maxPrice = queryNumber(query, "maxPrice", { min: 0 });
  const rooms = queryNumber(query, "rooms", { min: 0, max: 1000, integer: true });
  if (minPrice !== undefined) f.minPrice = minPrice;
  if (maxPrice !== undefined) f.maxPrice = maxPrice;
  if (rooms !== undefined) f.rooms = rooms;
  return f;
}

/** WHERE parametrizzato: i valori vanno sempre in `params`, mai nel testo SQL. */
export function buildListWhere(f: ListFilters): { where: string; params: unknown[] } {
  const conds = ["p.status = 'active'"];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    conds.push(sql.replace("?", `$${params.length}`));
  };
  if (f.city !== undefined) add("lower(p.city) = lower(?)", f.city);
  if (f.listingType !== undefined) add("p.listing_type = ?", f.listingType);
  if (f.minPrice !== undefined) add("p.price >= ?", f.minPrice);
  if (f.maxPrice !== undefined) add("p.price <= ?", f.maxPrice);
  if (f.rooms !== undefined) add("p.rooms >= ?", f.rooms);
  return { where: conds.join(" AND "), params };
}

// ---- POST / PUT: validazione e UPDATE dinamico ---------------------------------------------------------------------

/** Campi modificabili: nome JSON -> colonna. È la whitelist: nessun altro nome finisce nell'SQL. */
export const COLUMN_OF = {
  title: "title",
  description: "description",
  price: "price",
  city: "city",
  address: "address",
  listingType: "listing_type",
  rooms: "rooms",
  bathrooms: "bathrooms",
  areaSqm: "area_sqm",
} as const;
export type PropertyField = keyof typeof COLUMN_OF;
export type PropertyInput = Partial<Record<PropertyField, string | number | null>>;

/** Legge e valida i campi dell'annuncio. In creazione title, price, city, listingType sono obbligatori. */
export function parsePropertyInput(body: Record<string, unknown>, mode: "create" | "update"): PropertyInput {
  const f = new Fields(body);
  const req = mode === "create";
  const out: PropertyInput = {
    title: f.string("title", { required: req, min: 1, max: 200 }) as string | undefined,
    description: f.string("description", { nullable: true, max: 5000 }),
    price: f.money("price", { required: req, min: 0 }),
    city: f.string("city", { required: req, min: 1, max: 100 }) as string | undefined,
    address: f.string("address", { nullable: true, max: 300 }),
    listingType: f.oneOf("listingType", LISTING_TYPES, { required: req }),
    rooms: f.integer("rooms", { nullable: true, min: 0, max: 1000 }),
    bathrooms: f.integer("bathrooms", { nullable: true, min: 0, max: 1000 }),
    areaSqm: f.integer("areaSqm", { nullable: true, min: 1, max: 1_000_000 }),
  };
  f.done();
  // Via le chiavi non presenti: in update "assente" vuol dire "non toccare".
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as PropertyInput;
}

/** `SET col = $n, ...` per i soli campi presenti. `firstParam` = numero del primo segnaposto libero. */
export function buildUpdateSet(input: PropertyInput, firstParam: number): { set: string; params: unknown[] } {
  const entries = Object.entries(input) as [PropertyField, string | number | null][];
  return {
    set: entries.map(([k], i) => `${COLUMN_OF[k]} = $${firstParam + i}`).join(", "),
    params: entries.map(([, v]) => v),
  };
}

/** `INSERT (owner_id, ...) VALUES ($1, ...)`: owner_id sempre per primo, poi i campi presenti. */
export function buildInsert(ownerId: string, input: PropertyInput): { columns: string; holders: string; params: unknown[] } {
  const entries = Object.entries(input) as [PropertyField, string | number | null][];
  return {
    columns: ["owner_id", ...entries.map(([k]) => COLUMN_OF[k])].join(", "),
    holders: ["$1", ...entries.map((_, i) => `$${i + 2}`)].join(", "),
    params: [ownerId, ...entries.map(([, v]) => v)],
  };
}

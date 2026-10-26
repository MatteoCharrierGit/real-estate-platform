// Test d'integrazione contro un PostgreSQL reale: applica schema.sql e roles.sql (con la stessa funzione di db-migrate)
// in un database nuovo e fa girare le route VERE connesse come i 5 utenti applicativi, così si verifica che i GRANT
// bastino a ciò che il codice fa (e che certe cose siano vietate). S3 e SNS sono finti.
// Si esegue solo se PG_TEST_HOST è impostato, per esempio:
//   PG_TEST_HOST=127.0.0.1 PG_TEST_PORT=5433 PG_TEST_MASTER_USER=master PG_TEST_MASTER_PASSWORD=... npm test
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Client, Pool } from "pg";
import { wrapPool, type Db } from "../src/shared/db";
import type { ApiEvent } from "../src/shared/http";
import { createApiHandler } from "../src/shared/http";
import type { Publisher } from "../src/shared/sns";
import { createHandler as createMigrateHandler } from "../src/functions/db-migrate/index";
import { registerObject } from "../src/functions/files/register";
import { createRoutes as propertyRoutes } from "../src/functions/property/routes";
import { createRoutes as usersRoutes } from "../src/functions/users/routes";
import { createRoutes as offersRoutes } from "../src/functions/offers/routes";
import { createRoutes as presignedRoutes } from "../src/functions/presigned/routes";
import { createRoutes as filesRoutes } from "../src/functions/files/routes";

const host = process.env.PG_TEST_HOST;
const port = Number(process.env.PG_TEST_PORT ?? "5432");
const master = { user: process.env.PG_TEST_MASTER_USER ?? "", password: process.env.PG_TEST_MASTER_PASSWORD ?? "" };
const DB = `rt_${Date.now()}`;
const PW = {
  property_user: "pw-property-0123456789",
  users_user: "pw-users-0123456789",
  offers_user: "pw-offers-0123456789",
  files_user: "pw-files-0123456789",
  presigned_user: "pw-presigned-0123456789'\"\\x",
};

const pools: Pool[] = [];
function dbAs(user: keyof typeof PW): Db {
  const pool = new Pool({ host, port, database: DB, user, password: PW[user], max: 1 });
  pools.push(pool);
  return wrapPool(pool);
}

// ---- finti: S3 e SNS ---------------------------------------------------------------------------------------------
const s3Calls: string[] = [];
let s3Fail = false;
const s3 = {
  objects: [] as string[],
  async send(cmd: { constructor: { name: string }; input: Record<string, any> }) {
    const name = cmd.constructor.name.replace(/\d+$/, ""); // esbuild può rinominare le classi (Foo2)
    s3Calls.push(`${name}:${cmd.input.Prefix ?? cmd.input.Key ?? ""}`);
    if (s3Fail) throw new Error("S3 non risponde");
    if (name === "ListObjectsV2Command") {
      return { Contents: this.objects.filter((k) => k.startsWith(cmd.input.Prefix)).map((Key) => ({ Key })) };
    }
    if (name === "DeleteObjectsCommand") {
      const del = new Set(cmd.input.Delete.Objects.map((o: { Key: string }) => o.Key));
      this.objects = this.objects.filter((k) => !del.has(k));
      return {};
    }
    if (name === "DeleteObjectCommand") {
      this.objects = this.objects.filter((k) => k !== cmd.input.Key);
      return {};
    }
    throw new Error(`comando S3 inatteso ${name}`);
  },
};
const published: { type: string; to: string; data: any }[] = [];
const publish: Publisher = async (type, to, data) => void published.push({ type, to, data });

function req(routeKey: string, o: { sub?: string; groups?: string[]; params?: Record<string, string>; query?: Record<string, string>; body?: unknown } = {}): ApiEvent {
  return {
    routeKey,
    pathParameters: o.params,
    queryStringParameters: o.query,
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
    isBase64Encoded: false,
    requestContext: o.sub
      ? { authorizer: { jwt: { claims: { sub: o.sub, token_use: "access", "cognito:groups": `[${(o.groups ?? []).join(" ")}]` } } } }
      : {},
  } as unknown as ApiEvent;
}
const body = (r: { body?: string }) => JSON.parse(r.body ?? "null");

describe("integrazione PostgreSQL", { skip: host ? false : "PG_TEST_HOST non impostato" }, () => {
  let property: ReturnType<typeof createApiHandler>;
  let users: typeof property, offers: typeof property, presigned: typeof property, files: typeof property;
  let filesDb: Db;
  const A = "sub-agent-A", B = "sub-buyer-B", C = "sub-buyer-C", ADMIN = "sub-admin";
  let propId = "", offerId = "";

  before(async () => {
    // 1. db-migrate: crea il database, applica schema e ruoli. Due volte (idempotenza).
    const migrate = createMigrateHandler({
      dbName: DB,
      connect: async (database, user, password) => {
        const c = new Client({ host, port, database, user, password });
        await c.connect();
        return c;
      },
    });
    const ev = { action: "migrate", masterUser: master.user, masterPassword: master.password, passwords: PW };
    const r1: any = await migrate(ev);
    assert.equal(r1.ok, true, JSON.stringify(r1));
    assert.equal(r1.database.created, true);
    assert.deepEqual(r1.summary.tables, ["files", "offers", "properties", "users"]);
    const r2: any = await migrate(ev);
    assert.equal(r2.ok, true, JSON.stringify(r2));
    assert.equal(r2.database.created, false);
    assert.equal(JSON.stringify(r2).includes(PW.users_user), false, "nessuna password nel risultato");
    const st: any = await migrate({ action: "status", masterUser: master.user, masterPassword: master.password });
    assert.equal(st.summary.roles.users_user.exists, true);

    // 2. Le route, ciascuna connessa col SUO utente.
    property = createApiHandler(propertyRoutes({ db: dbAs("property_user"), s3: s3 as any, bucket: "b" }));
    users = createApiHandler(usersRoutes({ db: dbAs("users_user"), publish }));
    offers = createApiHandler(offersRoutes({ db: dbAs("offers_user"), publish }));
    presigned = createApiHandler(presignedRoutes({ db: dbAs("presigned_user"), s3: new (require("@aws-sdk/client-s3").S3Client)({ region: "eu-south-1", credentials: { accessKeyId: "AKIAEXAMPLE", secretAccessKey: "secret" } }), bucket: "real-estate-prod-files-x" }));
    filesDb = dbAs("files_user");
    files = createApiHandler(filesRoutes({ db: filesDb, s3: s3 as any, bucket: "b" }));
  });

  after(async () => {
    await Promise.allSettled(pools.map((p) => p.end()));
    const c = new Client({ host, port, database: "postgres", ...master });
    await c.connect();
    await c.query(`DROP DATABASE IF EXISTS ${DB}`);
    await c.end();
  });

  it("users: PUT crea (201 + WELCOME), poi aggiorna (200), GET, 404 prima della creazione", async () => {
    assert.equal((await users(req("GET /users/me", { sub: A }))).statusCode, 404);
    const r = await users(req("PUT /users/me", { sub: A, groups: ["agent"], body: { displayName: "Anna Agente", phone: "123", sub: "evil" } }));
    assert.equal(r.statusCode, 201);
    assert.equal(body(r).sub, A);
    assert.equal(published.at(-1)?.type, "WELCOME");
    for (const s of [B, C, ADMIN]) assert.equal((await users(req("PUT /users/me", { sub: s, body: { displayName: `U ${s}` } }))).statusCode, 201);
    const upd = await users(req("PUT /users/me", { sub: A, body: { bio: "Esperta di Milano" } }));
    assert.equal(upd.statusCode, 200);
    assert.equal(body(upd).displayName, "Anna Agente"); // campo assente = invariato
    assert.equal(body(upd).bio, "Esperta di Milano");
    assert.equal(published.filter((e) => e.type === "WELCOME").length, 4);
    assert.equal(body(await users(req("GET /users/{id}", { params: { id: A } }))).displayName, "Anna Agente");
  });

  it("property: POST solo agent, lista con filtri e total, dettaglio con agent", async () => {
    const data = { title: "Trilocale in centro", description: "Bello", price: 250000.5, city: "Milano", address: "Via Roma 1", listingType: "sale", rooms: 3, bathrooms: 1, areaSqm: 90 };
    assert.equal((await property(req("POST /properties", { sub: B, groups: ["buyer"], body: data }))).statusCode, 403);
    assert.equal((await property(req("POST /properties", { sub: A, groups: ["agent"], body: { ...data, price: -1 } }))).statusCode, 422);
    const r = await property(req("POST /properties", { sub: A, groups: ["agent"], body: data }));
    assert.equal(r.statusCode, 201, r.body);
    const p = body(r);
    propId = p.id;
    assert.equal(p.price, 250000.5);
    assert.equal(p.ownerId, A);
    assert.equal(p.coverKey, null);
    await property(req("POST /properties", { sub: A, groups: ["agent"], body: { ...data, title: "Bilocale", city: "Roma", price: 100000, rooms: 2, listingType: "rent" } }));

    const all = body(await property(req("GET /properties")));
    assert.equal(all.total, 2);
    const milan = body(await property(req("GET /properties", { query: { city: "milano", minPrice: "200000", rooms: "3", listingType: "sale", limit: "1" } })));
    assert.equal(milan.total, 1);
    assert.equal(milan.items[0].city, "Milano");
    assert.equal(body(await property(req("GET /properties", { query: { limit: "1", offset: "1" } }))).items.length, 1);
    assert.equal((await property(req("GET /properties", { query: { limit: "500" } }))).statusCode, 422);

    const d = body(await property(req("GET /properties/{id}", { params: { id: propId } })));
    assert.equal(d.agent.displayName, "Anna Agente");
    assert.equal((await property(req("GET /properties/{id}", { params: { id: "999999" } }))).statusCode, 404);
  });

  it("property: PUT solo proprietario o admin", async () => {
    assert.equal((await property(req("PUT /properties/{id}", { sub: B, groups: ["agent"], params: { id: propId }, body: { title: "x" } }))).statusCode, 403);
    const r = await property(req("PUT /properties/{id}", { sub: A, groups: ["agent"], params: { id: propId }, body: { title: "Nuovo titolo", description: null } }));
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(body(r).title, "Nuovo titolo");
    assert.equal(body(r).description, null);
    assert.equal((await property(req("PUT /properties/{id}", { sub: ADMIN, groups: ["admin"], params: { id: propId }, body: { price: 1 } }))).statusCode, 200);
  });

  it("presigned: solo il proprietario, tipo e dimensione controllati", async () => {
    const ok = await presigned(req("POST /properties/{id}/uploads", { sub: A, params: { id: propId }, body: { contentType: "image/jpeg", size: 1000 } }));
    assert.equal(ok.statusCode, 200, ok.body);
    assert.match(body(ok).key, new RegExp(`^uploads/${propId}/[0-9a-f-]{36}\\.jpg$`));
    assert.equal(body(ok).expiresIn, 300);
    assert.equal((await presigned(req("POST /properties/{id}/uploads", { sub: B, params: { id: propId }, body: { contentType: "image/jpeg", size: 1000 } }))).statusCode, 403);
    assert.equal((await presigned(req("POST /properties/{id}/uploads", { sub: A, params: { id: propId }, body: { contentType: "application/pdf", size: 1000 } }))).statusCode, 422);
    assert.equal((await presigned(req("POST /properties/{id}/uploads", { sub: A, params: { id: propId }, body: { contentType: "image/png", size: 11 * 1024 * 1024 } }))).statusCode, 422);
    assert.equal((await presigned(req("POST /properties/{id}/uploads", { sub: A, params: { id: "999999" }, body: { contentType: "image/png", size: 5 } }))).statusCode, 404);
  });

  it("files: registrazione idempotente, elenco, cover nella lista, DELETE solo proprietario", async () => {
    const key = `uploads/${propId}/a b.jpg`;
    s3.objects.push(key, `uploads/${propId}/v.mp4`);
    const obj = (k: string) => ({ bucket: "b", key: k, size: 1234 });
    assert.equal(await registerObject(filesDb, s3 as any, obj(key)), "registered");
    assert.equal(await registerObject(filesDb, s3 as any, obj(key)), "duplicate");
    assert.equal(await registerObject(filesDb, s3 as any, obj(`uploads/${propId}/v.mp4`)), "registered");
    assert.equal(await registerObject(filesDb, s3 as any, obj("altro/x.jpg")), "ignored");
    // immobile inesistente: oggetto cancellato
    s3.objects.push("uploads/987654/z.jpg");
    assert.equal(await registerObject(filesDb, s3 as any, obj("uploads/987654/z.jpg")), "discarded");
    assert.equal(s3.objects.includes("uploads/987654/z.jpg"), false);

    const list = body(await files(req("GET /properties/{id}/files", { params: { id: propId } })));
    assert.equal(list.items.length, 2);
    assert.equal(list.items[0].contentType, "image/jpeg");
    assert.equal(list.items[0].sizeBytes, 1234);
    assert.equal(body(await property(req("GET /properties/{id}", { params: { id: propId } }))).property.coverKey, key);

    const fid = list.items[1].id;
    assert.equal((await files(req("DELETE /files/{id}", { sub: B, params: { id: fid } }))).statusCode, 403);
    assert.equal((await files(req("DELETE /files/{id}", { sub: A, params: { id: fid } }))).statusCode, 204);
    assert.equal(s3.objects.includes(`uploads/${propId}/v.mp4`), false);
    assert.equal(body(await files(req("GET /properties/{id}/files", { params: { id: propId } }))).items.length, 1);
  });

  it("offers: creazione (solo buyer), eventi, elenco con ruolo, accetta solo proprietario, ritiro", async () => {
    assert.equal((await offers(req("POST /properties/{id}/offers", { sub: A, groups: ["agent"], params: { id: propId }, body: { amount: 1 } }))).statusCode, 403);
    assert.equal((await offers(req("POST /properties/{id}/offers", { sub: B, groups: ["buyer"], params: { id: propId }, body: { amount: 0 } }))).statusCode, 422);
    const r = await offers(req("POST /properties/{id}/offers", { sub: B, groups: ["buyer"], params: { id: propId }, body: { amount: 240000, message: "Ciao", buyerId: "evil" } }));
    assert.equal(r.statusCode, 201, r.body);
    offerId = body(r).id;
    assert.equal(body(r).buyerId, B);
    assert.equal(body(r).role, "buyer");
    assert.deepEqual(published.at(-1), { type: "OFFER_CREATED", to: A, data: { propertyId: propId, propertyTitle: "Nuovo titolo", offerId, amount: 240000 } });

    const mine = body(await offers(req("GET /offers", { sub: A })));
    assert.equal(mine.items.length, 1);
    assert.equal(mine.items[0].role, "owner");
    assert.equal(body(await offers(req("GET /offers", { sub: B }))).items[0].role, "buyer");
    assert.equal(body(await offers(req("GET /offers", { sub: C }))).items.length, 0);

    assert.equal((await offers(req("PUT /offers/{id}", { sub: B, params: { id: offerId }, body: { status: "accepted" } }))).statusCode, 403);
    assert.equal((await offers(req("PUT /offers/{id}", { sub: A, params: { id: offerId }, body: { status: "withdrawn" } }))).statusCode, 422);
    const acc = await offers(req("PUT /offers/{id}", { sub: A, params: { id: offerId }, body: { status: "accepted" } }));
    assert.equal(acc.statusCode, 200, acc.body);
    assert.equal(body(acc).status, "accepted");
    assert.notEqual(body(acc).updatedAt, undefined);
    assert.equal(published.at(-1)?.type, "OFFER_ACCEPTED");
    assert.equal(published.at(-1)?.to, B);
    assert.equal((await offers(req("PUT /offers/{id}", { sub: A, params: { id: offerId }, body: { status: "rejected" } }))).statusCode, 409);
    assert.equal((await offers(req("DELETE /offers/{id}", { sub: B, params: { id: offerId } }))).statusCode, 409);

    const o2 = body(await offers(req("POST /properties/{id}/offers", { sub: C, groups: ["buyer"], params: { id: propId }, body: { amount: 200000 } })));
    assert.equal((await offers(req("DELETE /offers/{id}", { sub: B, params: { id: o2.id } }))).statusCode, 403);
    assert.equal((await offers(req("DELETE /offers/{id}", { sub: C, params: { id: o2.id } }))).statusCode, 204);
    assert.equal(body(await offers(req("GET /offers", { sub: C }))).items[0].status, "withdrawn");
  });

  it("users: DELETE /users/me anonimizza, ritira offerte in sospeso ed emette OFFER_WITHDRAWN all'altra parte", async () => {
    const pend = body(await offers(req("POST /properties/{id}/offers", { sub: B, groups: ["buyer"], params: { id: propId }, body: { amount: 230000 } })));
    const before = published.length;
    assert.equal((await users(req("DELETE /users/me", { sub: B }))).statusCode, 204);
    const evs = published.slice(before);
    assert.equal(evs.length, 1);
    assert.deepEqual(evs[0], { type: "OFFER_WITHDRAWN", to: A, data: { propertyId: propId, propertyTitle: "Nuovo titolo", offerId: pend.id, amount: 230000 } });
    assert.equal(body(await offers(req("GET /offers", { sub: A }))).items.find((o: any) => o.id === pend.id).status, "withdrawn");
    assert.equal((await users(req("DELETE /users/me", { sub: B }))).statusCode, 204); // ripetibile

    assert.equal((await users(req("GET /users/me", { sub: B }))).statusCode, 410);
    assert.equal((await users(req("PUT /users/me", { sub: B, body: { displayName: "ancora io" } }))).statusCode, 410);
    assert.equal((await users(req("GET /users/{id}", { params: { id: B } }))).statusCode, 404);
    // token ancora valido: le scritture delle altre Lambda danno 403
    assert.equal((await offers(req("POST /properties/{id}/offers", { sub: B, groups: ["buyer"], params: { id: propId }, body: { amount: 5 } }))).statusCode, 403);
    // i dati personali sono spariti, la riga resta
    const c = new Client({ host, port, database: DB, ...master });
    await c.connect();
    const row = (await c.query("SELECT display_name, phone, bio, deleted_at FROM users WHERE sub = $1", [B])).rows[0];
    assert.deepEqual([row.display_name, row.phone, row.bio], [null, null, null]);
    assert.notEqual(row.deleted_at, null);
    await c.end();
  });

  it("users: cancellazione del proprietario ritira immobili; upload tardivo viene scartato", async () => {
    const other = body(await property(req("POST /properties", { sub: A, groups: ["agent"], body: { title: "Altro", price: 1, city: "Torino", listingType: "rent" } })));
    assert.equal((await users(req("DELETE /users/me", { sub: A }))).statusCode, 204);
    const list = body(await property(req("GET /properties")));
    assert.equal(list.total, 0);
    const d = body(await property(req("GET /properties/{id}", { params: { id: other.id } })));
    assert.equal(d.property.status, "withdrawn");
    assert.equal(d.property.ownerId, undefined);
    assert.equal(d.agent, null);
    assert.equal((await property(req("PUT /properties/{id}", { sub: ADMIN, groups: ["admin"], params: { id: other.id }, body: { title: "x" } }))).statusCode, 409);
    assert.equal((await presigned(req("POST /properties/{id}/uploads", { sub: A, params: { id: other.id }, body: { contentType: "image/png", size: 5 } }))).statusCode, 403); // utente cancellato
    s3.objects.push(`uploads/${other.id}/late.png`);
    assert.equal(await registerObject(filesDb, s3 as any, { bucket: "b", key: `uploads/${other.id}/late.png`, size: 5 }), "discarded");
    assert.equal(s3.objects.includes(`uploads/${other.id}/late.png`), false);
    assert.equal((await offers(req("POST /properties/{id}/offers", { sub: C, groups: ["buyer"], params: { id: other.id }, body: { amount: 5 } }))).statusCode, 409);
  });

  it("property: DELETE (admin) cancella a cascata offerte e file e svuota il prefisso S3; se S3 fallisce risponde 204", async () => {
    assert.equal((await property(req("DELETE /properties/{id}", { sub: C, groups: ["buyer"], params: { id: propId } }))).statusCode, 403);
    s3.objects.push(`uploads/${propId}/orfano.png`, "uploads/99999/altro.png");
    s3Calls.length = 0;
    const r = await property(req("DELETE /properties/{id}", { sub: ADMIN, groups: ["admin"], params: { id: propId } }));
    assert.equal(r.statusCode, 204);
    assert.equal(r.body, undefined);
    assert.deepEqual(s3.objects, ["uploads/99999/altro.png"]); // solo il prefisso dell'immobile
    assert.ok(s3Calls.includes(`ListObjectsV2Command:uploads/${propId}/`));
    const c = new Client({ host, port, database: DB, ...master });
    await c.connect();
    for (const t of ["offers", "files"]) assert.equal((await c.query(`SELECT 1 FROM ${t} WHERE property_id = $1`, [propId])).rowCount, 0);
    // S3 giù dopo il commit
    const p2 = body(await property(req("POST /properties", { sub: ADMIN, groups: ["agent"], body: { title: "T", price: 1, city: "X", listingType: "sale" } })));
    s3Fail = true;
    assert.equal((await property(req("DELETE /properties/{id}", { sub: ADMIN, groups: ["admin"], params: { id: p2.id } }))).statusCode, 204);
    s3Fail = false;
    assert.equal((await c.query("SELECT 1 FROM properties WHERE id = $1", [p2.id])).rowCount, 0);
    await c.end();
    assert.equal((await property(req("DELETE /properties/{id}", { sub: ADMIN, groups: ["admin"], params: { id: p2.id } }))).statusCode, 404);
  });

  it("GRANT: ciò che non serve è vietato", async () => {
    const denied = async (user: keyof typeof PW, sql: string) => {
      const pool = new Pool({ host, port, database: DB, user, password: PW[user], max: 1 });
      try {
        await assert.rejects(pool.query(sql), (e: any) => e.code === "42501", `${user}: ${sql}`);
      } finally {
        await pool.end();
      }
    };
    await denied("users_user", "DELETE FROM users");
    await denied("users_user", "DELETE FROM properties");
    await denied("users_user", "UPDATE properties SET title = 'x'");
    await denied("users_user", "UPDATE offers SET amount = 1");
    await denied("users_user", "SELECT description FROM properties");
    await denied("offers_user", "DELETE FROM offers");
    await denied("offers_user", "INSERT INTO files (property_id, object_key) VALUES (1, 'x')");
    await denied("offers_user", "UPDATE properties SET status = 'active'");
    await denied("presigned_user", "UPDATE properties SET status = 'active'");
    await denied("presigned_user", "SELECT * FROM offers");
    await denied("files_user", "UPDATE files SET object_key = 'y'");
    await denied("files_user", "SELECT display_name FROM users");
    await denied("property_user", "UPDATE properties SET owner_id = 'x'");
    await denied("property_user", "UPDATE properties SET status = 'active'");
    await denied("property_user", "DELETE FROM files");
    await denied("property_user", "DELETE FROM offers");
    await denied("property_user", "CREATE TABLE evil (a int)");
  });
});

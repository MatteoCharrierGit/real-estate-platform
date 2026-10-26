import { S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { S3Event, SQSEvent } from "aws-lambda";
import { renderRolesSql, redact, validatePasswords } from "../src/functions/db-migrate/migrate";
import { isS3Event, objectsFromS3Event } from "../src/functions/files/register";
import { createHandler } from "../src/functions/mailer/handler";
import { classifyError, parseEvent, PermanentError } from "../src/functions/mailer/events";
import { escapeHtml, render } from "../src/functions/mailer/templates";
import { buildInsert, buildListWhere, buildUpdateSet, mapProperty, parseListQuery, parsePropertyInput } from "../src/functions/property/model";
import { buildKey, buildPostParams, parseUploadRequest } from "../src/functions/presigned/upload";
import { otherParty } from "../src/functions/users/routes";
import rolesSql from "../../database/roles.sql";

describe("property: filtri, whitelist colonne, SQL parametrizzato", () => {
  it("parseListQuery: default, limiti e valori non validi", () => {
    assert.deepEqual(parseListQuery({}), { limit: 20, offset: 0 });
    assert.equal(parseListQuery({ limit: "50" }).limit, 50);
    assert.throws(() => parseListQuery({ limit: "51" }));
    assert.throws(() => parseListQuery({ offset: "-1" }));
    assert.throws(() => parseListQuery({ minPrice: "abc" }));
    assert.throws(() => parseListQuery({ listingType: "buy" }));
  });
  it("buildListWhere: i valori vanno solo in params, mai nel testo", () => {
    const evil = "Milano'; DROP TABLE properties;--";
    const { where, params } = buildListWhere(parseListQuery({ city: evil, minPrice: "10", maxPrice: "99", rooms: "3", listingType: "rent" }));
    assert.equal(where.includes("DROP"), false);
    assert.equal(where, "p.status = 'active' AND lower(p.city) = lower($1) AND p.listing_type = $2 AND p.price >= $3 AND p.price <= $4 AND p.rooms >= $5");
    assert.deepEqual(params, [evil, "rent", 10, 99, 3]);
  });
  it("buildUpdateSet / buildInsert: solo campi presenti, nomi colonna dalla whitelist", () => {
    const input = parsePropertyInput({ title: "T", areaSqm: 80, description: null, "x; DROP": 1, owner_id: "evil" }, "update");
    assert.deepEqual(input, { title: "T", description: null, areaSqm: 80 });
    assert.deepEqual(buildUpdateSet(input, 2), { set: "title = $2, description = $3, area_sqm = $4", params: ["T", null, 80] });
    const ins = buildInsert("me", input);
    assert.equal(ins.columns, "owner_id, title, description, area_sqm");
    assert.equal(ins.holders, "$1, $2, $3, $4");
    assert.deepEqual(ins.params, ["me", "T", null, 80]);
  });
  it("creazione: title, price, city, listingType obbligatori", () => {
    assert.throws(() => parsePropertyInput({ title: "x" }, "create"), /price.*city.*listingType/);
    assert.doesNotThrow(() => parsePropertyInput({ title: "x", price: 1, city: "y", listingType: "sale" }, "create"));
  });
  it("mapProperty: ownerId assente se ritirato, price numero", () => {
    const row = { id: "1", owner_id: "o", title: "t", description: null, price: "100.50", city: "c", address: null, listing_type: "sale", rooms: 1, bathrooms: 1, area_sqm: 1, status: "withdrawn" as const, created_at: new Date(0), cover_key: null };
    const w = mapProperty(row);
    assert.equal("ownerId" in w, false);
    assert.equal(w.price, 100.5);
    assert.equal(mapProperty({ ...row, status: "active" }).ownerId, "o");
  });
});

describe("presigned: chiave e condizioni", () => {
  it("la chiave è uploads/<id>/<uuid>.<ext> con ext dalla whitelist", () => {
    assert.equal(buildKey("42", "image/png", "u-1"), "uploads/42/u-1.png");
    assert.equal(buildKey("42", "video/quicktime", "u-1"), "uploads/42/u-1.mov");
    assert.match(buildKey("7", "image/jpeg"), /^uploads\/7\/[0-9a-f-]{36}\.jpg$/);
    assert.throws(() => buildKey("42", "text/html"));
  });
  it("parseUploadRequest: tipi e limiti (10 MiB immagini, 100 MiB video)", () => {
    assert.deepEqual(parseUploadRequest({ contentType: "image/jpeg", size: 10 * 1024 * 1024 }), { contentType: "image/jpeg", size: 10485760 });
    assert.throws(() => parseUploadRequest({ contentType: "image/jpeg", size: 10 * 1024 * 1024 + 1 }));
    assert.doesNotThrow(() => parseUploadRequest({ contentType: "video/mp4", size: 100 * 1024 * 1024 }));
    assert.throws(() => parseUploadRequest({ contentType: "video/mp4", size: 100 * 1024 * 1024 + 1 }));
    assert.throws(() => parseUploadRequest({ contentType: "application/pdf", size: 5 }), /non ammesso/);
    assert.throws(() => parseUploadRequest({ contentType: "image/png", size: 0 }));
    assert.throws(() => parseUploadRequest({ contentType: "image/png", size: 1.5 }));
  });
  it("il policy firmato contiene bucket, chiave esatta, prefisso del tipo, intervallo di dimensione e scadenza 5 minuti", async () => {
    const s3 = new S3Client({ region: "eu-south-1", credentials: { accessKeyId: "AKIAEXAMPLE", secretAccessKey: "x" } });
    const key = buildKey("42", "video/mp4", "u-1");
    const { url, fields } = await createPresignedPost(s3, buildPostParams("real-estate-prod-files-x", key, "video/mp4"));
    assert.match(url, /real-estate-prod-files-x/);
    assert.equal(fields.key, key);
    assert.equal(fields["Content-Type"], "video/mp4");
    const policy = JSON.parse(Buffer.from(fields.Policy as string, "base64").toString());
    const c = JSON.stringify(policy.conditions);
    assert.ok(c.includes('{"bucket":"real-estate-prod-files-x"}'));
    assert.ok(c.includes(`{"key":"${key}"}`));
    assert.ok(c.includes('["starts-with","$Content-Type","video/"]'));
    assert.ok(c.includes('["content-length-range",1,104857600]'));
    assert.ok(c.includes('{"Content-Type":"video/mp4"}'));
    const ttl = (Date.parse(policy.expiration) - Date.now()) / 1000;
    assert.ok(ttl > 290 && ttl <= 300, `scadenza ${ttl}s`);
  });
});

describe("files: eventi S3", () => {
  const s3ev = (key: string, name = "ObjectCreated:Post"): S3Event =>
    ({ Records: [{ eventName: name, s3: { bucket: { name: "b" }, object: { key, size: 99 } } }] }) as unknown as S3Event;
  it("decodifica la chiave URL-codificata ('+' = spazio, %XX)", () => {
    assert.deepEqual(objectsFromS3Event(s3ev("uploads/1/foto+bella%C3%A8%2B.jpg")), [{ bucket: "b", key: "uploads/1/foto bellaè+.jpg", size: 99 }]);
  });
  it("ignora gli eventi che non sono ObjectCreated", () => {
    assert.deepEqual(objectsFromS3Event(s3ev("uploads/1/a.jpg", "ObjectRemoved:Delete")), []);
  });
  it("distingue evento S3 da evento HTTP", () => {
    assert.equal(isS3Event(s3ev("uploads/1/a.jpg")), true);
    assert.equal(isS3Event({ routeKey: "GET /properties/{id}/files" }), false);
    assert.equal(isS3Event({ Records: [] }), false);
    assert.equal(isS3Event(null), false);
  });
});

describe("users: destinatario dell'avviso di offerta ritirata", () => {
  it("l'altra parte; nessun avviso a se stessi", () => {
    assert.equal(otherParty({ buyer_id: "me", owner_id: "agent" }, "me"), "agent");
    assert.equal(otherParty({ buyer_id: "buyer", owner_id: "me" }, "me"), "buyer");
    assert.equal(otherParty({ buyer_id: "me", owner_id: "me" }, "me"), null);
  });
});

describe("mailer", () => {
  const body = (o: unknown) => JSON.stringify(o);
  const valid = { eventId: "e1", type: "OFFER_CREATED", recipientSub: "sub-1", occurredAt: "2026-10-22T10:15:00Z", data: { propertyId: "1042", propertyTitle: "Trilocale <b>in centro</b>", offerId: "5", amount: 250000 } };

  it("parseEvent: valido e malformato (permanente)", () => {
    assert.equal(parseEvent(body(valid)).recipientSub, "sub-1");
    for (const bad of ["{rotto", body([]), body({ ...valid, type: "BOH" }), body({ ...valid, recipientSub: "" }), body({ type: "WELCOME" })]) {
      assert.throws(() => parseEvent(bad), PermanentError);
    }
  });
  it("classifyError: temporaneo, permanente, destinatario cancellato", () => {
    const named = (name: string) => Object.assign(new Error("x"), { name });
    assert.equal(classifyError(named("UserNotFoundException")), "recipient-deleted");
    assert.equal(classifyError(named("MessageRejected")), "permanent");
    assert.equal(classifyError(named("InvalidParameterException")), "permanent");
    assert.equal(classifyError(new PermanentError("x")), "permanent");
    for (const t of ["TooManyRequestsException", "SendingPausedException", "InternalErrorException", "TimeoutError", "NotAuthorizedException"]) {
      assert.equal(classifyError(named(t)), "temporary", t);
    }
    assert.equal(classifyError("stringa"), "temporary");
  });
  it("render: italiano, 5 tipi, HTML con escape, link sotto SITE_URL", () => {
    for (const type of ["WELCOME", "OFFER_CREATED", "OFFER_ACCEPTED", "OFFER_REJECTED", "OFFER_WITHDRAWN"] as const) {
      const r = render({ ...valid, type } as never, "https://app.mchaservice.tech/");
      assert.ok(r.subject.length > 0 && r.text.includes("https://app.mchaservice.tech/"), type);
      assert.equal(r.html.includes("<b>"), false, "il titolo va escapato nell'HTML");
    }
    const r = render(valid as never, "https://app.mchaservice.tech");
    assert.match(r.text, /250\.000,00/);
    assert.ok(r.html.includes("&lt;b&gt;"));
    assert.equal(escapeHtml(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
    const nl = render({ ...valid, data: { propertyTitle: "riga1\r\nBcc: x@y.z" } } as never, "https://s");
    assert.equal(/[\r\n]/.test(nl.subject), false, "niente a capo nell'oggetto");
  });

  it("handler: batchItemFailures solo per i temporanei; log MAIL_PERMANENT_FAILURE come si aspetta il metric filter; niente email nei log", async () => {
    const named = (name: string, message = "x") => Object.assign(new Error(message), { name });
    const users: Record<string, () => unknown> = {
      ok: () => ({ UserAttributes: [{ Name: "email", Value: "mario.rossi@example.com" }, { Name: "email_verified", Value: "true" }] }),
      unverified: () => ({ UserAttributes: [{ Name: "email", Value: "x@example.com" }, { Name: "email_verified", Value: "false" }] }),
      gone: () => { throw named("UserNotFoundException"); },
      rejected: () => ({ UserAttributes: [{ Name: "email", Value: "reject@example.com" }, { Name: "email_verified", Value: "true" }] }),
      throttled: () => { throw named("TooManyRequestsException"); },
    };
    const sent: string[] = [];
    const handler = createHandler({
      userPoolId: "pool",
      mailFrom: "noreply@example.com",
      siteUrl: "https://s",
      cognito: { send: async (cmd: any) => users[cmd.input.Username]!() } as never,
      ses: {
        send: async (cmd: any) => {
          const to = cmd.input.Destination.ToAddresses[0];
          if (to === "reject@example.com") throw named("MessageRejected", "Email address is not verified: reject@example.com");
          sent.push(to);
          assert.equal(cmd.input.Content.Simple.Subject.Charset, "UTF-8");
          assert.ok(cmd.input.Content.Simple.Body.Html && cmd.input.Content.Simple.Body.Text);
        },
      } as never,
    });
    const rec = (id: string, recipient: string, b: string = body({ ...valid, recipientSub: recipient })) => ({ messageId: id, body: b });
    const event = { Records: [rec("m-ok", "ok"), rec("m-unv", "unverified"), rec("m-gone", "gone"), rec("m-rej", "rejected"), rec("m-thr", "throttled"), rec("m-bad", "x", "non json")] } as unknown as SQSEvent;

    const lines: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => (lines.push(String(chunk)), true)) as never;
    let res;
    try {
      res = await handler(event);
    } finally {
      process.stdout.write = orig;
    }
    assert.deepEqual(res.batchItemFailures, [{ itemIdentifier: "m-thr" }]);
    assert.deepEqual(sent, ["mario.rossi@example.com"]);

    const logs = lines.map((l) => JSON.parse(l));
    const permanent = logs.filter((l) => l.level === "ERROR" && l.code === "MAIL_PERMANENT_FAILURE").map((l) => l.messageId).sort();
    assert.deepEqual(permanent, ["m-bad", "m-rej", "m-unv"]);
    assert.equal(logs.find((l) => l.messageId === "m-gone").level, "INFO");
    assert.equal(logs.find((l) => l.messageId === "m-gone").code, "RECIPIENT_DELETED");
    assert.equal(logs.find((l) => l.messageId === "m-thr").level, "WARN");
    assert.equal(lines.join("").includes("@"), false, "nessun indirizzo email nei log");
  });
});

describe("db-migrate", () => {
  const pw = { property_user: "a'b\\c-0123456789", users_user: "u-0123456789ab", offers_user: "o-0123456789ab", files_user: "f-0123456789ab", presigned_user: "p-0123456789ab" };
  it("renderRolesSql: ogni variabile diventa un literal quotato, senza residui", () => {
    const sql = renderRolesSql(rolesSql, pw);
    assert.equal(/:'[a-z_]+'/.test(sql), false);
    assert.ok(sql.includes("E'a''b\\\\c-0123456789'"), "apice raddoppiato e backslash protetto");
    assert.ok(sql.includes("'u-0123456789ab'"));
  });
  it("renderRolesSql rifiuta variabili sconosciute", () => {
    assert.throws(() => renderRolesSql("SELECT :'boh'", pw), /sconosciuta/);
  });
  it("validatePasswords e redact", () => {
    assert.deepEqual(validatePasswords(pw), []);
    assert.equal(validatePasswords({ ...pw, users_user: "corta" }).length, 1);
    assert.ok(validatePasswords(null).length > 0);
    assert.equal(redact("errore con segreta123 dentro", ["segreta123"]), "errore con *** dentro");
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { currentUser, parseGroups, requireGroup } from "../src/shared/auth";
import { BadRequestError, ForbiddenError, UnauthorizedError } from "../src/shared/errors";
import { createApiHandler, findRoute, parseBody, parseId, toErrorResponse, type ApiEvent } from "../src/shared/http";
import { contentTypeFromKey, mediaType, propertyIdFromKey } from "../src/shared/media";
import { buildEvent } from "../src/shared/sns";
import { Fields } from "../src/shared/validation";

const claimsEvent = (claims: Record<string, unknown>) => ({ requestContext: { authorizer: { jwt: { claims } } } });

describe("parseGroups / currentUser", () => {
  it("legge il formato '[buyer agent]' dell'HTTP API", () => {
    assert.deepEqual(parseGroups("[buyer agent]"), ["buyer", "agent"]);
    assert.deepEqual(parseGroups("[admin]"), ["admin"]);
    assert.deepEqual(parseGroups("[]"), []);
    assert.deepEqual(parseGroups(""), []);
    assert.deepEqual(parseGroups(undefined), []);
  });
  it("accetta anche array e stringhe con virgole o virgolette", () => {
    assert.deepEqual(parseGroups(["buyer", "agent"]), ["buyer", "agent"]);
    assert.deepEqual(parseGroups('["buyer","agent"]'), ["buyer", "agent"]);
    assert.deepEqual(parseGroups("buyer,agent"), ["buyer", "agent"]);
  });
  it("currentUser: sub e gruppi dai claim", () => {
    const u = currentUser(claimsEvent({ sub: "abc", token_use: "access", "cognito:groups": "[buyer agent]" }));
    assert.deepEqual(u, { sub: "abc", groups: ["buyer", "agent"] });
  });
  it("rifiuta l'ID token, i claim mancanti e il sub vuoto (401)", () => {
    assert.throws(() => currentUser(claimsEvent({ sub: "abc", token_use: "id" })), UnauthorizedError);
    assert.throws(() => currentUser({}), UnauthorizedError);
    assert.throws(() => currentUser(claimsEvent({ token_use: "access" })), UnauthorizedError);
  });
  it("requireGroup: 403 senza il gruppo", () => {
    const u = { sub: "a", groups: ["buyer"] };
    assert.equal(requireGroup(u, "buyer"), u);
    assert.throws(() => requireGroup(u, "agent"), ForbiddenError);
    assert.equal(requireGroup(u, "agent", "buyer"), u);
  });
});

describe("router e risposte", () => {
  const routes = { "GET /x/{id}": async () => ({ statusCode: 200, body: "ok" }) };
  it("findRoute usa la routeKey esatta", () => {
    assert.ok(findRoute(routes, "GET /x/{id}"));
    assert.equal(findRoute(routes, "POST /x/{id}"), null);
    assert.equal(findRoute(routes, "toString"), null);
    assert.equal(findRoute(routes, undefined), null);
  });
  it("route sconosciuta -> 404 nel formato del contratto", async () => {
    const r = await createApiHandler(routes)({ routeKey: "DELETE /nope" } as ApiEvent);
    assert.equal(r.statusCode, 404);
    assert.equal(r.headers?.["content-type"], "application/json");
    assert.equal(JSON.parse(r.body ?? "").error.code, "NOT_FOUND");
  });
  it("mappa gli errori: HttpError, vincoli PostgreSQL, errore generico senza dettagli", () => {
    assert.equal(toErrorResponse(new ForbiddenError("no")).statusCode, 403);
    assert.equal(toErrorResponse(Object.assign(new Error("fk"), { code: "23503" })).statusCode, 409);
    assert.equal(toErrorResponse(Object.assign(new Error("chk"), { code: "23514" })).statusCode, 422);
    const r = toErrorResponse(new Error("password=segreta"));
    assert.equal(r.statusCode, 500);
    assert.equal(r.body?.includes("segreta"), false);
  });
  it("parseBody: vuoto, base64, JSON non valido, non-oggetto", () => {
    assert.deepEqual(parseBody({ body: undefined, isBase64Encoded: false }), {});
    assert.deepEqual(parseBody({ body: '{"a":1}', isBase64Encoded: false }), { a: 1 });
    assert.deepEqual(parseBody({ body: Buffer.from('{"a":2}').toString("base64"), isBase64Encoded: true }), { a: 2 });
    assert.throws(() => parseBody({ body: "{rotto", isBase64Encoded: false }), BadRequestError);
    assert.throws(() => parseBody({ body: "[1]", isBase64Encoded: false }), BadRequestError);
    assert.throws(() => parseBody({ body: "1", isBase64Encoded: false }), BadRequestError);
    assert.throws(() => parseBody({ body: JSON.stringify({ a: "x".repeat(200_000) }), isBase64Encoded: false }), BadRequestError);
  });
  it("parseId accetta solo cifre", () => {
    assert.equal(parseId("123"), "123");
    for (const bad of ["abc", "1; DROP TABLE x", "", "-1", "1.5", "9".repeat(30)]) assert.throws(() => parseId(bad));
  });
});

describe("validazione", () => {
  it("accumula gli errori e li lancia insieme (422)", () => {
    const f = new Fields({ title: 5, price: "10", extra: 1 });
    f.string("title", { required: true });
    f.money("price", { required: true });
    f.string("city", { required: true });
    assert.throws(() => f.done(), (e: Error) => e.message.includes("title") && e.message.includes("price") && e.message.includes("city"));
  });
  it("assente = undefined, null solo se ammesso, interi e importi", () => {
    const f = new Fields({ a: null, n: 2.5, m: 10.005, ok: 10.25 });
    assert.equal(f.string("zzz"), undefined);
    assert.equal(f.string("a", { nullable: true }), null);
    assert.equal(f.money("ok"), 10.25);
    f.integer("n");
    f.money("m");
    assert.throws(() => f.done(), (e: Error) => e.message.includes("n:") && e.message.includes("m:"));
  });
  it("oneOf", () => {
    assert.equal(new Fields({ t: "rent" }).oneOf("t", ["sale", "rent"] as const), "rent");
    const f = new Fields({ t: "boh" });
    f.oneOf("t", ["sale", "rent"] as const);
    assert.throws(() => f.done());
  });
});

describe("media, chiavi S3, eventi", () => {
  it("whitelist dei tipi: niente svg né pdf", () => {
    assert.equal(mediaType("image/jpeg")?.ext, "jpg");
    assert.equal(mediaType("video/mp4")?.maxBytes, 100 * 1024 * 1024);
    assert.equal(mediaType("image/svg+xml"), undefined);
    assert.equal(mediaType("constructor"), undefined);
  });
  it("chiave -> immobile e content-type", () => {
    assert.equal(propertyIdFromKey("uploads/42/abc.jpg"), "42");
    assert.equal(propertyIdFromKey("uploads/42/sotto/abc.jpg"), null);
    assert.equal(propertyIdFromKey("uploads/x/abc.jpg"), null);
    assert.equal(propertyIdFromKey("altro/42/abc.jpg"), null);
    assert.equal(contentTypeFromKey("uploads/1/a.MP4"), "video/mp4");
    assert.equal(contentTypeFromKey("uploads/1/a.exe"), null);
  });
  it("buildEvent: eventId UUID, occurredAt ISO, recipientSub, data", () => {
    const e = buildEvent("OFFER_CREATED", "sub-1", { offerId: "5" }, new Date("2026-10-22T10:15:00Z"));
    assert.match(e.eventId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(e.occurredAt, "2026-10-22T10:15:00.000Z");
    assert.deepEqual([e.type, e.recipientSub, e.data], ["OFFER_CREATED", "sub-1", { offerId: "5" }]);
    assert.equal("email" in e, false);
  });
});

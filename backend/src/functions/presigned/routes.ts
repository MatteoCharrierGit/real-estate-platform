import type { S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { requireActiveUser } from "../../shared/auth";
import type { Db } from "../../shared/db";
import { ConflictError, ForbiddenError, NotFoundError } from "../../shared/errors";
import { json, parseId, type Routes } from "../../shared/http";
import { buildKey, buildPostParams, EXPIRES_IN_SECONDS, parseUploadRequest } from "./upload";

interface Deps {
  db: Db;
  s3: S3Client;
  bucket: string;
}

export function createRoutes({ db, s3, bucket }: Deps): Routes {
  return {
    "POST /properties/{id}/uploads": async (ctx) => {
      const user = ctx.user();
      await requireActiveUser(db, user);
      const propertyId = parseId(ctx.param("id"), "immobile");
      const req = parseUploadRequest(ctx.body());

      // Ownership: il sub dei claim deve essere il proprietario, e l'immobile non ritirato.
      const { rows } = await db.query<{ owner_id: string; status: string }>(
        "SELECT owner_id, status FROM properties WHERE id = $1",
        [propertyId],
      );
      const p = rows[0];
      if (!p) throw new NotFoundError("immobile non trovato");
      if (p.owner_id !== user.sub) throw new ForbiddenError("non sei il proprietario");
      if (p.status !== "active") throw new ConflictError("immobile ritirato: non accetta upload");

      // La firma è un calcolo locale (nessuna chiamata di rete verso S3).
      const key = buildKey(propertyId, req.contentType);
      const { url, fields } = await createPresignedPost(s3, buildPostParams(bucket, key, req.contentType));
      return json(200, { url, fields, key, expiresIn: EXPIRES_IN_SECONDS });
    },
  };
}

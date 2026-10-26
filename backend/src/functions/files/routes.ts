import { DeleteObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { hasGroup, requireActiveUser } from "../../shared/auth";
import type { Db } from "../../shared/db";
import { ForbiddenError, NotFoundError } from "../../shared/errors";
import { json, noContent, parseId, type Routes } from "../../shared/http";
import { errorInfo, log } from "../../shared/log";

interface Deps {
  db: Db;
  s3: S3Client;
  bucket: string;
}

interface FileRow {
  id: string;
  property_id: string;
  object_key: string;
  content_type: string | null;
  size_bytes: string | null;
  created_at: Date;
}

const toFileItem = (r: FileRow) => ({
  id: r.id,
  propertyId: r.property_id,
  key: r.object_key,
  contentType: r.content_type,
  sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes),
  createdAt: r.created_at.toISOString(),
});

export function createRoutes({ db, s3, bucket }: Deps): Routes {
  return {
    // Pubblica: elenco dei file di un immobile (il browser li scarica da CloudFront).
    "GET /properties/{id}/files": async (ctx) => {
      const propertyId = parseId(ctx.param("id"), "immobile");
      const prop = await db.query("SELECT id FROM properties WHERE id = $1", [propertyId]);
      if (prop.rowCount === 0) throw new NotFoundError("immobile non trovato");
      const { rows } = await db.query<FileRow>(
        "SELECT id, property_id, object_key, content_type, size_bytes, created_at FROM files WHERE property_id = $1 ORDER BY id",
        [propertyId],
      );
      return json(200, { items: rows.map(toFileItem) });
    },

    "DELETE /files/{id}": async (ctx) => {
      const user = ctx.user();
      await requireActiveUser(db, user);
      const id = parseId(ctx.param("id"), "file");
      const found = await db.query<{ object_key: string; owner_id: string }>(
        "SELECT f.object_key, p.owner_id FROM files f JOIN properties p ON p.id = f.property_id WHERE f.id = $1",
        [id],
      );
      const file = found.rows[0];
      if (!file) throw new NotFoundError("file non trovato");
      if (file.owner_id !== user.sub && !hasGroup(user, "admin")) throw new ForbiddenError("non sei il proprietario");

      // Prima la riga, poi l'oggetto (come per gli immobili). Se S3 fallisce l'oggetto resta orfano: si logga e basta,
      // il prefisso verrà comunque svuotato se l'immobile sarà cancellato.
      await db.query("DELETE FROM files WHERE id = $1", [id]);
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: file.object_key }));
      } catch (err) {
        log("ERROR", "FILE_OBJECT_DELETE_FAILED", { fileId: id, ...errorInfo(err) });
      }
      return noContent();
    },
  };
}

import { DeleteObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import type { S3Event } from "aws-lambda";
import type { Db } from "../../shared/db";
import { errorInfo, log } from "../../shared/log";
import { contentTypeFromKey, propertyIdFromKey } from "../../shared/media";

/** Evento S3 (notifica ObjectCreated) oppure HTTP API payload 2.0: li distingue la forma dell'evento. */
export function isS3Event(event: unknown): event is S3Event {
  const records = (event as { Records?: unknown } | null)?.Records;
  return Array.isArray(records) && records.length > 0 && typeof (records[0] as { s3?: unknown } | undefined)?.s3 === "object";
}

export interface UploadedObject {
  bucket: string;
  key: string;
  size: number;
}

/**
 * Dalle notifiche S3 agli oggetti creati. La chiave arriva URL-codificata (spazi come "+", caratteri speciali come
 * %XX): va decodificata prima di usarla. Si prendono solo gli eventi ObjectCreated.
 */
export function objectsFromS3Event(event: S3Event): UploadedObject[] {
  return event.Records.filter((r) => r.eventName.startsWith("ObjectCreated")).map((r) => ({
    bucket: r.s3.bucket.name,
    key: decodeURIComponent(r.s3.object.key.replace(/\+/g, " ")),
    size: r.s3.object.size ?? 0,
  }));
}

/**
 * Registra un file caricato. Se l'immobile non esiste più (upload finito dopo la sua cancellazione) o è ritirato
 * (dopo la cancellazione dell'account del proprietario) non registra niente e cancella l'oggetto.
 * Idempotente: S3 può consegnare la notifica più volte (e la Lambda viene ritentata se fallisce).
 */
export async function registerObject(db: Db, s3: S3Client, obj: UploadedObject): Promise<"registered" | "duplicate" | "discarded" | "ignored"> {
  const propertyId = propertyIdFromKey(obj.key);
  if (!propertyId) {
    log("WARN", "FILE_KEY_IGNORED", { reason: "chiave fuori dallo schema uploads/<id>/<file>" });
    return "ignored"; // non è un nostro upload: non si registra e, per prudenza, non si cancella
  }
  const contentType = contentTypeFromKey(obj.key); // la notifica non porta il content-type: lo dice l'estensione
  const discard = async () => {
    await s3.send(new DeleteObjectCommand({ Bucket: obj.bucket, Key: obj.key }));
    log("INFO", "FILE_DISCARDED", { propertyId });
    return "discarded" as const;
  };

  try {
    // INSERT ... SELECT: inserisce solo se l'immobile esiste ed è attivo. ON CONFLICT: notifica già registrata.
    const ins = await db.query(
      `INSERT INTO files (property_id, object_key, content_type, size_bytes)
       SELECT p.id, $2, $3, $4 FROM properties p WHERE p.id = $1 AND p.status = 'active'
       ON CONFLICT (object_key) DO NOTHING
       RETURNING id`,
      [propertyId, obj.key, contentType, obj.size],
    );
    if (ins.rowCount && ins.rowCount > 0) return "registered";
  } catch (err) {
    // 23503: l'immobile è stato cancellato tra il SELECT e l'INSERT (chiave esterna).
    if ((err as { code?: string }).code === "23503") return discard();
    throw err;
  }

  // Nessuna riga inserita: immobile assente/ritirato oppure file già registrato. Si distingue.
  const prop = await db.query<{ status: string }>("SELECT status FROM properties WHERE id = $1", [propertyId]);
  if (prop.rows[0]?.status === "active") return "duplicate";
  return discard();
}

export async function registerAll(db: Db, s3: S3Client, bucket: string, event: S3Event): Promise<void> {
  let failed = 0;
  for (const obj of objectsFromS3Event(event)) {
    if (bucket && obj.bucket !== bucket) {
      log("WARN", "FILE_BUCKET_IGNORED", {});
      continue;
    }
    try {
      await registerObject(db, s3, obj);
    } catch (err) {
      failed++;
      log("ERROR", "FILE_REGISTER_FAILED", { key: obj.key, ...errorInfo(err) });
    }
  }
  // Invocazione asincrona: se lanciamo, Lambda ritenta (e la registrazione è idempotente).
  if (failed > 0) throw new Error(`${failed} oggetti non registrati`);
}

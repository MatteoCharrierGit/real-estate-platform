import { randomUUID } from "node:crypto";
import { ValidationError } from "../../shared/errors";
import { mediaType } from "../../shared/media";
import { Fields } from "../../shared/validation";

export const EXPIRES_IN_SECONDS = 300;

export interface UploadRequest {
  contentType: string;
  size: number;
}

/** Valida {contentType, size}: tipo in whitelist (altro -> 422) e dimensione entro il limite del tipo. */
export function parseUploadRequest(body: Record<string, unknown>): UploadRequest {
  const f = new Fields(body);
  const contentType = f.string("contentType", { required: true, max: 100 }) as string | undefined;
  const size = f.integer("size", { required: true, min: 1 }) as number | undefined;
  f.done();
  const media = mediaType(contentType!);
  if (!media) throw new ValidationError("contentType non ammesso: solo immagini e video supportati");
  if (size! > media.maxBytes) {
    throw new ValidationError(`file troppo grande: massimo ${media.maxBytes / (1024 * 1024)} MiB per ${media.kind === "image" ? "le immagini" : "i video"}`);
  }
  return { contentType: contentType!, size: size! };
}

/** La chiave la decide il server: uploads/<propertyId>/<uuid>.<ext>, con ext dalla whitelist (mai dal client). */
export function buildKey(propertyId: string, contentType: string, uuid: string = randomUUID()): string {
  const media = mediaType(contentType);
  if (!media) throw new ValidationError("contentType non ammesso");
  return `uploads/${propertyId}/${uuid}.${media.ext}`;
}

/**
 * Parametri per createPresignedPost (config/presigned-post-conditions.json, con limite 100 MiB per i video):
 *  - bucket e chiave esatti (la libreria aggiunge bucket e ["eq","$key",...] da sé);
 *  - Content-Type: prefisso image/ o video/ come nel file di configurazione; in più il campo `Content-Type`
 *    è già dentro `fields` col valore dichiarato (la libreria lo fissa con una condizione esatta), così il browser
 *    non può caricare un tipo diverso da quello su cui abbiamo deciso l'estensione;
 *  - content-length-range da 1 byte al massimo del tipo.
 */
export function buildPostParams(bucket: string, key: string, contentType: string) {
  const media = mediaType(contentType);
  if (!media) throw new ValidationError("contentType non ammesso");
  const conditions: (["starts-with", string, string] | ["content-length-range", number, number])[] = [
    ["starts-with", "$Content-Type", `${media.kind}/`],
    ["content-length-range", 1, media.maxBytes],
  ];
  return {
    Bucket: bucket,
    Key: key,
    Conditions: conditions,
    Fields: { "Content-Type": contentType },
    Expires: EXPIRES_IN_SECONDS,
  };
}

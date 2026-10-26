// Tipi di file ammessi per gli annunci. Whitelist unica per Presigned (firma l'upload, sceglie l'estensione)
// e Files (dalla chiave S3 risale al content-type, che la notifica S3 non contiene).
// Niente SVG: può contenere script e verrebbe servito dal nostro dominio.
export const MIB = 1024 * 1024;
export const IMAGE_MAX_BYTES = 10 * MIB;
export const VIDEO_MAX_BYTES = 100 * MIB;

export interface MediaType {
  ext: string;
  kind: "image" | "video";
  maxBytes: number;
}

export const MEDIA_TYPES: Readonly<Record<string, MediaType>> = {
  "image/jpeg": { ext: "jpg", kind: "image", maxBytes: IMAGE_MAX_BYTES },
  "image/png": { ext: "png", kind: "image", maxBytes: IMAGE_MAX_BYTES },
  "image/webp": { ext: "webp", kind: "image", maxBytes: IMAGE_MAX_BYTES },
  "image/gif": { ext: "gif", kind: "image", maxBytes: IMAGE_MAX_BYTES },
  "image/avif": { ext: "avif", kind: "image", maxBytes: IMAGE_MAX_BYTES },
  "video/mp4": { ext: "mp4", kind: "video", maxBytes: VIDEO_MAX_BYTES },
  "video/webm": { ext: "webm", kind: "video", maxBytes: VIDEO_MAX_BYTES },
  "video/quicktime": { ext: "mov", kind: "video", maxBytes: VIDEO_MAX_BYTES },
};

export function mediaType(contentType: string): MediaType | undefined {
  return Object.hasOwn(MEDIA_TYPES, contentType) ? MEDIA_TYPES[contentType] : undefined;
}

/** Content-type dall'estensione di una chiave (inverso di `ext`). */
export function contentTypeFromKey(key: string): string | null {
  const ext = key.split(".").pop()?.toLowerCase();
  const hit = Object.entries(MEDIA_TYPES).find(([, m]) => m.ext === ext);
  return hit ? hit[0] : null;
}

/** `uploads/<propertyId>/<uuid>.<ext>` -> propertyId, oppure null se la chiave non ha questa forma. */
export function propertyIdFromKey(key: string): string | null {
  const m = /^uploads\/([0-9]{1,18})\/[^/]+$/.exec(key);
  return m ? (m[1] ?? null) : null;
}

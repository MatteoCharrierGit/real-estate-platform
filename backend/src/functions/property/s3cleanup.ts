import { DeleteObjectsCommand, ListObjectsV2Command, type S3Client } from "@aws-sdk/client-s3";

/**
 * Svuota un prefisso (`uploads/<propertyId>/`): elenca (max 1000 chiavi per pagina) e cancella con DeleteObjects
 * (max 1000 per chiamata, quindi un blocco per pagina), finché il prefisso è vuoto. Elencare il prefisso, invece di
 * leggere le chiavi dal database, toglie anche i file caricati ma non ancora registrati.
 * Lancia se S3 segnala errori: il chiamante lo logga come FILES_CLEANUP_FAILED.
 */
export async function deleteAllUnderPrefix(s3: S3Client, bucket: string, prefix: string): Promise<number> {
  if (!prefix.endsWith("/")) throw new Error("il prefisso deve finire con /");
  let deleted = 0;
  for (let round = 0; round < 1000; round++) {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));
    const keys = (page.Contents ?? []).flatMap((o) => (o.Key ? [o.Key] : []));
    if (keys.length === 0) return deleted;
    const res = await s3.send(
      new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true } }),
    );
    // Senza questo controllo un errore parziale farebbe girare il ciclo all'infinito sulle stesse chiavi.
    if (res.Errors && res.Errors.length > 0) throw new Error(`DeleteObjects: ${res.Errors.length} errori (${res.Errors[0]?.Code})`);
    deleted += keys.length;
  }
  throw new Error("troppi cicli di cancellazione");
}

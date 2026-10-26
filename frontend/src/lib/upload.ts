// Upload su S3 con presigned POST. Regole: i campi `fields` ricevuti dall'API vanno inviati tutti, nell'ordine
// dato, e il campo `file` deve essere l'ULTIMO del FormData (S3 ignora cio' che segue il file).
import type { PresignedPost } from './types';

export function buildUploadForm(post: Pick<PresignedPost, 'fields'>, file: Blob, contentType: string): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(post.fields)) form.append(k, v);
  // La policy firma `starts-with $Content-Type`: il campo deve esserci nel form (se l'API non l'ha gia' incluso).
  if (!Object.keys(post.fields).some((k) => k.toLowerCase() === 'content-type')) {
    form.append('Content-Type', contentType);
  }
  form.append('file', file);
  return form;
}

/** POST verso il bucket con XMLHttpRequest (fetch non espone il progresso dell'upload). */
export function uploadToS3(
  post: PresignedPost,
  file: File,
  onProgress: (loaded: number, total: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', post.url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded, e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else if (xhr.status === 403) reject(new Error('Upload rifiutato (firma scaduta o file non conforme ai limiti).'));
      else reject(new Error(`Upload non riuscito (errore ${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error('Errore di rete durante il caricamento.'));
    xhr.onabort = () => reject(new Error('Caricamento annullato.'));
    xhr.send(buildUploadForm(post, file, file.type));
  });
}

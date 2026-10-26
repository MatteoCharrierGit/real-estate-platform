import { useRef, useState } from 'react';
import { api } from '../apiInstance';
import { fileUrl } from '../config';
import { uploadToS3 } from '../lib/upload';
import { errorMessage, useAsync } from '../lib/useAsync';
import { formatBytes, validateUploadFile } from '../lib/validation';
import { Alert, ConfirmDialog, ErrorBox, Spinner } from './ui';
import type { FileItem } from '../lib/types';

interface UploadJob {
  id: number;
  name: string;
  loaded: number;
  total: number;
  status: 'queued' | 'uploading' | 'registering' | 'done' | 'error';
  error?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let jobSeq = 0;

/**
 * Gestione dei file di un annuncio. Upload in 2 passi (s3.md, lambda-presigned.md):
 *  1) POST /properties/{id}/uploads {contentType, size} -> {url, fields, key}
 *  2) POST del FormData (fields + file ULTIMO) direttamente al bucket.
 * La riga in `files` la crea la Files Lambda dalla notifica S3 (asincrona): dopo l'upload si rilegge la lista
 * finche' la chiave nuova compare (qualche secondo al massimo).
 */
export function FilesManager({ propertyId }: { propertyId: string }) {
  const list = useAsync(() => api.listFiles(propertyId), [propertyId]);
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [toDelete, setToDelete] = useState<FileItem | null>(null);
  const [delBusy, setDelBusy] = useState(false);
  const [delError, setDelError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const busy = jobs.some((j) => j.status === 'queued' || j.status === 'uploading' || j.status === 'registering');

  const patch = (id: number, p: Partial<UploadJob>) => setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...p } : j)));

  async function waitForRegistration(key: string): Promise<boolean> {
    for (let i = 0; i < 10; i++) {
      await sleep(1500);
      try {
        const r = await api.listFiles(propertyId);
        if (r.items.some((f) => f.key === key)) return true;
      } catch {
        /* nuovo tentativo */
      }
    }
    return false;
  }

  async function onPick(files: FileList | null) {
    if (!files || files.length === 0) return;
    const picked = Array.from(files);
    if (input.current) input.current.value = '';
    const bad: string[] = [];
    const ok: File[] = [];
    for (const f of picked) {
      const err = validateUploadFile(f);
      if (err) bad.push(err);
      else ok.push(f);
    }
    setProblems(bad);
    const newJobs: UploadJob[] = ok.map((f) => ({ id: ++jobSeq, name: f.name, loaded: 0, total: f.size, status: 'queued' }));
    setJobs((js) => [...js.filter((j) => j.status !== 'done'), ...newJobs]);

    // Sequenziale: un file alla volta, la banda non viene divisa e i presigned (5 minuti) non scadono in coda.
    for (const [i, file] of ok.entries()) {
      const job = newJobs[i]!;
      try {
        patch(job.id, { status: 'uploading' });
        const post = await api.requestUpload(propertyId, { contentType: file.type, size: file.size });
        await uploadToS3(post, file, (loaded, total) => patch(job.id, { loaded, total }));
        patch(job.id, { status: 'registering', loaded: file.size });
        const registered = await waitForRegistration(post.key);
        patch(job.id, registered
          ? { status: 'done' }
          : { status: 'done', error: 'Caricato; la registrazione sta richiedendo piu\' del solito, ricarica l\'elenco tra poco.' });
        list.reload();
      } catch (e) {
        patch(job.id, { status: 'error', error: errorMessage(e) });
      }
    }
    list.reload();
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setDelBusy(true);
    setDelError(null);
    try {
      await api.deleteFile(toDelete.id);
      setToDelete(null);
      list.reload();
    } catch (e) {
      setDelError(errorMessage(e));
      setToDelete(null);
    } finally {
      setDelBusy(false);
    }
  }

  return (
    <section className="card pad stack" aria-labelledby="files-h">
      <h2 id="files-h" className="h3">Foto e video</h2>
      <p className="muted small">Immagini fino a 10 MiB, video fino a 100 MiB. La prima foto e' la copertina dell'annuncio.</p>

      <div>
        <input
          ref={input}
          id="file-input"
          className="visually-hidden"
          type="file"
          accept="image/*,video/*"
          multiple
          disabled={busy}
          onChange={(e) => void onPick(e.target.files)}
        />
        <label htmlFor="file-input" className={`btn btn-primary${busy ? ' is-disabled' : ''}`}>
          Carica file
        </label>
      </div>

      {problems.map((p) => <Alert key={p} kind="error">{p}</Alert>)}
      {delError && <Alert>{delError}</Alert>}

      {jobs.length > 0 && (
        <ul className="upload-list">
          {jobs.map((j) => (
            <li key={j.id}>
              <div className="upload-row">
                <span className="upload-name">{j.name}</span>
                <span className="muted small">
                  {j.status === 'queued' && 'In coda'}
                  {j.status === 'uploading' && `${Math.round((j.loaded / Math.max(j.total, 1)) * 100)}%`}
                  {j.status === 'registering' && 'Elaborazione...'}
                  {j.status === 'done' && (j.error ? 'Caricato' : 'Completato')}
                  {j.status === 'error' && 'Errore'}
                </span>
              </div>
              <progress className="progress" max={j.total} value={j.loaded} aria-label={`Avanzamento ${j.name}`} />
              {j.error && <small className={j.status === 'error' ? 'field-error' : 'muted'}>{j.error}</small>}
            </li>
          ))}
        </ul>
      )}

      {list.loading && !list.data && <Spinner />}
      {list.error && <ErrorBox error={list.error} onRetry={list.reload} />}
      {list.data && list.data.items.length === 0 && <p className="muted">Nessun file caricato.</p>}
      {list.data && list.data.items.length > 0 && (
        <ul className="file-grid">
          {list.data.items.map((f) => (
            <li key={f.id} className="file-item">
              <div className="file-thumb">
                {f.contentType.startsWith('video/') ? (
                  <video src={fileUrl(f.key)} preload="metadata" muted />
                ) : (
                  <img src={fileUrl(f.key)} alt="" loading="lazy" />
                )}
              </div>
              <div className="file-meta">
                <span className="small muted">{formatBytes(f.sizeBytes)}</span>
                <button className="btn btn-sm btn-danger-ghost" onClick={() => setToDelete(f)}>Elimina</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog open={!!toDelete} title="Eliminare il file?" confirmLabel="Elimina" danger busy={delBusy}
        onConfirm={() => void confirmDelete()} onCancel={() => setToDelete(null)}>
        <p>Il file verra' rimosso dall'annuncio.</p>
      </ConfirmDialog>
    </section>
  );
}

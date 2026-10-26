import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../apiInstance';
import { useSession } from '../auth/session';
import { FilesManager } from '../components/FilesManager';
import { Alert, BackLink, ConfirmDialog, ErrorBox, Field, PageHeader, Spinner } from '../components/ui';
import { ApiError } from '../lib/api';
import { errorMessage, useAsync } from '../lib/useAsync';
import {
  emptyPropertyForm, propertyFromForm, validateProperty, type PropertyForm,
} from '../lib/validation';
import type { Property } from '../lib/types';

const toForm = (p: Property): PropertyForm => ({
  title: p.title, description: p.description ?? '', price: String(p.price), city: p.city, address: p.address ?? '',
  listingType: p.listingType, rooms: String(p.rooms), bathrooms: String(p.bathrooms), areaSqm: String(p.areaSqm),
});

export default function PropertyEdit() {
  const { id } = useParams();
  const editing = !!id;
  const nav = useNavigate();
  const loc = useLocation();
  const s = useSession();
  const [form, setForm] = useState<PropertyForm>(emptyPropertyForm);
  const [errs, setErrs] = useState<ReturnType<typeof validateProperty>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(
    (loc.state as { created?: boolean } | null)?.created
      ? { kind: 'success', text: 'Annuncio creato. Ora puoi aggiungere foto e video.' } : null,
  );
  const [confirmDel, setConfirmDel] = useState(false);

  const loaded = useAsync(async () => (id ? api.getProperty(id) : null), [id]);
  useEffect(() => {
    if (loaded.data) setForm(toForm(loaded.data.property));
  }, [loaded.data]);

  const set = (k: keyof PropertyForm) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  if (editing) {
    if (loaded.loading && !loaded.data) return <Spinner />;
    if (loaded.error) {
      return loaded.error instanceof ApiError && loaded.error.status === 404
        ? <Alert>Annuncio non trovato (potrebbe essere stato ritirato).</Alert>
        : <ErrorBox error={loaded.error} onRetry={loaded.reload} />;
    }
    const p = loaded.data?.property;
    if (p && p.ownerId !== s.user?.sub && !s.user?.groups.includes('admin')) {
      return <Alert>Puoi modificare solo i tuoi annunci.</Alert>;
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const v = validateProperty(form);
    setErrs(v);
    setMsg(null);
    if (Object.keys(v).length) return;
    setBusy(true);
    try {
      const input = propertyFromForm(form);
      if (id) {
        await api.updateProperty(id, input);
        setMsg({ kind: 'success', text: 'Modifiche salvate.' });
      } else {
        const created = await api.createProperty(input);
        nav(`/agent/properties/${created.id}/edit`, { replace: true, state: { created: true } });
      }
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof ApiError && err.status === 409
        ? 'L\'annuncio e\' stato ritirato e non si puo\' piu\' modificare.' : errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!id) return;
    setBusy(true);
    try {
      await api.deleteProperty(id);
      nav('/agent/properties', { replace: true });
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
      setConfirmDel(false);
      setBusy(false);
    }
  }

  const f = (k: keyof PropertyForm, label: string, extra: Record<string, unknown> = {}, hint?: string) => (
    <Field label={label} htmlFor={`p-${k}`} error={errs[k]} hint={hint}>
      <input id={`p-${k}`} value={form[k]} onChange={set(k)} aria-invalid={!!errs[k]} aria-describedby={errs[k] ? `p-${k}-err` : undefined} {...extra} />
    </Field>
  );

  return (
    <>
      <BackLink to="/agent/properties">I miei annunci</BackLink>
      <PageHeader
        title={editing ? 'Modifica annuncio' : 'Nuovo annuncio'}
        actions={editing && loaded.data ? <Link className="btn" to={`/properties/${id}`}>Vedi pubblicazione</Link> : undefined}
      />
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <div className="edit-layout">
        <form className="card pad stack" onSubmit={submit} noValidate>
          {f('title', 'Titolo', { maxLength: 200 })}
          <Field label="Descrizione" htmlFor="p-description" error={errs.description}>
            <textarea id="p-description" rows={5} value={form.description} onChange={set('description')} />
          </Field>
          <div className="form-grid">
            <Field label="Tipo" htmlFor="p-listingType" error={errs.listingType}>
              <select id="p-listingType" value={form.listingType} onChange={set('listingType')}>
                <option value="sale">Vendita</option>
                <option value="rent">Affitto</option>
              </select>
            </Field>
            {f('price', form.listingType === 'rent' ? 'Canone mensile (EUR)' : 'Prezzo (EUR)', { type: 'text', inputMode: 'decimal' })}
            {f('city', 'Citta\'')}
            {f('address', 'Indirizzo')}
            {f('rooms', 'Locali', { inputMode: 'numeric' })}
            {f('bathrooms', 'Bagni', { inputMode: 'numeric' })}
            {f('areaSqm', 'Superficie (m2)', { inputMode: 'numeric' })}
          </div>
          <div className="row">
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Salvataggio...' : editing ? 'Salva modifiche' : 'Crea annuncio'}</button>
            {editing && <button type="button" className="btn btn-danger-ghost" onClick={() => setConfirmDel(true)} disabled={busy}>Elimina annuncio</button>}
          </div>
        </form>
        {editing && id ? (
          <FilesManager propertyId={id} />
        ) : (
          <div className="card pad muted">Potrai caricare foto e video dopo aver creato l'annuncio.</div>
        )}
      </div>
      <ConfirmDialog open={confirmDel} title="Eliminare l'annuncio?" confirmLabel="Elimina definitivamente" danger busy={busy}
        onConfirm={() => void remove()} onCancel={() => setConfirmDel(false)}>
        <p>L'annuncio, i suoi file e le offerte collegate verranno rimossi. L'operazione non si puo' annullare.</p>
      </ConfirmDialog>
    </>
  );
}

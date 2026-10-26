import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../apiInstance';
import { startLogin } from '../auth/oauth';
import { useSession } from '../auth/session';
import { Gallery } from '../components/Gallery';
import { Alert, BackLink, EmptyState, ErrorBox, Field, Spinner } from '../components/ui';
import { ApiError } from '../lib/api';
import { formatDate, formatPrice, listingLabel } from '../lib/format';
import { errorMessage, useAsync } from '../lib/useAsync';
import { validateOffer } from '../lib/validation';

export default function PropertyDetail() {
  const { id = '' } = useParams();
  const s = useSession();
  const detail = useAsync(() => api.getProperty(id), [id]);
  const files = useAsync(() => api.listFiles(id), [id]);

  if (detail.loading && !detail.data) return <Spinner />;
  if (detail.error) {
    if (detail.error instanceof ApiError && detail.error.status === 404) {
      return <EmptyState title="Annuncio non trovato" action={<Link className="btn" to="/">Torna agli annunci</Link>}>L'annuncio non esiste o e' stato ritirato.</EmptyState>;
    }
    return <ErrorBox error={detail.error} onRetry={detail.reload} />;
  }
  const { property: p, agent } = detail.data!;
  const isBuyer = !!s.user?.groups.includes('buyer');
  const isOwner = !!s.user && p.ownerId === s.user.sub;

  return (
    <>
      <BackLink to="/">Tutti gli annunci</BackLink>
      {p.status === 'withdrawn' && <Alert kind="warning">Questo annuncio e' stato ritirato.</Alert>}
      <div className="detail">
        <section className="detail-main">
          {files.error ? <Alert>Impossibile caricare le foto: {errorMessage(files.error)}</Alert>
            : <Gallery files={files.data?.items ?? []} title={p.title} />}
          <h1>{p.title}</h1>
          <p className="muted">{p.city}{p.address ? `, ${p.address}` : ''} - pubblicato il {formatDate(p.createdAt)}</p>
          <ul className="facts facts-lg">
            <li><strong>{p.rooms}</strong> locali</li>
            <li><strong>{p.bathrooms}</strong> bagni</li>
            <li><strong>{p.areaSqm}</strong> m&sup2;</li>
          </ul>
          <h2>Descrizione</h2>
          <p className="prewrap">{p.description || 'Nessuna descrizione.'}</p>
        </section>

        <aside className="detail-side">
          <div className="card pad stack">
            <span className={`badge badge-${p.listingType} badge-inline`}>{listingLabel(p.listingType)}</span>
            <p className="price price-lg">{formatPrice(p)}</p>
            {isOwner && <Link className="btn btn-block" to={`/agent/properties/${p.id}/edit`}>Modifica annuncio</Link>}
            {p.status === 'active' && <OfferBox propertyId={p.id} canOffer={isBuyer && !isOwner} />}
            {s.status === 'anonymous' && p.status === 'active' && (
              <button className="btn btn-primary btn-block" onClick={() => void startLogin({ returnTo: `/properties/${p.id}` })}>
                Accedi per fare un'offerta
              </button>
            )}
          </div>
          <div className="card pad stack">
            <h2 className="h3">Agente</h2>
            {agent ? (
              <>
                <p><strong>{agent.displayName || 'Agente'}</strong></p>
                {agent.bio && <p className="muted prewrap">{agent.bio}</p>}
              </>
            ) : (
              <p className="muted">Informazioni non disponibili.</p>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}

function OfferBox({ propertyId, canOffer }: { propertyId: string; canOffer: boolean }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const [errs, setErrs] = useState<ReturnType<typeof validateOffer>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  if (!canOffer) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const v = validateOffer(amount, message);
    setErrs(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    setResult(null);
    try {
      await api.createOffer(propertyId, { amount: Number(amount.replace(',', '.')), message: message.trim() || undefined });
      setResult({ kind: 'success', text: 'Offerta inviata! La trovi nella sezione "Offerte".' });
      setOpen(false);
      setAmount('');
      setMessage('');
    } catch (err) {
      setResult({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {result && <Alert kind={result.kind}>{result.text}</Alert>}
      {!open ? (
        <button className="btn btn-primary btn-block" onClick={() => setOpen(true)}>Fai un'offerta</button>
      ) : (
        <form className="stack" onSubmit={submit} noValidate>
          <Field label="Importo offerto (EUR)" htmlFor="o-amount" error={errs.amount}>
            <input id="o-amount" type="number" min="1" step="any" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-describedby="o-amount-err" />
          </Field>
          <Field label="Messaggio (facoltativo)" htmlFor="o-msg" error={errs.message}>
            <textarea id="o-msg" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
          </Field>
          <div className="row">
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Invio...' : 'Invia offerta'}</button>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} disabled={busy}>Annulla</button>
          </div>
        </form>
      )}
    </>
  );
}

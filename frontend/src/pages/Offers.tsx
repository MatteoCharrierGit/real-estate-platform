import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../apiInstance';
import { Alert, ConfirmDialog, EmptyState, ErrorBox, PageHeader, Spinner } from '../components/ui';
import { formatDate, formatEuro, offerKey, offerStatusLabel } from '../lib/format';
import { errorMessage, useAsync } from '../lib/useAsync';
import type { Offer } from '../lib/types';

type Action = { offer: Offer; kind: 'withdraw' | 'accepted' | 'rejected' };

export default function Offers() {
  const { data, error, loading, reload } = useAsync(() => api.listOffers(), []);
  const [pending, setPending] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    if (!pending) return;
    setBusy(true);
    setErr(null);
    try {
      if (pending.kind === 'withdraw') await api.withdrawOffer(pending.offer.id);
      else await api.decideOffer(pending.offer.id, pending.kind);
      reload();
    } catch (e) {
      setErr(errorMessage(e));
      reload(); // es. 409: lo stato e' cambiato nel frattempo
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  const mine = data?.items.filter((o) => o.role === 'buyer') ?? [];
  const received = data?.items.filter((o) => o.role === 'owner') ?? [];
  const label = pending?.kind === 'withdraw' ? 'Ritira offerta' : pending?.kind === 'accepted' ? 'Accetta offerta' : 'Rifiuta offerta';

  return (
    <>
      <PageHeader title="Offerte" subtitle="Le offerte che hai fatto e quelle ricevute sui tuoi annunci." />
      {err && <Alert>{err}</Alert>}
      {loading && !data && <Spinner />}
      {error && <ErrorBox error={error} onRetry={reload} />}
      {data && data.items.length === 0 && (
        <EmptyState title="Nessuna offerta" action={<Link className="btn btn-primary" to="/">Sfoglia gli annunci</Link>}>
          Quando farai o riceverai un'offerta la vedrai qui.
        </EmptyState>
      )}
      {mine.length > 0 && (
        <OfferSection title="Le mie offerte" offers={mine}
          actions={(o) => o.status === 'pending' && (
            <button className="btn btn-sm btn-danger-ghost" onClick={() => setPending({ offer: o, kind: 'withdraw' })}>Ritira</button>
          )} />
      )}
      {received.length > 0 && (
        <OfferSection title="Offerte ricevute" offers={received}
          actions={(o) => o.status === 'pending' && (
            <>
              <button className="btn btn-sm btn-primary" onClick={() => setPending({ offer: o, kind: 'accepted' })}>Accetta</button>
              <button className="btn btn-sm" onClick={() => setPending({ offer: o, kind: 'rejected' })}>Rifiuta</button>
            </>
          )} />
      )}
      <ConfirmDialog open={!!pending} title={label} confirmLabel={label} danger={pending?.kind !== 'accepted'} busy={busy}
        onConfirm={() => void run()} onCancel={() => setPending(null)}>
        <p>
          Offerta di {pending ? formatEuro(pending.offer.amount) : ''} per "{pending?.offer.propertyTitle}". L'altra parte ricevera' una notifica.
        </p>
      </ConfirmDialog>
    </>
  );
}

function OfferSection({ title, offers, actions }: {
  title: string; offers: Offer[]; actions: (o: Offer) => React.ReactNode;
}) {
  return (
    <section className="stack">
      <h2>{title}</h2>
      <ul className="offer-list">
        {offers.map((o) => (
          <li key={offerKey(o)} className="card offer">
            <div className="offer-main">
              <Link to={`/properties/${o.propertyId}`} className="offer-title">{o.propertyTitle}</Link>
              <p className="price">{formatEuro(o.amount)}</p>
              {o.message && <p className="muted prewrap">{o.message}</p>}
              <p className="muted small">Inviata il {formatDate(o.createdAt)}</p>
            </div>
            <div className="offer-side">
              <span className={`status status-${o.status}`}>{offerStatusLabel[o.status]}</span>
              <div className="row">{actions(o)}</div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

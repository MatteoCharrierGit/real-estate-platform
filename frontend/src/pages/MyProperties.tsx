import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../apiInstance';
import { useSession } from '../auth/session';
import { CardSkeletons, PropertyCard } from '../components/PropertyCard';
import { Alert, ConfirmDialog, EmptyState, ErrorBox, PageHeader } from '../components/ui';
import { errorMessage, useAsync } from '../lib/useAsync';
import type { Property } from '../lib/types';

const PAGE = 50; // massimo consentito da GET /properties
const MAX_PAGES = 20; // tetto di sicurezza: al massimo 1000 annunci scansionati

/**
 * LIMITE NOTO: il contratto non ha un filtro "miei" su GET /properties. Si scorre quindi la lista pubblica
 * (solo annunci `active`) a pagine da 50 e si tengono quelli con ownerId === sub. Con molti annunci sono molte
 * richieste, e gli annunci ritirati non compaiono. Soluzione vera: un parametro `ownerId=me` lato backend.
 */
async function loadMine(sub: string): Promise<{ mine: Property[]; truncated: boolean }> {
  const mine: Property[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { items, total } = await api.listProperties({ limit: PAGE, offset: page * PAGE });
    mine.push(...items.filter((p) => p.ownerId === sub));
    if ((page + 1) * PAGE >= total) return { mine, truncated: false };
  }
  return { mine, truncated: true };
}

export default function MyProperties() {
  const s = useSession();
  const sub = s.user?.sub ?? '';
  const { data, error, loading, reload } = useAsync(() => loadMine(sub), [sub]);
  const [toDelete, setToDelete] = useState<Property | null>(null);
  const [busy, setBusy] = useState(false);
  const [delError, setDelError] = useState<string | null>(null);

  async function confirmDelete() {
    if (!toDelete) return;
    setBusy(true);
    setDelError(null);
    try {
      await api.deleteProperty(toDelete.id);
      setToDelete(null);
      reload();
    } catch (e) {
      setDelError(errorMessage(e));
      setToDelete(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="I miei annunci"
        subtitle="Annunci pubblicati da te."
        actions={<Link className="btn btn-primary" to="/agent/properties/new">Nuovo annuncio</Link>}
      />
      {delError && <Alert>{delError}</Alert>}
      {loading && !data && <CardSkeletons n={3} />}
      {error && <ErrorBox error={error} onRetry={reload} />}
      {data && (
        <>
          {data.truncated && <Alert kind="warning">Elenco parziale: sono stati scansionati i primi {MAX_PAGES * PAGE} annunci.</Alert>}
          {data.mine.length === 0 ? (
            <EmptyState title="Non hai ancora annunci" action={<Link className="btn btn-primary" to="/agent/properties/new">Crea il primo annuncio</Link>}>
              Pubblica un immobile per iniziare a ricevere offerte.
            </EmptyState>
          ) : (
            <div className="grid">
              {data.mine.map((p) => (
                <PropertyCard
                  key={p.id}
                  p={p}
                  footer={
                    <div className="row card-actions">
                      <Link className="btn btn-sm" to={`/agent/properties/${p.id}/edit`}>Modifica</Link>
                      <button className="btn btn-sm btn-danger-ghost" onClick={() => setToDelete(p)}>Elimina</button>
                    </div>
                  }
                />
              ))}
            </div>
          )}
          <p className="muted small note">
            Nota: l'API non ha un filtro "miei annunci"; l'elenco si ricava dalla lista pubblica confrontando il proprietario con il tuo
            identificativo. Gli annunci ritirati non compaiono.
          </p>
        </>
      )}
      <ConfirmDialog
        open={!!toDelete}
        title="Eliminare l'annuncio?"
        confirmLabel="Elimina"
        danger
        busy={busy}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setToDelete(null)}
      >
        <p>L'annuncio "{toDelete?.title}" e le sue offerte verranno rimossi. L'operazione non si puo' annullare.</p>
      </ConfirmDialog>
    </>
  );
}

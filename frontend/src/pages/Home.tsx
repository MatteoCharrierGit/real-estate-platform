import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../apiInstance';
import { CardSkeletons, PropertyCard } from '../components/PropertyCard';
import { EmptyState, ErrorBox, Field, PageHeader, Pagination } from '../components/ui';
import { useAsync } from '../lib/useAsync';
import type { PropertyFilters } from '../lib/types';

const LIMIT = 12;
const num = (v: string | null) => (v && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : undefined);

export default function Home() {
  const [params, setParams] = useSearchParams();
  const filters: PropertyFilters = {
    city: params.get('city') || undefined,
    listingType: params.get('listingType') === 'sale' || params.get('listingType') === 'rent'
      ? (params.get('listingType') as 'sale' | 'rent') : undefined,
    minPrice: num(params.get('minPrice')),
    maxPrice: num(params.get('maxPrice')),
    rooms: num(params.get('rooms')),
    limit: LIMIT,
    offset: num(params.get('offset')) ?? 0,
  };
  const key = params.toString();
  const { data, error, loading, reload } = useAsync(() => api.listProperties(filters), [key]);

  // Il form e' "non controllato" dai parametri: si sincronizza solo quando cambia l'URL (es. "Azzera").
  const [form, setForm] = useState({
    city: params.get('city') ?? '', listingType: params.get('listingType') ?? '',
    minPrice: params.get('minPrice') ?? '', maxPrice: params.get('maxPrice') ?? '', rooms: params.get('rooms') ?? '',
  });
  useEffect(() => {
    setForm({
      city: params.get('city') ?? '', listingType: params.get('listingType') ?? '',
      minPrice: params.get('minPrice') ?? '', maxPrice: params.get('maxPrice') ?? '', rooms: params.get('rooms') ?? '',
    });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function apply(e: FormEvent) {
    e.preventDefault();
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(form)) if (v.trim()) next.set(k, v.trim());
    setParams(next);
  }

  const hasFilters = [...params.keys()].some((k) => k !== 'offset');

  return (
    <>
      <PageHeader title="Trova la tua casa" subtitle="Annunci di vendita e affitto, pubblicati direttamente dagli agenti." />
      <form className="filters card" onSubmit={apply} role="search" aria-label="Filtri annunci">
        <Field label="Citta'" htmlFor="f-city">
          <input id="f-city" value={form.city} onChange={set('city')} placeholder="Es. Milano" />
        </Field>
        <Field label="Tipo" htmlFor="f-type">
          <select id="f-type" value={form.listingType} onChange={set('listingType')}>
            <option value="">Tutti</option>
            <option value="sale">Vendita</option>
            <option value="rent">Affitto</option>
          </select>
        </Field>
        <Field label="Prezzo min (EUR)" htmlFor="f-min">
          <input id="f-min" type="number" min="0" inputMode="numeric" value={form.minPrice} onChange={set('minPrice')} />
        </Field>
        <Field label="Prezzo max (EUR)" htmlFor="f-max">
          <input id="f-max" type="number" min="0" inputMode="numeric" value={form.maxPrice} onChange={set('maxPrice')} />
        </Field>
        <Field label="Locali (min)" htmlFor="f-rooms">
          <input id="f-rooms" type="number" min="0" inputMode="numeric" value={form.rooms} onChange={set('rooms')} />
        </Field>
        <div className="filters-actions">
          <button className="btn btn-primary" type="submit">Cerca</button>
          {hasFilters && <button className="btn btn-ghost" type="button" onClick={() => setParams(new URLSearchParams())}>Azzera</button>}
        </div>
      </form>

      {loading && !data && <CardSkeletons />}
      {error && <ErrorBox error={error} onRetry={reload} />}
      {data && (
        <>
          <p className="muted result-count" aria-live="polite">
            {data.total === 0 ? 'Nessun risultato' : `${data.total} ${data.total === 1 ? 'annuncio' : 'annunci'}`}
          </p>
          {data.items.length === 0 ? (
            <EmptyState title="Nessun annuncio trovato">
              {hasFilters ? 'Prova a cambiare o azzerare i filtri.' : 'Non ci sono ancora annunci pubblicati.'}
            </EmptyState>
          ) : (
            <div className={`grid${loading ? ' is-loading' : ''}`}>
              {data.items.map((p) => <PropertyCard key={p.id} p={p} />)}
            </div>
          )}
          <Pagination
            total={data.total}
            limit={LIMIT}
            offset={filters.offset ?? 0}
            onChange={(offset) => {
              const next = new URLSearchParams(params);
              if (offset > 0) next.set('offset', String(offset)); else next.delete('offset');
              setParams(next);
              window.scrollTo({ top: 0 });
            }}
          />
        </>
      )}
    </>
  );
}

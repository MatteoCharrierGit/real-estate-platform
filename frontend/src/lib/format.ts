import type { Offer, OfferStatus, Property } from './types';

// Raggruppamento migliaia manuale: it-IT di default non raggruppa i numeri a 4 cifre (1200 invece di 1.200).
export const formatEuro = (n: number) =>
  `${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')} \u20ac`;

export const formatPrice = (p: Pick<Property, 'price' | 'listingType'>) =>
  p.listingType === 'rent' ? `${formatEuro(p.price)}/mese` : formatEuro(p.price);

export const listingLabel = (t: Property['listingType']) => (t === 'rent' ? 'Affitto' : 'Vendita');

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
}

export const offerStatusLabel: Record<OfferStatus, string> = {
  pending: 'In attesa', accepted: 'Accettata', rejected: 'Rifiutata', withdrawn: 'Ritirata',
};

export const offerKey = (o: Offer) => `${o.id}:${o.role}`;

import { Link } from 'react-router-dom';
import { fileUrl } from '../config';
import { formatPrice, listingLabel } from '../lib/format';
import type { Property } from '../lib/types';
import { HouseIcon } from './ui';

export function PropertyCard({ p, to, footer }: { p: Property; to?: string; footer?: React.ReactNode }) {
  return (
    <article className="card property-card">
      <Link to={to ?? `/properties/${p.id}`} className="card-media" aria-label={`Apri ${p.title}`}>
        {p.coverKey ? (
          <img src={fileUrl(p.coverKey)} alt="" loading="lazy" />
        ) : (
          <span className="card-placeholder"><HouseIcon /></span>
        )}
        <span className={`badge badge-${p.listingType}`}>{listingLabel(p.listingType)}</span>
      </Link>
      <div className="card-body">
        <p className="price">{formatPrice(p)}</p>
        <h3 className="card-title">
          <Link to={to ?? `/properties/${p.id}`}>{p.title}</Link>
        </h3>
        <p className="muted">{p.city}{p.address ? `, ${p.address}` : ''}</p>
        <ul className="facts">
          <li>{p.rooms} locali</li>
          <li>{p.bathrooms} bagni</li>
          <li>{p.areaSqm} m&sup2;</li>
        </ul>
        {footer}
      </div>
    </article>
  );
}

export function CardSkeletons({ n = 6 }: { n?: number }) {
  return (
    <div className="grid" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="card skeleton-card">
          <div className="skeleton skeleton-media" />
          <div className="card-body">
            <div className="skeleton skeleton-line w-40" />
            <div className="skeleton skeleton-line w-80" />
            <div className="skeleton skeleton-line w-60" />
          </div>
        </div>
      ))}
    </div>
  );
}

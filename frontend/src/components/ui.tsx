import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '../lib/useAsync';

export function Spinner({ label = 'Caricamento...' }: { label?: string }) {
  return (
    <div className="spinner-wrap" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function Alert({ kind = 'error', children }: { kind?: 'error' | 'success' | 'info' | 'warning'; children: ReactNode }) {
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="state-box" role="alert">
      <h2>Qualcosa e' andato storto</h2>
      <p>{errorMessage(error)}</p>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          Riprova
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="state-box">
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Field({ label, error, hint, children, htmlFor }: {
  label: string; error?: string; hint?: string; children: ReactNode; htmlFor: string;
}) {
  return (
    <div className={`field${error ? ' has-error' : ''}`}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && !error && <small className="muted">{hint}</small>}
      {error && (
        <small className="field-error" id={`${htmlFor}-err`}>
          {error}
        </small>
      )}
    </div>
  );
}

/** Dialog di conferma basato sul <dialog> nativo (focus trap e Esc gratis, nessuno stile inline). */
export function ConfirmDialog({ open, title, children, confirmLabel, danger, busy, onConfirm, onCancel }: {
  open: boolean; title: string; children: ReactNode; confirmLabel: string; danger?: boolean; busy?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="dialog" onCancel={(e) => { e.preventDefault(); if (!busy) onCancel(); }}>
      <h2>{title}</h2>
      <div className="dialog-body">{children}</div>
      <div className="dialog-actions">
        <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          Annulla
        </button>
        <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy}>
          {busy ? 'Attendere...' : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

export function Pagination({ total, limit, offset, onChange }: {
  total: number; limit: number; offset: number; onChange: (offset: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const page = Math.floor(offset / limit) + 1;
  if (pages <= 1) return null;
  return (
    <nav className="pagination" aria-label="Paginazione">
      <button className="btn" disabled={page <= 1} onClick={() => onChange(Math.max(0, offset - limit))}>
        Precedente
      </button>
      <span aria-live="polite">
        Pagina {page} di {pages}
      </span>
      <button className="btn" disabled={page >= pages} onClick={() => onChange(offset + limit)}>
        Successiva
      </button>
    </nav>
  );
}

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="back-link">
      &larr; {children}
    </Link>
  );
}

export function HouseIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="48" height="48" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M12 3 2 12h3v8h5v-5h4v5h5v-8h3z" />
    </svg>
  );
}

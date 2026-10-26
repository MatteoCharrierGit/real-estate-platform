// Guardie di rotta: SOLO UX (nascondono pagine inutili). La sicurezza vera sta nel backend (authorizer JWT, gruppi, ownership).
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Alert, EmptyState, Spinner } from '../components/ui';
import { startLogin } from './oauth';
import { useSession } from './session';
import type { Role } from '../lib/jwt';
import { Link } from 'react-router-dom';

export function RequireAuth({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const s = useSession();
  const loc = useLocation();
  if (s.status === 'loading') return <Spinner label="Accesso in corso..." />;
  if (s.status === 'anonymous' || !s.user) {
    return (
      <EmptyState
        title="Accedi per continuare"
        action={
          <button className="btn btn-primary" onClick={() => void startLogin({ returnTo: loc.pathname + loc.search })}>
            Accedi
          </button>
        }
      >
        Questa pagina e' riservata agli utenti registrati.
      </EmptyState>
    );
  }
  if (roles && !s.user.groups.some((g) => roles.includes(g))) {
    if (s.user.groups.length === 0) return <PendingRole />;
    return (
      <EmptyState title="Pagina non disponibile per il tuo ruolo" action={<Link className="btn" to="/">Torna agli annunci</Link>}>
        Serve il ruolo {roles.join(' o ')}.
      </EmptyState>
    );
  }
  return <>{children}</>;
}

export function PendingRole() {
  return (
    <Alert kind="warning">
      <strong>Account in attesa di un ruolo.</strong> L'amministratore deve ancora assegnarti il ruolo di acquirente o
      agente. Dopo l'assegnazione esci e accedi di nuovo per vedere le nuove funzioni.
    </Alert>
  );
}

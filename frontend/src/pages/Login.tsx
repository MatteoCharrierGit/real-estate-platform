import { useLocation, Navigate } from 'react-router-dom';
import { startLogin } from '../auth/oauth';
import { useSession } from '../auth/session';
import { PageHeader, Spinner } from '../components/ui';

export default function Login() {
  const s = useSession();
  const loc = useLocation();
  const from = (loc.state as { from?: string } | null)?.from ?? '/';
  if (s.status === 'loading') return <Spinner label="Accesso in corso..." />;
  if (s.status === 'authenticated') return <Navigate to={from} replace />;
  return (
    <div className="narrow">
      <PageHeader title="Accedi o registrati" subtitle="L'accesso e' gestito da Amazon Cognito: la password non passa mai da questo sito." />
      <div className="card pad stack">
        <button className="btn btn-primary btn-block" onClick={() => void startLogin({ returnTo: from })}>
          Accedi
        </button>
        <button className="btn btn-block" onClick={() => void startLogin({ signup: true, returnTo: from })}>
          Crea un account
        </button>
        <p className="muted small">
          Dopo la registrazione riceverai un codice via email. Un amministratore ti assegnera' il ruolo di acquirente o
          agente: fino ad allora potrai solo consultare gli annunci.
        </p>
      </div>
    </div>
  );
}

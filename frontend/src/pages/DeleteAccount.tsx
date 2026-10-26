import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../apiInstance';
import { getAccessToken, logout } from '../auth/oauth';
import { setNotice, useSession } from '../auth/session';
import { Alert, PageHeader } from '../components/ui';
import { deleteCognitoUser } from '../lib/cognito';
import { errorMessage } from '../lib/useAsync';

type Step = 'idle' | 'db' | 'cognito' | 'logout';

/**
 * Cancellazione account (cognito.md): 1) nuovo login con prompt=login (fatto prima di arrivare qui),
 * 2) DELETE /users/me (anonimizza il database), 3) DeleteUser su Cognito con l'access token,
 * 4) logout. Se il passo 3 fallisce l'utente rientra: al login PUT /users/me risponde 410 e la SPA completa da sola.
 */
export default function DeleteAccount() {
  const s = useSession();
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);

  if (!s.reauthForDelete) {
    return (
      <>
        <PageHeader title="Elimina account" />
        <Alert kind="info">Per eliminare l'account serve un accesso recente. Torna al profilo e riavvia la procedura.</Alert>
        <Link className="btn" to="/profile">Vai al profilo</Link>
      </>
    );
  }

  async function run() {
    setError(null);
    let at: Step = 'db';
    try {
      setStep('db');
      await api.deleteMe();
      at = 'cognito';
      setStep('cognito');
      const t = await getAccessToken();
      if (!t) throw new Error('Sessione scaduta: accedi di nuovo per completare la cancellazione.');
      await deleteCognitoUser(t);
      setNotice('Il tuo account e\' stato eliminato.');
      at = 'logout';
      setStep('logout');
      await logout();
    } catch (e) {
      setError(errorMessage(e) + (at !== 'db'
        ? ' I tuoi dati sono gia\' stati anonimizzati: accedi di nuovo e la cancellazione si completera\' da sola.' : ''));
      setStep('idle');
    }
  }

  const busy = step !== 'idle';
  const steps: Array<[Step, string]> = [['db', 'Anonimizzazione dei dati'], ['cognito', 'Eliminazione dell\'account di accesso'], ['logout', 'Uscita']];
  return (
    <div className="narrow">
      <PageHeader title="Conferma la cancellazione" subtitle="Questa azione e' definitiva." />
      <div className="card pad stack">
        <p>Hai confermato la tua identita'. Premendo il pulsante i tuoi dati verranno anonimizzati, i tuoi annunci e le offerte in sospeso ritirati e l'account eliminato.</p>
        {error && <Alert>{error}</Alert>}
        {busy && (
          <ol className="steps" aria-live="polite">
            {steps.map(([k, l]) => (
              <li key={k} className={step === k ? 'current' : ''}>{l}{step === k ? '...' : ''}</li>
            ))}
          </ol>
        )}
        <div className="row">
          <button className="btn btn-danger" onClick={() => void run()} disabled={busy}>Elimina definitivamente</button>
          <Link className="btn btn-ghost" to="/profile" aria-disabled={busy}>Annulla</Link>
        </div>
      </div>
    </div>
  );
}

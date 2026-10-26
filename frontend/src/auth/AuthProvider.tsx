import { useEffect, type ReactNode } from 'react';
import { hasHint, getState, setAnonymous } from './session';
import { startLogin } from './oauth';

let initialized = false;

/**
 * Avvio: se c'e' l'indizio "ero loggato" (flag in sessionStorage) rifa' in modo silenzioso il giro
 * dell'authorization code (prompt=none) per riavere i token in memoria; altrimenti l'utente e' anonimo.
 * Su /callback non fa nulla: ci pensa la pagina Callback.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (initialized) return;
    initialized = true;
    if (window.location.pathname === '/callback') return;
    if (getState().status !== 'loading') return;
    if (hasHint()) {
      void startLogin({ silent: true, returnTo: window.location.pathname + window.location.search });
    } else {
      setAnonymous();
    }
  }, []);
  return <>{children}</>;
}

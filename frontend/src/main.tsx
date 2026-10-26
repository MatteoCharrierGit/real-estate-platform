import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { missingConfig } from './config';
import './styles/base.css';
import './styles/components.css';
import './styles/pages.css';

const root = createRoot(document.getElementById('root')!);
const missing = missingConfig();

if (missing.length > 0) {
  // Build senza .env.production: meglio un messaggio chiaro di una pagina bianca.
  root.render(
    <div className="container main">
      <div className="alert alert-error" role="alert">
        <strong>Configurazione mancante.</strong> Definisci in <code>.env.production</code> (o <code>.env.local</code>):{' '}
        {missing.join(', ')}.
      </div>
    </div>,
  );
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

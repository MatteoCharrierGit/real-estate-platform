import { Link } from 'react-router-dom';
import { EmptyState } from '../components/ui';

export default function NotFound() {
  return (
    <EmptyState title="Pagina non trovata (404)" action={<Link className="btn btn-primary" to="/">Torna agli annunci</Link>}>
      L'indirizzo che hai aperto non esiste o e' stato spostato.
    </EmptyState>
  );
}

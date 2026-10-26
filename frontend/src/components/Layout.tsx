import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useSession, takeNotice } from '../auth/session';
import { logout, startLogin } from '../auth/oauth';
import { Alert, HouseIcon } from './ui';
import { PendingRole } from '../auth/Guards';

export function Layout() {
  const s = useSession();
  const [notice] = useState(() => takeNotice());
  const [menu, setMenu] = useState(false);
  const user = s.user;
  const isAgent = !!user?.groups.some((g) => g === 'agent' || g === 'admin');
  const close = () => setMenu(false);

  return (
    <>
      <a href="#main" className="skip-link">Vai al contenuto</a>
      <header className="site-header">
        <div className="container header-inner">
          <Link to="/" className="brand" onClick={close}>
            <HouseIcon className="brand-icon" />
            <span>Casa Facile</span>
          </Link>
          <button className="btn btn-ghost menu-toggle" aria-expanded={menu} aria-controls="nav" onClick={() => setMenu((m) => !m)}>
            Menu
          </button>
          <nav id="nav" className={`nav${menu ? ' open' : ''}`} aria-label="Principale">
            <NavLink to="/" end onClick={close}>Annunci</NavLink>
            {isAgent && <NavLink to="/agent/properties" onClick={close}>I miei annunci</NavLink>}
            {user && <NavLink to="/offers" onClick={close}>Offerte</NavLink>}
            {user && <NavLink to="/profile" onClick={close}>Profilo</NavLink>}
            <span className="nav-spacer" />
            {s.status === 'loading' && <span className="muted">...</span>}
            {s.status === 'anonymous' && (
              <>
                <button className="btn btn-ghost" onClick={() => void startLogin({ returnTo: location.pathname })}>Accedi</button>
                <button className="btn btn-primary" onClick={() => void startLogin({ signup: true, returnTo: location.pathname })}>
                  Registrati
                </button>
              </>
            )}
            {user && (
              <>
                <span className="user-chip" title={user.email}>{user.email || 'Utente'}</span>
                <button className="btn" onClick={() => void logout()}>Esci</button>
              </>
            )}
          </nav>
        </div>
      </header>
      <main id="main" className="container main">
        {notice && <Alert kind="info">{notice}</Alert>}
        {user && user.groups.length === 0 && <PendingRole />}
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="container">Casa Facile - progetto dimostrativo su AWS serverless</div>
      </footer>
    </>
  );
}

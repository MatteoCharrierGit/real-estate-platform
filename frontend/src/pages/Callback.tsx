import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { completeLogin } from '../auth/oauth';
import { Alert, Spinner } from '../components/ui';

export default function Callback() {
  const nav = useNavigate();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void completeLogin(window.location.search).then((r) => {
      if (!live) return;
      if (r.error) setError(r.error);
      else nav(r.returnTo, { replace: true });
    });
    return () => {
      live = false;
    };
  }, [nav]);
  return (
    <div className="container main narrow">
      {error ? (
        <>
          <Alert>{error}</Alert>
          <Link className="btn btn-primary" to="/login">Riprova ad accedere</Link>
        </>
      ) : (
        <Spinner label="Accesso in corso..." />
      )}
    </div>
  );
}

import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../apiInstance';
import { getAccessToken, startLogin } from '../auth/oauth';
import { useSession } from '../auth/session';
import { Alert, ConfirmDialog, ErrorBox, Field, PageHeader, Spinner } from '../components/ui';
import { ApiError } from '../lib/api';
import { changePassword, updateEmail, verifyEmailCode } from '../lib/cognito';
import { errorMessage, useAsync } from '../lib/useAsync';
import { validateEmail, validateNewPassword, validateProfile } from '../lib/validation';

type Msg = { kind: 'success' | 'error' | 'info'; text: string } | null;

export default function Profile() {
  const s = useSession();
  const me = useAsync(async () => {
    try {
      return await api.getMe();
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null; // riga non ancora creata: la crea PUT
      throw e;
    }
  }, []);
  return (
    <>
      <PageHeader title="Il tuo profilo" subtitle={s.user?.email} />
      <div className="profile-layout">
        {me.loading && !me.data && me.error === null && <Spinner />}
        {me.error ? <ErrorBox error={me.error} onRetry={me.reload} /> : !me.loading && <ProfileForm initial={me.data} />}
        <div className="stack">
          <EmailForm current={s.user?.email ?? ''} />
          <PasswordForm />
          <DangerZone />
        </div>
      </div>
    </>
  );
}

function ProfileForm({ initial }: { initial: { displayName: string | null; phone: string | null; bio: string | null } | null }) {
  const [f, setF] = useState({ displayName: '', phone: '', bio: '' });
  const [errs, setErrs] = useState<ReturnType<typeof validateProfile>>({});
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (initial) setF({ displayName: initial.displayName ?? '', phone: initial.phone ?? '', bio: initial.bio ?? '' });
  }, [initial]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const v = validateProfile(f);
    setErrs(v);
    setMsg(null);
    if (Object.keys(v).length) return;
    setBusy(true);
    try {
      await api.putMe({ displayName: f.displayName.trim(), phone: f.phone.trim(), bio: f.bio.trim() });
      setMsg({ kind: 'success', text: 'Profilo salvato.' });
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="card pad stack" onSubmit={submit} noValidate>
      <h2 className="h3">Dati pubblici e di contatto</h2>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <Field label="Nome visualizzato" htmlFor="u-name" error={errs.displayName} hint="Lo vedono gli altri utenti sugli annunci.">
        <input id="u-name" value={f.displayName} onChange={set('displayName')} maxLength={100} />
      </Field>
      <Field label="Telefono" htmlFor="u-phone" error={errs.phone}>
        <input id="u-phone" type="tel" value={f.phone} onChange={set('phone')} />
      </Field>
      <Field label="Presentazione" htmlFor="u-bio" error={errs.bio}>
        <textarea id="u-bio" rows={4} value={f.bio} onChange={set('bio')} />
      </Field>
      <div><button className="btn btn-primary" disabled={busy}>{busy ? 'Salvataggio...' : 'Salva profilo'}</button></div>
    </form>
  );
}

function EmailForm({ current }: { current: string }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | undefined>();
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  async function token() {
    const t = await getAccessToken();
    if (!t) throw new Error('Sessione scaduta: accedi di nuovo.');
    return t;
  }
  async function request(e: FormEvent) {
    e.preventDefault();
    const v = validateEmail(email);
    setErr(v ?? undefined);
    if (v) return;
    setBusy(true);
    setMsg(null);
    try {
      await updateEmail(await token(), email.trim());
      setSent(true);
      setMsg({ kind: 'info', text: `Abbiamo inviato un codice di verifica a ${email.trim()}. Finche' non lo confermi resta valida l'email attuale.` });
    } catch (x) {
      setMsg({ kind: 'error', text: errorMessage(x) });
    } finally {
      setBusy(false);
    }
  }
  async function verify(e: FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      await verifyEmailCode(await token(), code.trim());
      setSent(false);
      setCode('');
      setEmail('');
      setMsg({ kind: 'success', text: 'Email aggiornata. Comparira\' nel menu al prossimo accesso.' });
    } catch (x) {
      setMsg({ kind: 'error', text: errorMessage(x) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card pad stack">
      <h2 className="h3">Cambia email</h2>
      <p className="muted small">Email attuale: <strong>{current || 'non disponibile'}</strong>. Il nuovo indirizzo viene attivato solo dopo aver inserito il codice che riceverai.</p>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <form className="stack" onSubmit={request} noValidate>
        <Field label="Nuova email" htmlFor="e-new" error={err}>
          <input id="e-new" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <div><button className="btn" disabled={busy}>Invia codice</button></div>
      </form>
      {sent && (
        <form className="stack" onSubmit={verify}>
          <Field label="Codice ricevuto per email" htmlFor="e-code">
            <input id="e-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <div><button className="btn btn-primary" disabled={busy || !code.trim()}>Conferma email</button></div>
        </form>
      )}
    </section>
  );
}

function PasswordForm() {
  const [f, setF] = useState({ old: '', new: '', confirm: '' });
  const [errs, setErrs] = useState<ReturnType<typeof validateNewPassword>>({});
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const v = validateNewPassword(f.old, f.new, f.confirm);
    setErrs(v);
    setMsg(null);
    if (Object.keys(v).length) return;
    setBusy(true);
    try {
      const t = await getAccessToken();
      if (!t) throw new Error('Sessione scaduta: accedi di nuovo.');
      await changePassword(t, f.old, f.new);
      setF({ old: '', new: '', confirm: '' });
      setMsg({ kind: 'success', text: 'Password aggiornata.' });
    } catch (x) {
      setMsg({ kind: 'error', text: errorMessage(x) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="card pad stack" onSubmit={submit} noValidate>
      <h2 className="h3">Cambia password</h2>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <Field label="Password attuale" htmlFor="pw-old" error={errs.old}>
        <input id="pw-old" type="password" autoComplete="current-password" value={f.old} onChange={set('old')} />
      </Field>
      <Field label="Nuova password" htmlFor="pw-new" error={errs.new}>
        <input id="pw-new" type="password" autoComplete="new-password" value={f.new} onChange={set('new')} />
      </Field>
      <Field label="Ripeti la nuova password" htmlFor="pw-confirm" error={errs.confirm}>
        <input id="pw-confirm" type="password" autoComplete="new-password" value={f.confirm} onChange={set('confirm')} />
      </Field>
      <div><button className="btn" disabled={busy}>{busy ? 'Salvataggio...' : 'Aggiorna password'}</button></div>
    </form>
  );
}

function DangerZone() {
  const [open, setOpen] = useState(false);
  return (
    <section className="card pad stack danger-zone">
      <h2 className="h3">Elimina account</h2>
      <p className="muted small">
        Elimina definitivamente il tuo account e anonimizza i tuoi dati. I tuoi annunci e le offerte in sospeso vengono ritirati.
        Per sicurezza dovrai rifare l'accesso.
      </p>
      <div><button className="btn btn-danger" onClick={() => setOpen(true)}>Elimina il mio account</button></div>
      <ConfirmDialog open={open} title="Eliminare l'account?" confirmLabel="Continua con l'accesso" danger
        onConfirm={() => void startLogin({ forceLogin: true, purpose: 'delete-account' })} onCancel={() => setOpen(false)}>
        <p>Ti chiederemo di inserire di nuovo le credenziali, poi potrai confermare la cancellazione definitiva.</p>
      </ConfirmDialog>
    </section>
  );
}

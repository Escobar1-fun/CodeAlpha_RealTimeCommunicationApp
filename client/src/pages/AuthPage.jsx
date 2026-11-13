import { useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';

const COPY = {
  login: { title: 'Welcome back', action: 'Log in', busy: 'Logging in…' },
  register: { title: 'Create your account', action: 'Sign up', busy: 'Creating account…' },
};

// Only same-app paths: `from` must never become an open redirect.
function safeNext(from) {
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : '/';
}

export default function AuthPage({ mode }) {
  const { user, loading, authenticate } = useAuth();
  const location = useLocation();
  const [fields, setFields] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const next = safeNext(location.state?.from);
  if (!loading && user) return <Navigate to={next} replace />;

  const isRegister = mode === 'register';
  const copy = COPY[mode];
  const update = (key) => (e) => setFields((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { name, email, password } = fields;
      await authenticate(mode, isRegister ? { name, email, password } : { email, password });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <section className="auth-intro">
        <p className="wordmark">Roundtable</p>
        <h1>Meet, sketch and share in one room.</h1>
        <p className="muted">
          Video goes directly between participants. Everyone in the room sees the same whiteboard, chat
          and files, and it all disappears after the meeting.
        </p>
      </section>

      <form className="auth-form" onSubmit={submit}>
        <h2>{copy.title}</h2>
        {isRegister && (
          <label>
            Name
            <input value={fields.name} onChange={update('name')} autoComplete="name" maxLength={60} required />
          </label>
        )}
        <label>
          Email
          <input type="email" value={fields.email} onChange={update('email')} autoComplete="email" required />
        </label>
        <label>
          Password
          <input
            type="password"
            value={fields.password}
            onChange={update('password')}
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            minLength={isRegister ? 8 : undefined}
            required
          />
          {isRegister && <small className="muted">At least 8 characters</small>}
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary" disabled={busy}>{busy ? copy.busy : copy.action}</button>
        <p className="muted switch">
          {isRegister ? 'Already have an account? ' : 'New here? '}
          <Link to={isRegister ? '/login' : '/register'} state={location.state}>
            {isRegister ? 'Log in' : 'Create an account'}
          </Link>
        </p>
      </form>
    </main>
  );
}

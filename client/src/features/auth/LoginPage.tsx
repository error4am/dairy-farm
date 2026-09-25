import { useState, type FormEvent } from 'react';
import { Field } from '../../components/Field';
import { ApiError } from '../../lib/api';
import { useAuth } from '../../lib/AuthContext';

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card card">
        <div className="auth-brand">Dairy Farm Manager</div>
        <h1 className="auth-title">Sign in</h1>
        <p className="auth-subtitle">Enter your owner credentials to manage the farm.</p>
        <form onSubmit={submit} className="stack">
          <Field label="Email" required htmlFor="login-email">
            <input
              id="login-email"
              type="email"
              className="input"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field label="Password" required htmlFor="login-password">
            <input
              id="login-password"
              type="password"
              className="input"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          {error ? <div className="auth-alert">{error}</div> : null}
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Signing in…' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  );
}

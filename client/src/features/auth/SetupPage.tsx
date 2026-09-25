import { useState, type FormEvent } from 'react';
import { Field } from '../../components/Field';
import { ApiError } from '../../lib/api';
import { useAuth, type SetupPayload } from '../../lib/AuthContext';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

export function SetupPage() {
  const { setup } = useAuth();
  const [name, setName] = useState('');
  const [farmName, setFarmName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [setupSecret, setSetupSecret] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function validate(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Name is required.';
    if (!EMAIL_RE.test(email.trim())) errs.email = 'Enter a valid email address.';
    if (!PASSWORD_RE.test(password)) {
      errs.password = 'Password must be at least 8 characters long and contain letters and numbers.';
    }
    if (confirm !== password) errs.confirm_password = 'Passwords do not match.';
    return errs;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setError(null);
    setBusy(true);
    const payload: SetupPayload = {
      name: name.trim(),
      email: email.trim(),
      password,
      confirm_password: confirm,
      farm_name: farmName.trim() || undefined,
      setup_secret: setupSecret.trim() || undefined
    };
    try {
      await setup(payload);
    } catch (err) {
      if (err instanceof ApiError && err.details) {
        setErrors(err.details);
      }
      setError(err instanceof ApiError ? err.message : 'Could not create the owner account. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card card">
        <div className="auth-brand">Dairy Farm Manager</div>
        <h1 className="auth-title">Create Owner Account</h1>
        <p className="auth-subtitle">Set up the owner account for this farm. This can only be done once.</p>
        <form onSubmit={submit} className="stack">
          <Field label="Name" required error={errors.name} htmlFor="setup-name">
            <input
              id="setup-name"
              className={`input${errors.name ? ' invalid' : ''}`}
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Farm name" htmlFor="setup-farm" hint="Optional — updates the farm name in settings.">
            <input
              id="setup-farm"
              className="input"
              value={farmName}
              onChange={(e) => setFarmName(e.target.value)}
            />
          </Field>
          <Field label="Email" required error={errors.email} htmlFor="setup-email">
            <input
              id="setup-email"
              type="email"
              className={`input${errors.email ? ' invalid' : ''}`}
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field
            label="Password"
            required
            error={errors.password}
            hint="At least 8 characters with letters and numbers."
            htmlFor="setup-password"
          >
            <input
              id="setup-password"
              type="password"
              className={`input${errors.password ? ' invalid' : ''}`}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field label="Confirm password" required error={errors.confirm_password} htmlFor="setup-confirm">
            <input
              id="setup-confirm"
              type="password"
              className={`input${errors.confirm_password ? ' invalid' : ''}`}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
          <Field label="Setup secret" htmlFor="setup-secret" hint="Only needed if the server requires one.">
            <input
              id="setup-secret"
              type="password"
              className="input"
              autoComplete="off"
              value={setupSecret}
              onChange={(e) => setSetupSecret(e.target.value)}
            />
          </Field>
          {error ? <div className="auth-alert">{error}</div> : null}
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Creating account…' : 'Create Owner Account'}
          </button>
        </form>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';

export function RegisterPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user && !confirmationSent) {
    return <Navigate to="/mis-pedidos" replace />;
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const { needsConfirmation } = await api.auth.register(email, password);
      if (needsConfirmation) {
        setConfirmationSent(true);
        setSubmitting(false);
        return;
      }
      navigate('/mis-pedidos', { replace: true });
    } catch (e) {
      setError((e as Error).message);
      setSubmitting(false);
    }
  };

  if (confirmationSent) {
    return (
      <div className="card" style={{ maxWidth: 420, margin: '40px auto' }}>
        <h1 className="page-title">Revisa tu email</h1>
        <p>
          Te enviamos un enlace a <strong>{email}</strong>. Ábrelo para confirmar la cuenta y
          después <Link to="/entrar">entra</Link>.
        </p>
      </div>
    );
  }

  return (
    <div className="card" style={{ maxWidth: 420, margin: '40px auto' }}>
      <h1 className="page-title">Crear cuenta</h1>
      <p className="page-subtitle">
        Con una cuenta puedes seguir tus pedidos sin guardar el enlace de confirmación.
      </p>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="password">Contraseña</label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="field-hint">Al menos 8 caracteres.</p>
        </div>
        <button type="submit" className="full-width" disabled={submitting}>
          {submitting ? 'Creando…' : 'Crear cuenta'}
        </button>
      </form>
      <p className="field-hint" style={{ marginTop: 'var(--space-4)' }}>
        ¿Ya tienes cuenta? <Link to="/entrar">Entra</Link>.
      </p>
    </div>
  );
}

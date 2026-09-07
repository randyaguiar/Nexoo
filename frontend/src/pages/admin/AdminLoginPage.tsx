import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, adminToken, api } from '../../api/client';

export function AdminLoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const result = await api.admin.login(email, password);
      adminToken.set(result.token);
      navigate('/admin/pedidos', { replace: true });
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 401
          ? 'Credenciales inválidas.'
          : (e as Error).message,
      );
      setSubmitting(false);
    }
  };

  return (
    <div className="card" style={{ maxWidth: 400, margin: '40px auto' }}>
      <h1 className="page-title">Acceso admin</h1>
      {error && <div className="alert error">{error}</div>}
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            required
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
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button type="submit" disabled={submitting} style={{ width: '100%' }}>
          {submitting ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}

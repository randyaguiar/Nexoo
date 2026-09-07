import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';

const metaString = (value: unknown): string => (typeof value === 'string' ? value : '');

export function AccountPage() {
  const { user, admin, loading } = useAuth();
  const meta = user?.user_metadata ?? {};

  const [fullName, setFullName] = useState(() => metaString(meta.full_name));
  const [phone, setPhone] = useState(() => metaString(meta.phone));
  const [orderEmails, setOrderEmails] = useState(() => meta.order_emails !== false);
  const [profileState, setProfileState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [profileError, setProfileError] = useState<string | null>(null);

  const [password, setPassword] = useState('');
  const [passwordState, setPasswordState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [passwordError, setPasswordError] = useState<string | null>(null);

  if (loading) return <p className="empty">Cargando…</p>;
  if (!user) return <Navigate to="/entrar" replace state={{ from: '/cuenta' }} />;

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    setProfileState('saving');
    setProfileError(null);
    try {
      await api.auth.updateProfile({ fullName, phone, orderEmails });
      setProfileState('saved');
    } catch (e) {
      setProfileError((e as Error).message);
      setProfileState('idle');
    }
  };

  const savePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setPasswordState('saving');
    setPasswordError(null);
    try {
      await api.auth.updatePassword(password);
      setPassword('');
      setPasswordState('saved');
    } catch (e) {
      setPasswordError((e as Error).message);
      setPasswordState('idle');
    }
  };

  return (
    <>
      <h1 className="page-title">Mi cuenta</h1>
      <p className="page-subtitle">Sesión iniciada como {user.email}</p>

      <div className="account-grid">
        <section className="card" id="perfil">
          <h2>Perfil</h2>
          <p className="field-hint">Usamos estos datos para completar tus pedidos más rápido.</p>
          {profileError && (
            <div className="alert error" role="alert">
              {profileError}
            </div>
          )}
          {profileState === 'saved' && (
            <div className="alert success" role="status">
              Perfil guardado.
            </div>
          )}
          <form onSubmit={saveProfile}>
            <div className="field">
              <label htmlFor="fullName">Nombre completo</label>
              <input
                id="fullName"
                autoComplete="name"
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                  setProfileState('idle');
                }}
              />
            </div>
            <div className="field">
              <label htmlFor="phone">Teléfono</label>
              <input
                id="phone"
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setProfileState('idle');
                }}
              />
            </div>
            <div className="field" id="preferencias">
              <label htmlFor="orderEmails" className="checkbox">
                <input
                  id="orderEmails"
                  type="checkbox"
                  checked={orderEmails}
                  onChange={(e) => {
                    setOrderEmails(e.target.checked);
                    setProfileState('idle');
                  }}
                />
                Avisarme por email cuando cambie el estado de un pedido
              </label>
            </div>
            <button type="submit" disabled={profileState === 'saving'}>
              {profileState === 'saving' ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </form>
        </section>

        <section className="card" id="seguridad">
          <h2>Seguridad</h2>
          {passwordError && (
            <div className="alert error" role="alert">
              {passwordError}
            </div>
          )}
          {passwordState === 'saved' && (
            <div className="alert success" role="status">
              Contraseña actualizada.
            </div>
          )}
          <form onSubmit={savePassword}>
            <div className="field">
              <label htmlFor="newPassword">Nueva contraseña</label>
              <input
                id="newPassword"
                type="password"
                required
                minLength={6}
                autoComplete="new-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setPasswordState('idle');
                }}
              />
            </div>
            <button type="submit" disabled={passwordState === 'saving'}>
              {passwordState === 'saving' ? 'Guardando…' : 'Cambiar contraseña'}
            </button>
          </form>

          <hr />
          <p className="field-hint">
            <Link to="/mis-pedidos">Ver historial de compras</Link>
            {admin && (
              <>
                {' · '}
                <Link to="/admin/pedidos">Panel Admin</Link>
              </>
            )}
          </p>
        </section>
      </div>
    </>
  );
}

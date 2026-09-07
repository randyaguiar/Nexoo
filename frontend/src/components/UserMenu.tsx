import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { ChevronDownIcon, LogoutIcon, ReceiptIcon, SettingsIcon, ShieldIcon, UserIcon } from './Icon';

/** Nombre guardado en el perfil; si falta, la parte local del email. */
function displayName(user: { email?: string; user_metadata?: { full_name?: unknown } }): string {
  const fullName = user.user_metadata?.full_name;
  if (typeof fullName === 'string' && fullName.trim()) return fullName.trim();
  return user.email?.split('@')[0] ?? 'Mi cuenta';
}

/** Menú desplegable de la sesión iniciada: perfil, pedidos, ajustes y salir. */
export function UserMenu() {
  const { user, admin } = useAuth();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!user) return null;

  const name = displayName(user);

  const logout = async () => {
    setOpen(false);
    await api.auth.logout();
    navigate('/');
  };

  return (
    <div className="user-menu" ref={containerRef}>
      <button
        type="button"
        className="user-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="user-avatar" aria-hidden="true">
          {name.charAt(0).toUpperCase()}
        </span>
        <span className="user-menu-name">{name}</span>
        <ChevronDownIcon size={14} />
      </button>

      {open && (
        <div className="user-menu-panel" role="menu">
          <div className="user-menu-header">
            <strong>{name}</strong>
            <span>{user.email}</span>
          </div>
          <Link to="/mis-pedidos" role="menuitem" onClick={() => setOpen(false)}>
            <ReceiptIcon size={16} />
            Historial de compras
          </Link>
          <Link to="/cuenta" role="menuitem" onClick={() => setOpen(false)}>
            <UserIcon size={16} />
            Mi perfil
          </Link>
          <Link to="/cuenta#preferencias" role="menuitem" onClick={() => setOpen(false)}>
            <SettingsIcon size={16} />
            Ajustes
          </Link>
          {admin && (
            <Link to="/admin/pedidos" role="menuitem" onClick={() => setOpen(false)}>
              <ShieldIcon size={16} />
              Panel Admin
            </Link>
          )}
          <button type="button" role="menuitem" onClick={() => void logout()}>
            <LogoutIcon size={16} />
            Cerrar sesión
          </button>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { supabase } from '../../api/supabase';
import type { AdminRole } from '../../api/types';

type SessionState = 'loading' | 'authenticated' | 'anonymous';

export function AdminLayout() {
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionState>('loading');
  const [role, setRole] = useState<AdminRole | null>(null);

  useEffect(() => {
    // getSession lee el token persistido; onAuthStateChange cubre el logout y la
    // expiración mientras el panel está abierto.
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ? 'authenticated' : 'anonymous');
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next ? 'authenticated' : 'anonymous');
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  // El enlace de usuarios solo tiene sentido para un owner; la Edge Function
  // vuelve a comprobarlo en cada escritura.
  useEffect(() => {
    if (session !== 'authenticated') {
      setRole(null);
      return;
    }
    void api.admin.currentAdmin().then((admin) => setRole(admin?.role ?? null));
  }, [session]);

  if (session === 'loading') {
    return <p className="empty">Cargando…</p>;
  }

  if (session === 'anonymous') {
    return <Navigate to="/admin/login" replace />;
  }

  const logout = async () => {
    await api.admin.logout();
    navigate('/admin/login', { replace: true });
  };

  const linkClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'active' : '');

  return (
    <>
      <div className="admin-header">
        <h1 className="page-title">Panel Nexoo</h1>
        <button type="button" className="secondary" onClick={() => void logout()}>
          Cerrar sesión
        </button>
      </div>

      <nav className="admin-nav">
        <NavLink to="/admin/pedidos" className={linkClass}>
          Pedidos
        </NavLink>
        <NavLink to="/admin/negocios" className={linkClass}>
          Negocios
        </NavLink>
        <NavLink to="/admin/productos" className={linkClass}>
          Productos
        </NavLink>
        {role === 'owner' && (
          <NavLink to="/admin/usuarios" className={linkClass}>
            Usuarios
          </NavLink>
        )}
      </nav>

      <Outlet />
    </>
  );
}

import { useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { supabase } from '../../api/supabase';

type SessionState = 'loading' | 'authenticated' | 'anonymous';

export function AdminLayout() {
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionState>('loading');

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
      </nav>

      <Outlet />
    </>
  );
}

import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import type { AdminUser } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';

export function AdminLayout() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  // undefined mientras se resuelve; null = la sesión no pertenece a un admin.
  const [admin, setAdmin] = useState<AdminUser | null | undefined>(undefined);

  useEffect(() => {
    if (!user) {
      setAdmin(null);
      return;
    }
    setAdmin(undefined);
    void api.admin.currentAdmin().then(setAdmin);
  }, [user]);

  if (loading || (user && admin === undefined)) {
    return <p className="empty">Cargando…</p>;
  }

  if (!user) {
    return <Navigate to="/admin/login" replace />;
  }

  const logout = async () => {
    await api.auth.logout();
    navigate('/admin/login', { replace: true });
  };

  // Una cuenta de comprador puede tener sesión iniciada: sin fila en `admins` no
  // ve nada del panel (las policies ya lo impiden) y se le dice por qué.
  if (!admin) {
    return (
      <div className="empty-state">
        <h3>Esta cuenta no tiene acceso al panel</h3>
        <p>Entra con un usuario administrador o vuelve al catálogo.</p>
        <button type="button" className="secondary" onClick={() => void logout()}>
          Cerrar sesión
        </button>{' '}
        <Link className="button" to="/">
          Ir al catálogo
        </Link>
      </div>
    );
  }

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
        {admin.role === 'owner' && (
          <NavLink to="/admin/usuarios" className={linkClass}>
            Usuarios
          </NavLink>
        )}
      </nav>

      <Outlet />
    </>
  );
}

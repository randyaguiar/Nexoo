import { NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { adminToken } from '../../api/client';

export function AdminLayout() {
  const navigate = useNavigate();

  if (!adminToken.get()) {
    return <Navigate to="/admin/login" replace />;
  }

  const logout = () => {
    adminToken.clear();
    navigate('/admin/login', { replace: true });
  };

  const linkClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'active' : '');

  return (
    <>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <h1 className="page-title">Panel Nexoo</h1>
        <button type="button" className="secondary" onClick={logout}>
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

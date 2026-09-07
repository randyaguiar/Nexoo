import { Link, NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import {
  BoxIcon,
  MapPinIcon,
  ReceiptIcon,
  StoreIcon,
  TagIcon,
  UsersIcon,
} from '../../components/Icon';

const NAV_ITEMS = [
  { to: '/admin/pedidos', label: 'Pedidos', Icon: ReceiptIcon },
  { to: '/admin/negocios', label: 'Negocios', Icon: StoreIcon },
  { to: '/admin/productos', label: 'Productos', Icon: BoxIcon },
  { to: '/admin/categorias', label: 'Categorías', Icon: TagIcon },
  { to: '/admin/lugares', label: 'Provincias y municipios', Icon: MapPinIcon },
] as const;

export function AdminLayout() {
  const navigate = useNavigate();
  const { user, admin, adminError, loading } = useAuth();

  if (loading) {
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
        {adminError ? (
          <p className="alert error" role="alert">
            {adminError}
          </p>
        ) : (
          <p>
            La sesión de <strong>{user.email}</strong> no tiene una fila en <code>admins</code>.
            Entra con un usuario administrador o vuelve al catálogo.
          </p>
        )}
        <button type="button" className="secondary" onClick={() => void logout()}>
          Cerrar sesión
        </button>{' '}
        <Link className="button" to="/">
          Ir al catálogo
        </Link>
      </div>
    );
  }

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    isActive ? 'admin-nav-link active' : 'admin-nav-link';

  return (
    <>
      <div className="admin-header">
        <div>
          <h1 className="page-title">Panel Nexoo</h1>
          <p className="admin-header-meta">
            <span className={`admin-role-badge ${admin.role}`}>
              {admin.role === 'owner' ? 'Propietario' : 'Administrador'}
            </span>
            <span>{user.email}</span>
          </p>
        </div>
      </div>

      <nav className="admin-nav" aria-label="Secciones del panel">
        {NAV_ITEMS.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} className={linkClass}>
            <Icon size={17} />
            <span>{label}</span>
          </NavLink>
        ))}
        {admin.role === 'owner' && (
          <NavLink to="/admin/usuarios" className={linkClass}>
            <UsersIcon size={17} />
            <span>Usuarios</span>
          </NavLink>
        )}
      </nav>

      <Outlet />
    </>
  );
}

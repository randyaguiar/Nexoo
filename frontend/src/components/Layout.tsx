import { Link, Outlet, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useCart } from '../cart/CartContext';
import { Logo, LogoMark } from './Logo';

export function Layout() {
  const { itemCount } = useCart();
  const { user, admin } = useAuth();
  const navigate = useNavigate();

  const logout = async () => {
    await api.auth.logout();
    navigate('/');
  };

  return (
    <>
      <a className="skip-link" href="#contenido">
        Saltar al contenido
      </a>

      <header className="site-header">
        <div className="container">
          <Link to="/" className="brand" aria-label="Nexoo — inicio">
            <Logo />
            <span className="brand-tagline">
              Cerca de los tuyos,
              <br />
              aunque estés lejos.
            </span>
          </Link>
          <nav className="header-nav" aria-label="Principal">
            <Link to="/">Catálogo</Link>
            {user ? (
              <>
                {admin && <Link to="/admin/pedidos">Panel</Link>}
                <Link to="/mis-pedidos">Mis pedidos</Link>
                <button type="button" className="link" onClick={() => void logout()}>
                  Salir
                </button>
              </>
            ) : (
              <Link to="/entrar">Entrar</Link>
            )}
            <Link to="/carrito" className="cart-link">
              Carrito
              {itemCount > 0 && (
                <span className="cart-badge" aria-hidden="true">
                  {itemCount}
                </span>
              )}
              <span className="visually-hidden">
                {itemCount === 0
                  ? '(vacío)'
                  : `(${itemCount} ${itemCount === 1 ? 'producto' : 'productos'})`}
              </span>
            </Link>
          </nav>
        </div>
      </header>

      <main id="contenido">
        <div className="container">
          <Outlet />
        </div>
      </main>

      <footer className="site-footer">
        <div className="container">
          <div className="footer-grid">
            <div>
              <LogoMark size={32} />
              <p style={{ marginTop: 'var(--space-3)', maxWidth: '38ch' }}>
                Compra desde EE.UU. en negocios de Pinar del Río y La Habana, y entrega a tu familia
                en Cuba.
              </p>
            </div>
            <div>
              <h4>Cómo funciona</h4>
              <ul>
                <li>Elige un negocio en Cuba</li>
                <li>Arma el pedido y confírmalo</li>
                <li>Paga por Zelle y entregamos</li>
              </ul>
            </div>
            <div>
              <h4>Enlaces</h4>
              <ul>
                <li>
                  <Link to="/">Catálogo</Link>
                </li>
                <li>
                  <Link to="/carrito">Carrito</Link>
                </li>
                <li>
                  <Link to={user ? '/mis-pedidos' : '/entrar'}>
                    {user ? 'Mis pedidos' : 'Entrar / Crear cuenta'}
                  </Link>
                </li>
                <li>
                  <Link to={admin ? '/admin/pedidos' : '/admin/login'}>Acceso admin</Link>
                </li>
              </ul>
            </div>
          </div>
          <div className="footer-bottom">
            © {new Date().getFullYear()} Nexoo · Pago coordinado por Zelle
          </div>
        </div>
      </footer>
    </>
  );
}

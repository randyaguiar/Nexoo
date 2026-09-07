import { Link, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useCart } from '../cart/CartContext';
import { CartIcon, GridIcon, LoginIcon, ShieldIcon } from './Icon';
import { Logo, LogoMark } from './Logo';
import { UserMenu } from './UserMenu';

export function Layout() {
  const { itemCount } = useCart();
  const { user, admin } = useAuth();

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
            <Link to="/">
              <GridIcon size={16} />
              Catálogo
            </Link>
            {admin && (
              <Link to="/admin/pedidos">
                <ShieldIcon size={16} />
                Panel Admin
              </Link>
            )}
            <Link to="/carrito" className="cart-link" aria-label="Carrito de compras">
              <CartIcon size={18} />
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
            {user ? (
              <UserMenu />
            ) : (
              <Link to="/entrar">
                <LoginIcon size={16} />
                Entrar
              </Link>
            )}
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
                  <Link to={admin ? '/admin/pedidos' : '/admin/login'}>Panel Admin</Link>
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

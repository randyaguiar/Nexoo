import { Link, Outlet } from 'react-router-dom';
import { useCart } from '../cart/CartContext';

export function Layout() {
  const { itemCount } = useCart();

  return (
    <>
      <header className="site-header">
        <div className="container">
          <Link to="/" className="brand">
            Nexoo<span className="brand-dot">.</span>
            <span className="brand-tagline">Cuba entrega, tú envías</span>
          </Link>
          <nav className="header-nav">
            <Link to="/">Catálogo</Link>
            <Link to="/carrito" className="cart-link">
              Carrito
              {itemCount > 0 && <span className="cart-badge">{itemCount}</span>}
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <div className="container">
          <Outlet />
        </div>
      </main>

      <footer className="site-footer">
        <div className="container">
          Nexoo — Compra desde EE.UU. en negocios de Pinar del Río y La Habana, y entrega a tu
          familia en Cuba. Pago coordinado por Zelle.
        </div>
      </footer>
    </>
  );
}

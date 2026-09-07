import { Link } from 'react-router-dom';
import { useCart } from '../cart/CartContext';
import { formatUsd } from '../components/Money';

export function CartPage() {
  const cart = useCart();

  if (cart.lines.length === 0) {
    return (
      <>
        <h1 className="page-title">Tu carrito</h1>
        <div className="empty-state">
          <h3>Tu carrito está vacío</h3>
          <p>Elige un negocio en Cuba y agrega productos para tu familia.</p>
          <Link className="button" to="/">
            Explorar el catálogo
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <ol className="steps">
        <li className="current">Carrito</li>
        <li>Datos de entrega</li>
        <li>Pago</li>
      </ol>

      <h1 className="page-title">Tu carrito</h1>
      <p className="page-subtitle">
        Pedido a <strong>{cart.businessName}</strong>
      </p>

      <div className="card">
        {cart.lines.map(({ product, quantity }) => (
          <div key={product.id} className="cart-line">
            {product.photoUrl && <img src={product.photoUrl} alt={product.name} loading="lazy" />}
            <div className="grow">
              <strong>{product.name}</strong>
              <p className="meta">{formatUsd(product.priceUsd)} c/u</p>
            </div>
            <input
              className="qty-input"
              type="number"
              min={1}
              max={100}
              value={quantity}
              aria-label={`Cantidad de ${product.name}`}
              onChange={(e) => cart.setQuantity(product.id, Number(e.target.value))}
            />
            <strong>{formatUsd(product.priceUsd * quantity)}</strong>
            <button
              type="button"
              className="link"
              aria-label={`Quitar ${product.name} del carrito`}
              onClick={() => cart.removeProduct(product.id)}
            >
              Quitar
            </button>
          </div>
        ))}

        <div className="summary">
          <span>Total</span>
          <span>{formatUsd(cart.total)}</span>
        </div>
      </div>

      <p className="meta" style={{ marginTop: 'var(--space-4)' }}>
        Cada pedido se paga a un solo negocio. El pago se coordina por Zelle al confirmar.
      </p>

      <div className="filters" style={{ marginTop: 'var(--space-4)' }}>
        <Link className="button" to="/checkout">
          Continuar al pedido
        </Link>
        <button type="button" className="secondary" onClick={cart.clear}>
          Vaciar carrito
        </button>
      </div>
    </>
  );
}

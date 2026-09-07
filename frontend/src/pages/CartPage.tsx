import { Link } from 'react-router-dom';
import { useCart } from '../cart/CartContext';
import { formatUsd } from '../components/Money';

export function CartPage() {
  const cart = useCart();

  if (cart.lines.length === 0) {
    return (
      <>
        <h1 className="page-title">Tu carrito</h1>
        <p className="empty">
          El carrito está vacío. <Link to="/">Explora el catálogo</Link>.
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="page-title">Tu carrito</h1>
      <p className="page-subtitle">Pedido a {cart.businessName}</p>

      <div className="card">
        {cart.lines.map(({ product, quantity }) => (
          <div key={product.id} className="cart-line">
            {product.photoUrl && <img src={product.photoUrl} alt={product.name} />}
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
            <button type="button" className="link" onClick={() => cart.removeProduct(product.id)}>
              Quitar
            </button>
          </div>
        ))}

        <div className="summary">
          <span>Total</span>
          <span>{formatUsd(cart.total)}</span>
        </div>
      </div>

      <div className="filters" style={{ marginTop: 20 }}>
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

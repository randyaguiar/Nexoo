import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { ProductDetail } from '../api/types';
import { useCart } from '../cart/CartContext';
import { Money } from '../components/Money';
import { ProductPhotos } from '../components/ProductPhotos';

/** El tope por línea de `create_order`; pedir más falla en la base de datos. */
const MAX_QUANTITY = 100;

export function ProductPage() {
  const { id = '' } = useParams();
  const cart = useCart();
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setAdded(false);
    setQuantity(1);

    api
      .getProduct(id)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div aria-busy="true" className="product-detail">
        <div className="skeleton" style={{ aspectRatio: '1 / 1', borderRadius: 'var(--nexoo-radius)' }} />
        <div>
          <div className="skeleton" style={{ height: 28, width: '70%', marginBottom: 12 }} />
          <div className="skeleton" style={{ height: 20, width: '40%', marginBottom: 24 }} />
          <div className="skeleton" style={{ height: 72 }} />
        </div>
      </div>
    );
  }

  if (error)
    return (
      <div className="alert error" role="alert">
        {error}
      </div>
    );

  if (!detail)
    return (
      <div className="empty-state">
        <h3>Producto no encontrado</h3>
        <p>
          Puede que ya no esté a la venta. <Link to="/">Vuelve al catálogo</Link>.
        </p>
      </div>
    );

  const { product, business } = detail;
  // Cada pedido se paga a un solo negocio, así que el carrito no mezcla.
  const blocked = !cart.canAddFrom(business.id);
  const soldOut = product.stock === 0;
  const max = Math.min(product.stock, MAX_QUANTITY);

  return (
    <>
      <Link to={`/negocios/${business.id}`} className="back-link">
        <span aria-hidden="true">←</span> Volver a {business.name}
      </Link>

      <div className="product-detail">
        <ProductPhotos photos={product.photoUrls} alt={product.name} large />

        <div className="product-detail-info">
          <h1 className="page-title">{product.name}</h1>
          <p className="page-subtitle">
            <span className="tag">{business.provinceName}</span> Vendido por{' '}
            <Link to={`/negocios/${business.id}`}>{business.name}</Link>, {business.municipality}
          </p>

          <Money value={product.priceUsd} />

          {product.description && <p>{product.description}</p>}

          <p className="meta">
            {soldOut
              ? 'Agotado por ahora.'
              : product.stock === 1
                ? 'Queda 1 unidad.'
                : `Quedan ${product.stock} unidades.`}
          </p>

          {blocked && (
            <div className="alert info" role="status">
              Tu carrito tiene productos de <strong>{cart.businessName}</strong>. Cada pedido se
              paga a un solo negocio, así que debes{' '}
              <button type="button" className="link" onClick={cart.clear}>
                vaciar el carrito
              </button>{' '}
              para comprar aquí.
            </div>
          )}

          {!soldOut && !blocked && (
            <div className="quantity-picker">
              <label htmlFor="quantity">Cantidad</label>
              <input
                id="quantity"
                type="number"
                min={1}
                max={max}
                value={quantity}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  setQuantity(Number.isNaN(value) ? 1 : Math.min(Math.max(value, 1), max));
                }}
              />
            </div>
          )}

          <button
            type="button"
            disabled={blocked || soldOut}
            onClick={() => {
              cart.addProduct(product, business, quantity);
              setAdded(true);
            }}
          >
            Agregar al carrito
          </button>

          <div aria-live="polite">
            {added && (
              <div className="alert success">
                Agregado al carrito. <Link to="/carrito">Ver carrito</Link>
              </div>
            )}
          </div>

          {business.description && (
            <p className="meta">
              <strong>Sobre el negocio:</strong> {business.description}
            </p>
          )}
        </div>
      </div>
    </>
  );
}

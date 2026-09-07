import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { provinceLabel, type BusinessDetail } from '../api/types';
import { useCart } from '../cart/CartContext';
import { Money } from '../components/Money';

export function BusinessPage() {
  const { id = '' } = useParams();
  const cart = useCart();
  const [detail, setDetail] = useState<BusinessDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastAdded, setLastAdded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .getBusiness(id)
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

  if (loading) return <p className="empty">Cargando negocio…</p>;
  if (error) return <div className="alert error">{error}</div>;
  if (!detail) return <p className="empty">Negocio no encontrado.</p>;

  const { business, products } = detail;
  const blocked = !cart.canAddFrom(business.id);

  return (
    <>
      <p className="meta">
        <Link to="/">← Volver al catálogo</Link>
      </p>
      <h1 className="page-title">{business.name}</h1>
      <p className="page-subtitle">
        {provinceLabel(business.province)} · {business.municipality}
        {business.description ? ` — ${business.description}` : ''}
      </p>

      {blocked && (
        <div className="alert info">
          Tu carrito tiene productos de <strong>{cart.businessName}</strong>. Cada pedido se paga a
          un solo negocio, así que debes{' '}
          <button type="button" className="link" onClick={cart.clear}>
            vaciar el carrito
          </button>{' '}
          para comprar aquí.
        </div>
      )}

      {lastAdded && (
        <div className="alert info">
          Agregado al carrito: {lastAdded}. <Link to="/carrito">Ver carrito</Link>
        </div>
      )}

      {products.length === 0 && <p className="empty">Este negocio aún no tiene productos.</p>}

      <div className="grid">
        {products.map((product) => (
          <article key={product.id} className="card product-card">
            {product.photoUrl && (
              <img className="product-photo" src={product.photoUrl} alt={product.name} />
            )}
            <div className="product-body">
              <h3>{product.name}</h3>
              {product.description && <p className="meta">{product.description}</p>}
              <Money value={product.priceUsd} />
              <button
                type="button"
                disabled={blocked}
                onClick={() => {
                  cart.addProduct(product, business);
                  setLastAdded(product.name);
                }}
              >
                Agregar al carrito
              </button>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

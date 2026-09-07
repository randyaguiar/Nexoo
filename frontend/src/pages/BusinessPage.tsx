import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { BusinessDetail } from '../api/types';
import { useCart } from '../cart/CartContext';
import { Money } from '../components/Money';
import { SkeletonGrid } from '../components/Skeleton';

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

  if (loading) {
    return (
      <div aria-busy="true">
        <div className="skeleton" style={{ height: 28, width: '40%', marginBottom: 12 }} />
        <div className="skeleton" style={{ height: 18, width: '60%', marginBottom: 28 }} />
        <SkeletonGrid />
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
        <h3>Negocio no encontrado</h3>
        <p>
          Puede que ya no esté disponible. <Link to="/">Vuelve al catálogo</Link>.
        </p>
      </div>
    );

  const { business, products } = detail;
  const blocked = !cart.canAddFrom(business.id);

  return (
    <>
      <Link to="/" className="back-link">
        <span aria-hidden="true">←</span> Volver al catálogo
      </Link>
      <div className="business-heading">
        {business.logoUrl && (
          <img className="business-logo" src={business.logoUrl} alt={`Logo de ${business.name}`} />
        )}
        <div>
          <h1 className="page-title">{business.name}</h1>
          <p className="page-subtitle">
            <span className="tag">{business.provinceName}</span>
            {business.categories.map((c) => (
              <span key={c.id} className="tag">
                {c.name}
              </span>
            ))}{' '}
            {business.municipality}
            {business.description ? ` — ${business.description}` : ''}
          </p>
        </div>
      </div>

      {blocked && (
        <div className="alert info" role="status">
          Tu carrito tiene productos de <strong>{cart.businessName}</strong>. Cada pedido se paga a
          un solo negocio, así que debes{' '}
          <button type="button" className="link" onClick={cart.clear}>
            vaciar el carrito
          </button>{' '}
          para comprar aquí.
        </div>
      )}

      <div aria-live="polite">
        {lastAdded && (
          <div className="alert success">
            <strong>{lastAdded}</strong> se agregó al carrito.{' '}
            <Link to="/carrito">Ver carrito</Link>
          </div>
        )}
      </div>

      {products.length === 0 && (
        <div className="empty-state">
          <h3>Este negocio aún no tiene productos</h3>
          <p>Vuelve pronto: los negocios actualizan su catálogo con frecuencia.</p>
        </div>
      )}

      <div className="grid">
        {products.map((product) => (
          <article key={product.id} className="card product-card">
            {product.photoUrl && (
              <img
                className="product-photo"
                src={product.photoUrl}
                alt={product.name}
                loading="lazy"
              />
            )}
            <div className="product-body">
              <h3>{product.name}</h3>
              {product.description && <p className="meta">{product.description}</p>}
              <Money value={product.priceUsd} />
              <button
                type="button"
                disabled={blocked}
                aria-label={`Agregar ${product.name} al carrito`}
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

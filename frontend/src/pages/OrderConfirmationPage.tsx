import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { shortRef, type Order } from '../api/types';
import { formatUsd } from '../components/Money';
import { StatusBadge } from '../components/StatusBadge';

const ZELLE_EMAIL: string = import.meta.env.VITE_ZELLE_EMAIL ?? 'pagos@nexoo.app';

export function OrderConfirmationPage() {
  const { id = '' } = useParams();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getOrder(id)
      .then((data) => {
        if (!cancelled) setOrder(data);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error)
    return (
      <div className="alert error" role="alert">
        {error}
      </div>
    );
  if (!order)
    return (
      <div aria-busy="true">
        <div className="skeleton" style={{ height: 28, width: '45%', marginBottom: 12 }} />
        <div className="skeleton" style={{ height: 120 }} />
      </div>
    );

  return (
    <>
      <ol className="steps">
        <li>Carrito</li>
        <li>Datos de entrega</li>
        <li className="current">Pago</li>
      </ol>

      <h1 className="page-title">¡Pedido recibido!</h1>
      <p className="page-subtitle">
        Referencia <strong>{shortRef(order.id)}</strong> · <StatusBadge status={order.status} />
      </p>

      <div className="alert info">
        <strong>Completa el pago por Zelle para procesar tu pedido.</strong>
        <ul>
          <li>
            Envía <strong>{formatUsd(order.totalUsd)}</strong> por Zelle a{' '}
            <strong>{ZELLE_EMAIL}</strong>.
          </li>
          <li>
            Escribe la referencia <strong>{shortRef(order.id)}</strong> en la nota del pago.
          </li>
          <li>
            Al confirmar el pago marcamos el pedido como pagado y coordinamos la entrega con{' '}
            {order.businessName}.
          </li>
        </ul>
      </div>

      <div className="card">
        <h3>Detalle del pedido</h3>
        <p className="meta">Negocio: {order.businessName}</p>
        {order.items.map((item) => (
          <div key={item.id} className="cart-line">
            <div className="grow">
              <strong>{item.productName}</strong>
              <p className="meta">
                {item.quantity} × {formatUsd(item.unitPrice)}
              </p>
            </div>
            <strong>{formatUsd(item.quantity * item.unitPrice)}</strong>
          </div>
        ))}
        <div className="summary">
          <span>Total</span>
          <span>{formatUsd(order.totalUsd)}</span>
        </div>
      </div>

      <div className="card" style={{ marginTop: 'var(--space-5)' }}>
        <h3>Entrega en Cuba</h3>
        <p>
          {order.recipientName} · {order.recipientPhone}
          <br />
          {order.recipientProvinceName}, {order.recipientMunicipality}
          <br />
          {order.recipientAddress}
        </p>
      </div>

      <p style={{ marginTop: 'var(--space-5)' }}>
        <Link className="button secondary" to="/">
          Volver al catálogo
        </Link>
      </p>
    </>
  );
}

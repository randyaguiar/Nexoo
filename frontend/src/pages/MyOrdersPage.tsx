import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api } from '../api/client';
import { shortRef, type Order } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { formatUsd } from '../components/Money';
import { StatusBadge } from '../components/StatusBadge';

export function MyOrdersPage() {
  const { user, loading: sessionLoading } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    api
      .auth.listMyOrders()
      .then((data) => {
        if (!cancelled) setOrders(data);
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
  }, [user]);

  if (sessionLoading) return <p className="empty">Cargando…</p>;
  if (!user) return <Navigate to="/entrar" replace state={{ from: '/mis-pedidos' }} />;

  return (
    <>
      <h1 className="page-title">Mis pedidos</h1>
      <p className="page-subtitle">Sesión iniciada como {user.email}</p>

      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}

      {loading && <p className="empty">Cargando pedidos…</p>}

      {!loading && orders.length === 0 && (
        <div className="empty-state">
          <h3>Aún no tienes pedidos</h3>
          <p>Los pedidos que hagas con la sesión iniciada aparecerán aquí.</p>
          <Link className="button" to="/">
            Explorar el catálogo
          </Link>
        </div>
      )}

      {orders.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Referencia</th>
                <th>Negocio</th>
                <th>Fecha</th>
                <th>Total</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td>{shortRef(order.id)}</td>
                  <td>{order.businessName || '—'}</td>
                  <td>{new Date(order.createdAt).toLocaleDateString('es')}</td>
                  <td>{formatUsd(order.totalUsd)}</td>
                  <td>
                    <StatusBadge status={order.status} />
                  </td>
                  <td>
                    <Link to={`/pedido/${order.id}`}>Ver detalle</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

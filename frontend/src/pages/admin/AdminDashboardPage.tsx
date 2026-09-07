import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { formatUsd } from '../../components/Money';
import { StatusBadge } from '../../components/StatusBadge';
import {
  isGlobalRole,
  LOW_STOCK_THRESHOLD,
  ORDER_STATUSES,
  type Business,
  type Order,
  type Product,
} from '../../api/types';

/** Los pedidos cancelados no cuentan como ingreso. */
const isRevenue = (order: Order): boolean => order.status !== 'Cancelled';

export function AdminDashboardPage() {
  const { admin } = useAuth();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [businessId, setBusinessId] = useState<string>(admin?.businessId ?? '');
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const global = admin ? isGlobalRole(admin.role) : false;

  useEffect(() => {
    if (!global) return;
    api.admin
      .listBusinesses()
      .then(setBusinesses)
      .catch((e: Error) => setError(e.message));
  }, [global]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    // Sin negocio seleccionado, un rol global ve el agregado de todos.
    Promise.all([
      api.admin.listOrders(null, businessId || null),
      api.admin.listProducts(businessId || undefined),
    ])
      .then(([orderList, productList]) => {
        if (cancelled) return;
        setOrders(orderList);
        setProducts(productList);
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [businessId]);

  const stats = useMemo(() => {
    const billed = orders.filter(isRevenue);
    const revenue = billed.reduce((sum, o) => sum + o.totalUsd, 0);
    const pending = orders.filter((o) => o.status === 'PendingPayment').length;
    const lowStock = products.filter((p) => p.available && p.stock <= LOW_STOCK_THRESHOLD);

    return {
      revenue,
      orderCount: orders.length,
      pending,
      averageTicket: billed.length > 0 ? revenue / billed.length : 0,
      units: products.reduce((sum, p) => sum + p.stock, 0),
      lowStock,
    };
  }, [orders, products]);

  const byStatus = useMemo(
    () =>
      ORDER_STATUSES.map((status) => ({
        ...status,
        count: orders.filter((o) => o.status === status.value).length,
      })),
    [orders],
  );

  if (loading) return <p className="empty">Cargando dashboard…</p>;

  return (
    <>
      {error && <div className="alert error">{error}</div>}

      <div className="page-toolbar">
        <h3 className="form-title">Resumen</h3>
        {global && (
          <select value={businessId} onChange={(e) => setBusinessId(e.target.value)}>
            <option value="">Todos los negocios</option>
            {businesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-label">Ganancias</span>
          <span className="stat-value">{formatUsd(stats.revenue)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Pedidos</span>
          <span className="stat-value">{stats.orderCount}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Ticket medio</span>
          <span className="stat-value">{formatUsd(stats.averageTicket)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Pendientes de pago</span>
          <span className="stat-value">{stats.pending}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Unidades en inventario</span>
          <span className="stat-value">{stats.units}</span>
        </div>
        <div className={stats.lowStock.length > 0 ? 'stat-card warn' : 'stat-card'}>
          <span className="stat-label">Productos bajo mínimos</span>
          <span className="stat-value">{stats.lowStock.length}</span>
        </div>
      </div>

      <h3 className="form-title">Pedidos por estado</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Estado</th>
              <th>Pedidos</th>
            </tr>
          </thead>
          <tbody>
            {byStatus.map((status) => (
              <tr key={status.value}>
                <td>
                  <StatusBadge status={status.value} />
                </td>
                <td>{status.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="form-title">Inventario bajo mínimos</h3>
      {stats.lowStock.length === 0 ? (
        <p className="empty">Ningún producto disponible está por debajo de {LOW_STOCK_THRESHOLD} unidades.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th>Precio</th>
                <th>Stock</th>
              </tr>
            </thead>
            <tbody>
              {stats.lowStock.map((product) => (
                <tr key={product.id}>
                  <td>{product.name}</td>
                  <td>{formatUsd(product.priceUsd)}</td>
                  <td>{product.stock}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

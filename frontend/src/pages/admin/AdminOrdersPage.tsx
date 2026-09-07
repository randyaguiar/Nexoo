import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import {
  ORDER_STATUSES,
  provinceLabel,
  type Order,
  type OrderStatus,
} from '../../api/types';
import { formatUsd } from '../../components/Money';
import { StatusBadge } from '../../components/StatusBadge';

export function AdminOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [statusFilter, setStatusFilter] = useState<OrderStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (status: OrderStatus | null) => {
    setLoading(true);
    setError(null);
    try {
      setOrders(await api.admin.listOrders(status));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(statusFilter);
  }, [load, statusFilter]);

  const changeStatus = async (order: Order, status: OrderStatus) => {
    try {
      const updated = await api.admin.updateOrderStatus(order.id, status);
      setOrders((current) => current.map((o) => (o.id === updated.id ? updated : o)));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <div className="filters">
        <button
          type="button"
          className={`chip ${statusFilter === null ? 'active' : ''}`}
          onClick={() => setStatusFilter(null)}
        >
          Todos
        </button>
        {ORDER_STATUSES.map((s) => (
          <button
            key={s.value}
            type="button"
            className={`chip ${statusFilter === s.value ? 'active' : ''}`}
            onClick={() => setStatusFilter(s.value)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {error && <div className="alert error">{error}</div>}
      {loading && <p className="empty">Cargando pedidos…</p>}
      {!loading && orders.length === 0 && <p className="empty">No hay pedidos.</p>}

      {orders.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Negocio</th>
                <th>Comprador</th>
                <th>Destinatario</th>
                <th>Productos</th>
                <th>Total</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td>{new Date(order.createdAt).toLocaleString('es-ES')}</td>
                  <td>{order.businessName}</td>
                  <td>
                    {order.buyerName}
                    <br />
                    <span className="meta">
                      {order.buyerEmail}
                      <br />
                      {order.buyerPhone}
                    </span>
                  </td>
                  <td>
                    {order.recipientName}
                    <br />
                    <span className="meta">
                      {order.recipientPhone}
                      <br />
                      {provinceLabel(order.recipientProvince)}, {order.recipientMunicipality}
                      <br />
                      {order.recipientAddress}
                    </span>
                  </td>
                  <td>
                    {order.items.map((item) => (
                      <div key={item.id}>
                        {item.quantity} × {item.productName}
                      </div>
                    ))}
                    {order.notes && <div className="meta">Notas: {order.notes}</div>}
                  </td>
                  <td>{formatUsd(order.totalUsd)}</td>
                  <td>
                    <StatusBadge status={order.status} />
                    <select
                      style={{ marginTop: 6 }}
                      value={order.status}
                      aria-label={`Cambiar estado del pedido de ${order.buyerName}`}
                      onChange={(e) => void changeStatus(order, e.target.value as OrderStatus)}
                    >
                      {ORDER_STATUSES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
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

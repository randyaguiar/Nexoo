import { orderStatusLabel, type OrderStatus } from '../api/types';

export function StatusBadge({ status }: { status: OrderStatus }) {
  return <span className={`status-badge status-${status}`}>{orderStatusLabel(status)}</span>;
}

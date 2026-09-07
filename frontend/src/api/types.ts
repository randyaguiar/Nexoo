export type Province = 'PinarDelRio' | 'LaHabana';

export const PROVINCES: { value: Province; label: string }[] = [
  { value: 'PinarDelRio', label: 'Pinar del Río' },
  { value: 'LaHabana', label: 'La Habana' },
];

export const provinceLabel = (province: Province): string =>
  PROVINCES.find((p) => p.value === province)?.label ?? province;

export type OrderStatus =
  | 'PendingPayment'
  | 'Paid'
  | 'PaidToBusiness'
  | 'Delivered'
  | 'Cancelled';

export const ORDER_STATUSES: { value: OrderStatus; label: string }[] = [
  { value: 'PendingPayment', label: 'Pendiente de pago' },
  { value: 'Paid', label: 'Pagado' },
  { value: 'PaidToBusiness', label: 'Pagado al negocio' },
  { value: 'Delivered', label: 'Entregado' },
  { value: 'Cancelled', label: 'Cancelado' },
];

export const orderStatusLabel = (status: OrderStatus): string =>
  ORDER_STATUSES.find((s) => s.value === status)?.label ?? status;

export interface Business {
  id: string;
  name: string;
  description: string | null;
  province: Province;
  municipality: string;
  contactPhone: string | null;
  active: boolean;
  productCount: number;
}

export interface Product {
  id: string;
  businessId: string;
  name: string;
  description: string | null;
  priceUsd: number;
  photoUrl: string | null;
  available: boolean;
}

export interface BusinessDetail {
  business: Business;
  products: Product[];
}

export interface OrderItem {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
}

export interface Order {
  id: string;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  recipientName: string;
  recipientPhone: string;
  recipientProvince: Province;
  recipientMunicipality: string;
  recipientAddress: string;
  businessId: string;
  businessName: string;
  status: OrderStatus;
  totalUsd: number;
  notes: string | null;
  createdAt: string;
  items: OrderItem[];
}

export interface CreateOrderInput {
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  recipientName: string;
  recipientPhone: string;
  recipientProvince: Province;
  recipientMunicipality: string;
  recipientAddress: string;
  notes?: string;
  items: { productId: string; quantity: number }[];
}

export interface BusinessInput {
  name: string;
  description: string | null;
  province: Province;
  municipality: string;
  contactPhone: string | null;
  active: boolean;
}

export interface ProductInput {
  businessId: string;
  name: string;
  description: string | null;
  priceUsd: number;
  photoUrl: string | null;
  available: boolean;
}

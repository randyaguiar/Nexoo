/** Código de provincia tal como está en la tabla `provinces` (p. ej. 'LaHabana'). */
export type Province = string;

export interface ProvinceRef {
  code: Province;
  name: string;
  active: boolean;
}

export interface Municipality {
  id: string;
  provinceCode: Province;
  name: string;
  active: boolean;
}

export interface Category {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
}

export interface ProvinceInput {
  code: Province;
  name: string;
  active: boolean;
}

export interface MunicipalityInput {
  provinceCode: Province;
  name: string;
  active: boolean;
}

export interface CategoryInput {
  name: string;
  description: string | null;
  active: boolean;
}

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

/** Referencia corta y legible del pedido; la Edge Function del aviso usa la misma. */
export const shortRef = (id: string): string =>
  id.replace(/-/g, '').slice(0, 8).toUpperCase();

export interface Business {
  id: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  province: Province;
  provinceName: string;
  municipalityId: string | null;
  municipality: string;
  categoryId: string | null;
  categoryName: string | null;
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
  recipientProvinceName: string;
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
  logoUrl: string | null;
  /** La provincia y el nombre del municipio se derivan de este id en la base de datos. */
  municipalityId: string;
  categoryId: string | null;
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

export type AdminRole = 'owner' | 'staff';

export const ADMIN_ROLES: { value: AdminRole; label: string }[] = [
  { value: 'owner', label: 'Owner' },
  { value: 'staff', label: 'Staff' },
];

export const adminRoleLabel = (role: AdminRole): string =>
  ADMIN_ROLES.find((r) => r.value === role)?.label ?? role;

export interface AdminUser {
  userId: string;
  email: string;
  role: AdminRole;
  createdAt: string;
}

export interface AdminUserInput {
  email: string;
  /** Vacío: se envía una invitación por email en lugar de fijar la contraseña. */
  password: string;
  role: AdminRole;
}

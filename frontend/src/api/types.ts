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

export interface CategoryRef {
  id: string;
  name: string;
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
  categories: CategoryRef[];
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
  /** Unidades en inventario; el trabajador es quien lo mantiene al día. */
  stock: number;
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

/** Lo que el carrito tiene reservado de un producto frente a lo que pidió. */
export interface CartReservationItem {
  productId: string;
  requested: number;
  reserved: number;
}

export interface CartReservation {
  /** Momento en que la reserva caduca, o null si el carrito está vacío. */
  expiresAt: string | null;
  items: CartReservationItem[];
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
  /** Token del carrito: sus propias reservas no le hacen de tope al confirmar. */
  cartToken?: string;
}

export interface BusinessInput {
  name: string;
  description: string | null;
  logoUrl: string | null;
  /** La provincia y el nombre del municipio se derivan de este id en la base de datos. */
  municipalityId: string;
  /** Un negocio puede ofrecer varios servicios (dulcería, panadería, cafetería…). */
  categoryIds: string[];
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
  stock: number;
}

/** Por debajo de esta cantidad el dashboard marca el producto como bajo de stock. */
export const LOW_STOCK_THRESHOLD = 5;

/**
 * `owner` es el admin general (acceso a todo, incluido el historial); `staff` es
 * el rol global heredado; `business_admin` y `worker` están atados a un negocio.
 */
export type AdminRole = 'owner' | 'staff' | 'business_admin' | 'worker';

export const ADMIN_ROLES: { value: AdminRole; label: string }[] = [
  { value: 'owner', label: 'Admin general' },
  { value: 'staff', label: 'Staff global' },
  { value: 'business_admin', label: 'Admin de negocio' },
  { value: 'worker', label: 'Trabajador' },
];

export const adminRoleLabel = (role: AdminRole): string =>
  ADMIN_ROLES.find((r) => r.value === role)?.label ?? role;

/** Roles que pertenecen a un negocio concreto y solo ven lo suyo. */
export const BUSINESS_SCOPED_ROLES: AdminRole[] = ['business_admin', 'worker'];

export const isBusinessScoped = (role: AdminRole): boolean =>
  BUSINESS_SCOPED_ROLES.includes(role);

/** Acceso global al panel: todos los negocios, la taxonomía y los pedidos. */
export const isGlobalRole = (role: AdminRole): boolean => role === 'owner' || role === 'staff';

export interface AdminUser {
  userId: string;
  email: string;
  role: AdminRole;
  /** Negocio al que pertenece; null en los roles globales. */
  businessId: string | null;
  createdAt: string;
}

export interface AdminUserInput {
  email: string;
  /** Vacío: se envía una invitación por email en lugar de fijar la contraseña. */
  password: string;
  role: AdminRole;
  businessId: string | null;
}

/** Una línea del historial de cambios; solo el admin general puede leerlo. */
export interface ActivityEntry {
  id: number;
  at: string;
  actorEmail: string | null;
  actorRole: AdminRole | null;
  businessId: string | null;
  entity: string;
  entityId: string | null;
  action: 'insert' | 'update' | 'delete';
  changes: Record<string, unknown>;
}

const ACTIVITY_ENTITIES: Record<string, string> = {
  businesses: 'Negocio',
  products: 'Producto',
  orders: 'Pedido',
  admins: 'Usuario del panel',
  categories: 'Categoría',
};

export const activityEntityLabel = (entity: string): string =>
  ACTIVITY_ENTITIES[entity] ?? entity;

export const activityActionLabel = (action: ActivityEntry['action']): string =>
  ({ insert: 'Creación', update: 'Modificación', delete: 'Eliminación' })[action];

/** Perfil del comprador; se guarda en `user_metadata` de Supabase Auth. */
export interface UserProfile {
  fullName: string;
  phone: string;
  /** Recibir por email las actualizaciones de los pedidos. */
  orderEmails: boolean;
}

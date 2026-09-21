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
  /** Hasta tres; la primera es la que sale en la tarjeta del catálogo. */
  photoUrls: string[];
  available: boolean;
  /** Unidades en inventario; el trabajador es quien lo mantiene al día. */
  stock: number;
}

/**
 * Un producto visto desde el panel: incluye el coste y admite no tener precio
 * todavía. El catálogo público nunca los trae, por eso `Product` no es nulable.
 */
export interface ProductPricing extends Omit<Product, 'priceUsd'> {
  /** Null mientras la plataforma no le haya puesto precio: no se vende. */
  priceUsd: number | null;
  businessName: string;
  /** Precio mayorista que declara el negocio. */
  costUsd: number | null;
  /** Precio ajustado a mano: un recálculo masivo no lo pisa salvo que se pida. */
  priceIsManual: boolean;
  /** Margen por defecto del negocio, con el que se calcula el precio sugerido. */
  defaultMarkupPct: number;
}

/** Precio sugerido a partir del coste y el margen; null si no hay coste. */
export const suggestedPrice = (costUsd: number | null, markupPct: number): number | null =>
  costUsd === null ? null : Math.round(costUsd * (1 + markupPct / 100) * 100) / 100;

/** Margen real en porcentaje sobre el coste; null si falta algún dato. */
export const marginPct = (costUsd: number | null, priceUsd: number | null): number | null =>
  costUsd === null || priceUsd === null || costUsd === 0
    ? null
    : ((priceUsd - costUsd) / costUsd) * 100;

export interface BusinessDetail {
  business: Business;
  products: Product[];
}

/** Un producto con el negocio que lo vende: lo que hace falta para su página. */
export interface ProductDetail {
  product: Product;
  business: Business;
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
  /** Solo lo manda un rol global; el negocio lo deja como está. */
  priceUsd: number | null;
  /** El precio mayorista que declara el negocio. */
  costUsd: number | null;
  photoUrls: string[];
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
  business_applications: 'Solicitud de alta',
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

/** Estado de una solicitud de alta de negocio. */
export type BusinessApplicationStatus = 'pending' | 'approved' | 'rejected';

export const BUSINESS_APPLICATION_STATUSES: {
  value: BusinessApplicationStatus;
  label: string;
}[] = [
  { value: 'pending', label: 'Pendiente' },
  { value: 'approved', label: 'Aprobada' },
  { value: 'rejected', label: 'Rechazada' },
];

export const businessApplicationStatusLabel = (status: BusinessApplicationStatus): string =>
  BUSINESS_APPLICATION_STATUSES.find((s) => s.value === status)?.label ?? status;

export interface BusinessApplication {
  id: string;
  userId: string;
  contactEmail: string;
  name: string;
  description: string | null;
  municipalityId: string;
  /** Resueltos por el join; el formulario solo manda el id. */
  municipalityName: string | null;
  provinceName: string | null;
  contactPhone: string;
  categoryIds: string[];
  status: BusinessApplicationStatus;
  /** Motivo del rechazo, o la nota de quien aprobó. */
  reviewNote: string | null;
  reviewedAt: string | null;
  businessId: string | null;
  createdAt: string;
}

export interface BusinessApplicationInput {
  name: string;
  description: string;
  municipalityId: string;
  contactPhone: string;
  categoryIds: string[];
}

/** Por dónde le llega el dinero al negocio. */
export type PayoutMethod = 'zelle_us' | 'cash_cuba' | 'mlc_cuba' | 'transfer_cuba';

export const PAYOUT_METHODS: { value: PayoutMethod; label: string }[] = [
  { value: 'zelle_us', label: 'Zelle (EE.UU.)' },
  { value: 'cash_cuba', label: 'Efectivo en Cuba' },
  { value: 'mlc_cuba', label: 'Tarjeta MLC' },
  { value: 'transfer_cuba', label: 'Transferencia en Cuba' },
];

export const payoutMethodLabel = (method: string): string =>
  PAYOUT_METHODS.find((m) => m.value === method)?.label ?? method;

export interface PayoutAccount {
  businessId: string;
  method: PayoutMethod;
  /** Quien cobra; a menudo un familiar, no el dueño. */
  holderName: string;
  /** Email de Zelle, teléfono o número de tarjeta según el método. */
  contact: string;
  notes: string | null;
}

/** Lo que se le debe a un negocio y aún no se ha agrupado en una liquidación. */
export interface PendingSettlement {
  businessId: string;
  orderCount: number;
  periodStart: string;
  periodEnd: string;
  grossUsd: number;
  costUsd: number;
}

export interface Settlement {
  id: string;
  businessId: string;
  periodStart: string;
  periodEnd: string;
  orderCount: number;
  /** Lo que pagaron los compradores. */
  grossUsd: number;
  /** Lo que se le debe al negocio, con el coste del momento de cada venta. */
  costUsd: number;
  /** El margen de Nexoo, congelado al cerrar. */
  feeUsd: number;
  status: 'pending' | 'paid';
  payoutMethod: string | null;
  payoutCurrency: string;
  /** Unidades de `payoutCurrency` por dólar, si se pagó en otra moneda. */
  fxRate: number | null;
  payoutAmount: number | null;
  reference: string | null;
  notes: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface SettlementPayment {
  method: PayoutMethod;
  reference: string;
  payoutCurrency: string;
  fxRate: number | null;
  payoutAmount: number | null;
  notes: string;
}

/** Fotos por producto; más de tres no aporta y encarece la carga del catálogo. */
export const MAX_PRODUCT_PHOTOS = 3;

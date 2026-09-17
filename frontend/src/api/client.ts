import type { EmailOtpType, PostgrestError } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type {
  ActivityEntry,
  CartReservation,
  AdminRole,
  AdminUser,
  AdminUserInput,
  Business,
  BusinessDetail,
  BusinessInput,
  Category,
  CategoryInput,
  CreateOrderInput,
  Municipality,
  MunicipalityInput,
  Order,
  OrderStatus,
  Product,
  ProductInput,
  Province,
  ProvinceInput,
  ProvinceRef,
  PayoutAccount,
  PendingSettlement,
  ProductPricing,
  Settlement,
  SettlementPayment,
  UserProfile,
} from './types';
import type {
  BusinessApplication,
  BusinessApplicationInput,
  BusinessApplicationStatus,
} from './types';

/**
 * Ruta a la que vuelve el enlace de confirmación del email. Debe estar en
 * Authentication → URL Configuration → Redirect URLs del proyecto de Supabase.
 */
export const EMAIL_CONFIRM_PATH = '/auth/confirmado';

/** Las tablas usan snake_case; la UI trabaja en camelCase. */
interface BusinessRow {
  id: string;
  name: string;
  description: string | null;
  logo_url: string | null;
  province: Province;
  province_name: string | null;
  municipality_id: string | null;
  municipality: string;
  category_ids: string[] | null;
  category_names: string[] | null;
  contact_phone: string | null;
  active: boolean;
}

interface ProductRow {
  id: string;
  business_id: string;
  name: string;
  description: string | null;
  price_usd: number;
  photo_urls: string[] | null;
  available: boolean;
  stock: number | null;
}

/** Fila de `product_pricing`: lo mismo más el coste, que el público no ve. */
interface ProductPricingRow extends Omit<ProductRow, 'price_usd'> {
  price_usd: number | null;
  business_name: string;
  cost_usd: number | null;
  price_is_manual: boolean;
  default_markup_pct: number;
}

const toBusiness = (row: BusinessRow, productCount: number): Business => ({
  id: row.id,
  name: row.name,
  description: row.description,
  logoUrl: row.logo_url,
  province: row.province,
  provinceName: row.province_name ?? row.province,
  municipalityId: row.municipality_id,
  municipality: row.municipality,
  categories: (row.category_ids ?? []).map((id, index) => ({
    id,
    name: row.category_names?.[index] ?? '',
  })),
  contactPhone: row.contact_phone,
  active: row.active,
  productCount,
});

const toProduct = (row: ProductRow): Product => ({
  id: row.id,
  businessId: row.business_id,
  name: row.name,
  description: row.description,
  priceUsd: Number(row.price_usd),
  photoUrls: row.photo_urls ?? [],
  available: row.available,
  stock: Number(row.stock ?? 0),
});

const toProductPricing = (row: ProductPricingRow): ProductPricing => ({
  ...toProduct({ ...row, price_usd: 0 }),
  priceUsd: row.price_usd === null ? null : Number(row.price_usd),
  businessName: row.business_name,
  costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
  priceIsManual: row.price_is_manual,
  defaultMarkupPct: Number(row.default_markup_pct),
});

interface OrderItemRow {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
}

interface OrderRow {
  id: string;
  buyer_name: string;
  buyer_email: string;
  buyer_phone: string;
  recipient_name: string;
  recipient_phone: string;
  recipient_province: Province;
  recipient_municipality: string;
  recipient_address: string;
  business_id: string;
  status: OrderStatus;
  total_usd: number;
  notes: string | null;
  created_at: string;
  businesses: { name: string } | null;
  provinces: { name: string } | null;
  order_items: OrderItemRow[];
}

const toOrder = (row: OrderRow): Order => ({
  id: row.id,
  buyerName: row.buyer_name,
  buyerEmail: row.buyer_email,
  buyerPhone: row.buyer_phone,
  recipientName: row.recipient_name,
  recipientPhone: row.recipient_phone,
  recipientProvince: row.recipient_province,
  recipientProvinceName: row.provinces?.name ?? row.recipient_province,
  recipientMunicipality: row.recipient_municipality,
  recipientAddress: row.recipient_address,
  businessId: row.business_id,
  businessName: row.businesses?.name ?? '',
  status: row.status,
  totalUsd: Number(row.total_usd),
  notes: row.notes,
  createdAt: row.created_at,
  items: row.order_items
    .map((i) => ({
      id: i.id,
      productId: i.product_id,
      productName: i.product_name,
      quantity: i.quantity,
      unitPrice: Number(i.unit_price),
    }))
    .sort((a, b) => a.productName.localeCompare(b.productName, 'es')),
});

/**
 * `price_usd` solo viaja si viene informado: un trigger rechaza que un rol de
 * negocio lo toque, y mandarlo aunque no cambie es pedir un error innecesario.
 */
const toRow = (input: ProductInput) => ({
  business_id: input.businessId,
  name: input.name,
  description: input.description,
  cost_usd: input.costUsd,
  photo_urls: input.photoUrls,
  available: input.available,
  stock: input.stock,
  ...(input.priceUsd === null ? {} : { price_usd: input.priceUsd }),
});

/**
 * save_business() guarda el negocio y sus categorías en una sola transacción;
 * province y municipality los deriva el trigger de municipality_id.
 */
const saveBusiness = async (id: string | null, input: BusinessInput): Promise<void> => {
  const { error } = await supabase.rpc('save_business', {
    p_id: id,
    p_payload: {
      name: input.name,
      description: input.description,
      logoUrl: input.logoUrl,
      municipalityId: input.municipalityId,
      contactPhone: input.contactPhone,
      active: input.active,
    },
    p_category_ids: input.categoryIds,
  });
  if (error) fail(error);
};

interface ProvinceRow {
  code: string;
  name: string;
  active: boolean;
}

interface MunicipalityRow {
  id: string;
  province_code: string;
  name: string;
  active: boolean;
}

interface CategoryRow {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
}

const toCategoryRow = (input: CategoryInput) => ({
  name: input.name,
  description: input.description,
  active: input.active,
});

const toMunicipality = (row: MunicipalityRow): Municipality => ({
  id: row.id,
  provinceCode: row.province_code,
  name: row.name,
  active: row.active,
});

interface AdminRow {
  user_id: string;
  email: string;
  role: AdminRole;
  business_id: string | null;
  created_at: string;
}

const toAdminUser = (row: AdminRow): AdminUser => ({
  userId: row.user_id,
  email: row.email,
  role: row.role,
  businessId: row.business_id,
  createdAt: row.created_at,
});

interface BusinessApplicationRow {
  id: string;
  user_id: string;
  contact_email: string;
  name: string;
  description: string | null;
  municipality_id: string;
  municipalities: { name: string; provinces: { name: string } | null } | null;
  contact_phone: string;
  category_ids: string[] | null;
  status: BusinessApplicationStatus;
  review_note: string | null;
  reviewed_at: string | null;
  business_id: string | null;
  created_at: string;
}

const toBusinessApplication = (row: BusinessApplicationRow): BusinessApplication => ({
  id: row.id,
  userId: row.user_id,
  contactEmail: row.contact_email,
  name: row.name,
  description: row.description,
  municipalityId: row.municipality_id,
  municipalityName: row.municipalities?.name ?? null,
  provinceName: row.municipalities?.provinces?.name ?? null,
  contactPhone: row.contact_phone,
  categoryIds: row.category_ids ?? [],
  status: row.status,
  reviewNote: row.review_note,
  reviewedAt: row.reviewed_at,
  businessId: row.business_id,
  createdAt: row.created_at,
});

interface PendingSettlementRow {
  business_id: string;
  order_count: number;
  period_start: string;
  period_end: string;
  gross_usd: number;
  cost_usd: number;
}

interface PayoutAccountRow {
  business_id: string;
  method: PayoutAccount['method'];
  holder_name: string;
  contact: string;
  notes: string | null;
}

interface SettlementRow {
  id: string;
  business_id: string;
  period_start: string;
  period_end: string;
  order_count: number;
  gross_usd: number;
  cost_usd: number;
  fee_usd: number;
  status: Settlement['status'];
  payout_method: string | null;
  payout_currency: string;
  fx_rate: number | null;
  payout_amount: number | null;
  reference: string | null;
  notes: string | null;
  paid_at: string | null;
  created_at: string;
}

const SETTLEMENT_COLUMNS =
  'id, business_id, period_start, period_end, order_count, gross_usd, cost_usd, fee_usd, ' +
  'status, payout_method, payout_currency, fx_rate, payout_amount, reference, notes, paid_at, created_at';

const toSettlement = (row: SettlementRow): Settlement => ({
  id: row.id,
  businessId: row.business_id,
  periodStart: row.period_start,
  periodEnd: row.period_end,
  orderCount: Number(row.order_count),
  grossUsd: Number(row.gross_usd),
  costUsd: Number(row.cost_usd),
  feeUsd: Number(row.fee_usd),
  status: row.status,
  payoutMethod: row.payout_method,
  payoutCurrency: row.payout_currency,
  fxRate: row.fx_rate === null ? null : Number(row.fx_rate),
  payoutAmount: row.payout_amount === null ? null : Number(row.payout_amount),
  reference: row.reference,
  notes: row.notes,
  paidAt: row.paid_at,
  createdAt: row.created_at,
});

const APPLICATION_COLUMNS =
  'id, user_id, contact_email, name, description, municipality_id, contact_phone, ' +
  'category_ids, status, review_note, reviewed_at, business_id, created_at, ' +
  'municipalities(name, provinces(name))';

const ADMIN_COLUMNS = 'user_id, email, role, business_id, created_at';

interface ActivityRow {
  id: number;
  at: string;
  actor_email: string | null;
  actor_role: AdminRole | null;
  business_id: string | null;
  entity: string;
  entity_id: string | null;
  action: ActivityEntry['action'];
  changes: Record<string, unknown> | null;
}

const toActivityEntry = (row: ActivityRow): ActivityEntry => ({
  id: row.id,
  at: row.at,
  actorEmail: row.actor_email,
  actorRole: row.actor_role,
  businessId: row.business_id,
  entity: row.entity,
  entityId: row.entity_id,
  action: row.action,
  changes: row.changes ?? {},
});

/**
 * Las excepciones de las funciones RPC llegan con el mensaje en español que
 * levanta Postgres; el resto se traduce a un texto genérico.
 */
const AUTH_ERRORS: Record<string, string> = {
  'Invalid login credentials': 'Credenciales inválidas.',
  'User already registered': 'Ya existe una cuenta con ese email.',
  'Email not confirmed': 'Confirma tu email antes de entrar.',
  'Email link is invalid or has expired':
    'El enlace de confirmación no es válido o ya caducó. Pide uno nuevo creando la cuenta otra vez.',
  'Token has expired or is invalid':
    'El enlace de confirmación no es válido o ya caducó. Pide uno nuevo creando la cuenta otra vez.',
};

/** Supabase Auth responde en inglés; se traducen los casos frecuentes. */
const translateAuthError = (message: string): string => AUTH_ERRORS[message] ?? message;

function fail(error: PostgrestError): never {
  throw new Error(error.message || 'No se pudo completar la operación.');
}

/**
 * La Edge Function devuelve el motivo en el cuerpo de la respuesta; supabase-js
 * solo expone "Edge Function returned a non-2xx status code" en error.message.
 */
async function invokeManageAdmins(body: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.functions.invoke('manage-admins', { body });
  if (!error) return;

  const context: unknown = (error as { context?: unknown }).context;
  if (context instanceof Response) {
    const payload = (await context.clone().json().catch(() => null)) as { error?: string } | null;
    if (payload?.error) throw new Error(payload.error);
  }

  // No hubo respuesta: la función no está desplegada, o el navegador cortó la
  // llamada (CORS). El mensaje de supabase-js no dice ninguna de las dos cosas.
  if (error.name === 'FunctionsFetchError') {
    throw new Error(
      'No se pudo contactar con la función manage-admins. Comprueba que está desplegada en Supabase (supabase functions deploy manage-admins).',
    );
  }

  throw new Error(error.message);
}

const BUSINESS_LOGOS_BUCKET = 'business-logos';
const PRODUCT_PHOTOS_BUCKET = 'product-photos';

export const api = {
  async listProvinces(): Promise<ProvinceRef[]> {
    const { data, error } = await supabase
      .from('provinces')
      .select('code, name, active')
      .order('name');

    if (error) fail(error);
    return ((data ?? []) as ProvinceRow[]).map((row) => ({
      code: row.code,
      name: row.name,
      active: row.active,
    }));
  },

  async listMunicipalities(province?: Province | null): Promise<Municipality[]> {
    let query = supabase
      .from('municipalities')
      .select('id, province_code, name, active')
      .order('name');

    if (province) {
      query = query.eq('province_code', province);
    }

    const { data, error } = await query;
    if (error) fail(error);
    return ((data ?? []) as MunicipalityRow[]).map(toMunicipality);
  },

  async listCategories(): Promise<Category[]> {
    const { data, error } = await supabase
      .from('categories')
      .select('id, name, description, active')
      .order('name');

    if (error) fail(error);
    return (data ?? []) as CategoryRow[];
  },

  async listBusinesses(
    province?: Province | null,
    categoryId?: string | null,
  ): Promise<Business[]> {
    let query = supabase
      .from('business_catalog')
      .select(
        'id, name, description, logo_url, province, province_name, municipality_id, municipality, category_ids, category_names, contact_phone, active, product_count',
      )
      .eq('active', true)
      .order('name');

    if (province) {
      query = query.eq('province', province);
    }

    if (categoryId) {
      query = query.contains('category_ids', [categoryId]);
    }

    const { data, error } = await query;
    if (error) fail(error);

    return (data ?? []).map((row) => toBusiness(row as BusinessRow, Number(row.product_count)));
  },

  async getBusiness(id: string): Promise<BusinessDetail> {
    const { data, error } = await supabase
      .from('business_catalog')
      .select('id, name, description, logo_url, province, province_name, municipality_id, municipality, category_ids, category_names, contact_phone, active, product_count')
      .eq('id', id)
      .maybeSingle();

    if (error) fail(error);
    if (!data) throw new Error('Negocio no encontrado.');

    // product_catalog en lugar de products: el comprador debe ver el stock libre,
    // sin las unidades que otros carritos tienen reservadas.
    const { data: productRows, error: productsError } = await supabase
      .from('product_catalog')
      .select('*')
      .eq('business_id', id)
      .order('name');

    if (productsError) fail(productsError);

    const products = ((productRows ?? []) as ProductRow[]).map(toProduct);

    return { business: toBusiness(data as unknown as BusinessRow, products.length), products };
  },

  /**
   * Abre la pasarela y devuelve la URL a la que mandar al comprador. El importe
   * lo calcula la función desde la base de datos: aquí solo viaja el id.
   */
  async createCheckoutSession(orderId: string): Promise<string> {
    const { data, error } = await supabase.functions.invoke('create-checkout-session', {
      body: { orderId },
    });

    if (error) {
      const context: unknown = (error as { context?: unknown }).context;
      if (context instanceof Response) {
        const payload = (await context.clone().json().catch(() => null)) as
          | { error?: string }
          | null;
        if (payload?.error) throw new Error(payload.error);
      }
      throw new Error('No se pudo abrir la pasarela de pago.');
    }

    const url = (data as { url?: string } | null)?.url;
    if (!url) throw new Error('No se pudo abrir la pasarela de pago.');
    return url;
  },

  async createOrder(input: CreateOrderInput): Promise<{ id: string }> {
    // El total y los precios los calcula create_order() en la base de datos.
    const { data, error } = await supabase.rpc('create_order', { payload: input });
    if (error) fail(error);
    return { id: data as string };
  },

  /**
   * Deja las reservas del carrito igual a su contenido y renueva la caducidad.
   * Con la lista vacía suelta lo que tuviera reservado.
   */
  async reserveCart(
    cartToken: string,
    items: { productId: string; quantity: number }[],
  ): Promise<CartReservation> {
    const { data, error } = await supabase.rpc('reserve_cart', {
      p_cart_token: cartToken,
      p_items: items,
    });
    if (error) fail(error);
    return data as CartReservation;
  },

  async getOrder(id: string): Promise<Order> {
    const { data, error } = await supabase.rpc('get_order', { p_order_id: id });
    if (error) fail(error);
    if (!data) throw new Error('Pedido no encontrado.');
    return data as Order;
  },

  auth: {
    /**
     * Devuelve true si la cuenta queda lista para usarse. Con la confirmación de
     * email activada en Supabase, el usuario debe abrir el enlace antes de entrar.
     */
    async register(email: string, password: string): Promise<{ needsConfirmation: boolean }> {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        // Sin esto el enlace del correo vuelve al Site URL del proyecto, que por
        // defecto es http://localhost:3000 y no lleva a ninguna parte.
        options: { emailRedirectTo: `${window.location.origin}${EMAIL_CONFIRM_PATH}` },
      });
      if (error) throw new Error(translateAuthError(error.message));
      return { needsConfirmation: data.session === null };
    },

    /**
     * Canjea el `token_hash` del enlace de confirmación. Solo hace falta con la
     * plantilla de correo que usa `{{ .TokenHash }}`; con la de por defecto la
     * sesión ya llega en el hash de la URL y supabase-js la lee al arrancar.
     */
    async confirmEmail(tokenHash: string, type: EmailOtpType): Promise<void> {
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
      if (error) throw new Error(translateAuthError(error.message));
    },

    async login(email: string, password: string): Promise<void> {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw new Error(translateAuthError(error.message));
    },

    async logout(): Promise<void> {
      await supabase.auth.signOut();
    },

    /** Guarda el perfil en `user_metadata`; no hay tabla propia de compradores. */
    async updateProfile(profile: UserProfile): Promise<void> {
      const { error } = await supabase.auth.updateUser({
        data: {
          full_name: profile.fullName.trim(),
          phone: profile.phone.trim(),
          order_emails: profile.orderEmails,
        },
      });
      if (error) throw new Error(translateAuthError(error.message));
    },

    async updatePassword(password: string): Promise<void> {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw new Error(translateAuthError(error.message));
    },

    /** Los pedidos hechos con la sesión iniciada; los anónimos no aparecen aquí. */
    async listMyOrders(): Promise<Order[]> {
      const { data, error } = await supabase
        .from('orders')
        .select('*, businesses(name), provinces(name), order_items(*)')
        .order('created_at', { ascending: false });

      if (error) fail(error);
      return ((data ?? []) as unknown as OrderRow[]).map(toOrder);
    },
  },

  /**
   * Alta de negocios. Solicita quien ya tiene cuenta de comprador; un rol global
   * resuelve. Aprobar crea el negocio y al business_admin en una sola llamada.
   */
  businessApplications: {
    async submit(input: BusinessApplicationInput): Promise<void> {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error('Entra con tu cuenta para solicitar el alta.');

      const { error } = await supabase.from('business_applications').insert({
        user_id: auth.user.id,
        contact_email: auth.user.email,
        name: input.name.trim(),
        description: input.description.trim() || null,
        municipality_id: input.municipalityId,
        contact_phone: input.contactPhone.trim(),
        category_ids: input.categoryIds,
      });

      if (error) {
        // El índice parcial impide una segunda solicitud viva por persona.
        if (error.code === '23505') {
          throw new Error('Ya tienes una solicitud pendiente de revisión.');
        }
        fail(error);
      }
    },

    /** La última solicitud de la sesión, o null si nunca ha mandado ninguna. */
    async mine(): Promise<BusinessApplication | null> {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return null;

      const { data, error } = await supabase
        .from('business_applications')
        .select(APPLICATION_COLUMNS)
        .eq('user_id', auth.user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) fail(error);
      return data ? toBusinessApplication(data as unknown as BusinessApplicationRow) : null;
    },

    async list(status?: BusinessApplicationStatus | null): Promise<BusinessApplication[]> {
      let query = supabase
        .from('business_applications')
        .select(APPLICATION_COLUMNS)
        .order('created_at', { ascending: false });

      if (status) query = query.eq('status', status);

      const { data, error } = await query;
      if (error) fail(error);
      return ((data ?? []) as unknown as BusinessApplicationRow[]).map(toBusinessApplication);
    },

    async approve(id: string, note?: string): Promise<void> {
      const { error } = await supabase.rpc('approve_business_application', {
        p_id: id,
        p_note: note?.trim() || null,
      });
      if (error) throw new Error(error.message);
    },

    async reject(id: string, note: string): Promise<void> {
      const { error } = await supabase.rpc('reject_business_application', {
        p_id: id,
        p_note: note,
      });
      if (error) throw new Error(error.message);
    },
  },

  /**
   * Liquidaciones: lo que se le debe a cada negocio y lo que ya se le pagó.
   * Un pedido entra en una sola liquidación; la marca es `orders.settlement_id`.
   */
  settlements: {
    /** Lo pendiente por negocio. Un negocio solo ve su propia fila. */
    async pending(): Promise<PendingSettlement[]> {
      const { data, error } = await supabase
        .from('pending_settlements')
        .select('business_id, order_count, period_start, period_end, gross_usd, cost_usd');

      if (error) fail(error);
      return ((data ?? []) as PendingSettlementRow[]).map((row) => ({
        businessId: row.business_id,
        orderCount: Number(row.order_count),
        periodStart: row.period_start,
        periodEnd: row.period_end,
        grossUsd: Number(row.gross_usd),
        costUsd: Number(row.cost_usd),
      }));
    },

    async list(businessId?: string | null): Promise<Settlement[]> {
      let query = supabase
        .from('settlements')
        .select(SETTLEMENT_COLUMNS)
        .order('created_at', { ascending: false });

      if (businessId) query = query.eq('business_id', businessId);

      const { data, error } = await query;
      if (error) fail(error);
      return ((data ?? []) as unknown as SettlementRow[]).map(toSettlement);
    },

    async create(businessId: string): Promise<string> {
      const { data, error } = await supabase.rpc('create_settlement', {
        p_business_id: businessId,
      });
      if (error) throw new Error(error.message);
      return data as string;
    },

    async markPaid(id: string, payment: SettlementPayment): Promise<void> {
      const { error } = await supabase.rpc('mark_settlement_paid', {
        p_id: id,
        p_method: payment.method,
        p_reference: payment.reference.trim() || null,
        p_payout_currency: payment.payoutCurrency.trim().toUpperCase() || 'USD',
        p_fx_rate: payment.fxRate,
        p_payout_amount: payment.payoutAmount,
        p_notes: payment.notes.trim() || null,
      });
      if (error) throw new Error(error.message);
    },

    async payoutAccounts(): Promise<PayoutAccount[]> {
      const { data, error } = await supabase
        .from('business_payout_accounts')
        .select('business_id, method, holder_name, contact, notes');

      if (error) fail(error);
      return ((data ?? []) as PayoutAccountRow[]).map((row) => ({
        businessId: row.business_id,
        method: row.method,
        holderName: row.holder_name,
        contact: row.contact,
        notes: row.notes,
      }));
    },

    async savePayoutAccount(account: PayoutAccount): Promise<void> {
      const { error } = await supabase.from('business_payout_accounts').upsert({
        business_id: account.businessId,
        method: account.method,
        holder_name: account.holderName.trim(),
        contact: account.contact.trim(),
        notes: account.notes?.trim() || null,
      });
      if (error) fail(error);
    },
  },

  admin: {
    async listBusinesses(): Promise<Business[]> {
      const { data, error } = await supabase
        .from('business_catalog')
        .select('id, name, description, logo_url, province, province_name, municipality_id, municipality, category_ids, category_names, contact_phone, active, product_count')
        .order('name');

      if (error) fail(error);

      return (data ?? []).map((row) =>
        toBusiness(row as unknown as BusinessRow, Number(row.product_count)),
      );
    },

    async createProvince(input: ProvinceInput): Promise<void> {
      const { error } = await supabase
        .from('provinces')
        .insert({ code: input.code, name: input.name, active: input.active });
      if (error) fail(error);
    },

    async updateProvince(code: string, input: ProvinceInput): Promise<void> {
      const { error } = await supabase
        .from('provinces')
        .update({ code: input.code, name: input.name, active: input.active })
        .eq('code', code);
      if (error) fail(error);
    },

    /** Si la provincia ya tiene negocios o pedidos, la FK impide borrarla. */
    async deleteProvince(code: string): Promise<void> {
      const { error } = await supabase.from('provinces').delete().eq('code', code);
      if (error) {
        if (error.code === '23503') {
          throw new Error(
            'La provincia tiene negocios o pedidos asociados. Desactívala en lugar de borrarla.',
          );
        }
        fail(error);
      }
    },

    async createMunicipality(input: MunicipalityInput): Promise<void> {
      const { error } = await supabase
        .from('municipalities')
        .insert({ province_code: input.provinceCode, name: input.name, active: input.active });
      if (error) fail(error);
    },

    async updateMunicipality(id: string, input: MunicipalityInput): Promise<void> {
      const { error } = await supabase
        .from('municipalities')
        .update({ province_code: input.provinceCode, name: input.name, active: input.active })
        .eq('id', id);
      if (error) fail(error);
    },

    async deleteMunicipality(id: string): Promise<void> {
      const { error } = await supabase.from('municipalities').delete().eq('id', id);
      if (error) {
        if (error.code === '23503') {
          throw new Error(
            'El municipio tiene negocios asociados. Desactívalo en lugar de borrarlo.',
          );
        }
        fail(error);
      }
    },

    async createCategory(input: CategoryInput): Promise<void> {
      const { error } = await supabase.from('categories').insert(toCategoryRow(input));
      if (error) fail(error);
    },

    async updateCategory(id: string, input: CategoryInput): Promise<void> {
      const { error } = await supabase.from('categories').update(toCategoryRow(input)).eq('id', id);
      if (error) fail(error);
    },

    /** Los negocios de la categoría quedan sin categoría (on delete set null). */
    async deleteCategory(id: string): Promise<void> {
      const { error } = await supabase.from('categories').delete().eq('id', id);
      if (error) fail(error);
    },

    /**
     * Sube el logo al bucket público `business-logos` y devuelve su URL.
     * El nombre incluye un aleatorio para no pisar logos de otros negocios.
     */
    async uploadBusinessLogo(file: File): Promise<string> {
      const extension = file.name.split('.').pop()?.toLowerCase() ?? 'png';
      const path = `${crypto.randomUUID()}.${extension}`;

      const { error } = await supabase.storage
        .from(BUSINESS_LOGOS_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw new Error(error.message);

      const { data } = supabase.storage.from(BUSINESS_LOGOS_BUCKET).getPublicUrl(path);
      return data.publicUrl;
    },

    async createBusiness(input: BusinessInput): Promise<void> {
      await saveBusiness(null, input);
    },

    async updateBusiness(id: string, input: BusinessInput): Promise<void> {
      await saveBusiness(id, input);
    },

    /** Si el negocio tiene pedidos, la FK impide borrarlo y se desactiva en su lugar. */
    async deleteBusiness(id: string): Promise<{ deactivated: boolean }> {
      const { error } = await supabase.from('businesses').delete().eq('id', id);
      if (!error) return { deactivated: false };

      if (error.code !== '23503') fail(error);

      const { error: deactivateError } = await supabase
        .from('businesses')
        .update({ active: false })
        .eq('id', id);
      if (deactivateError) fail(deactivateError);

      return { deactivated: true };
    },

    /**
     * `product_pricing` en lugar de `products`: el coste está cerrado por
     * columna para todo el mundo y solo se lee por esa vista, que además ya
     * filtra por el negocio al que pertenece la sesión.
     */
    async listProducts(businessId?: string): Promise<ProductPricing[]> {
      let query = supabase.from('product_pricing').select('*').order('name');
      if (businessId) {
        query = query.eq('business_id', businessId);
      }

      const { data, error } = await query;
      if (error) fail(error);
      return (data ?? []).map((row) => toProductPricing(row as ProductPricingRow));
    },

    /**
     * Sube una foto de producto y devuelve su URL. La carpeta es el uuid del
     * negocio: la policy del bucket compara ese primer tramo de la ruta con el
     * negocio de la sesión, así que nadie escribe en la carpeta de otro.
     */
    async uploadProductPhoto(businessId: string, file: File): Promise<string> {
      const extension = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
      const path = `${businessId}/${crypto.randomUUID()}.${extension}`;

      const { error } = await supabase.storage
        .from(PRODUCT_PHOTOS_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw new Error(error.message);

      const { data } = supabase.storage.from(PRODUCT_PHOTOS_BUCKET).getPublicUrl(path);
      return data.publicUrl;
    },

    async createProduct(input: ProductInput): Promise<void> {
      const { error } = await supabase.from('products').insert(toRow(input));
      if (error) fail(error);
    },

    async updateProduct(id: string, input: ProductInput): Promise<void> {
      const { error } = await supabase.from('products').update(toRow(input)).eq('id', id);
      if (error) fail(error);
    },

    /** Si el producto aparece en algún pedido se marca no disponible en vez de borrarse. */
    async deleteProduct(id: string): Promise<{ deactivated: boolean }> {
      const { error } = await supabase.from('products').delete().eq('id', id);
      if (!error) return { deactivated: false };

      if (error.code !== '23503') fail(error);

      const { error: deactivateError } = await supabase
        .from('products')
        .update({ available: false })
        .eq('id', id);
      if (deactivateError) fail(deactivateError);

      return { deactivated: true };
    },

    /** Precio público de un producto suelto; queda marcado como manual. */
    async setProductPrice(productId: string, priceUsd: number | null): Promise<void> {
      const { error } = await supabase.rpc('set_product_price', {
        p_product_id: productId,
        p_price_usd: priceUsd,
      });
      if (error) throw new Error(error.message);
    },

    /**
     * Recalcula precios desde el coste. Sin `businessId` alcanza a todo el
     * marketplace. Devuelve cuántos productos cambiaron.
     */
    async applyMarkup(
      markupPct: number,
      businessId?: string | null,
      overwriteManual = false,
    ): Promise<number> {
      const { data, error } = await supabase.rpc('apply_markup', {
        p_markup_pct: markupPct,
        p_business_id: businessId ?? null,
        p_overwrite_manual: overwriteManual,
      });
      if (error) throw new Error(error.message);
      return Number(data ?? 0);
    },

    async listOrders(status?: OrderStatus | null, businessId?: string | null): Promise<Order[]> {
      let query = supabase
        .from('orders')
        .select('*, businesses(name), provinces(name), order_items(*)')
        .order('created_at', { ascending: false });

      if (status) {
        query = query.eq('status', status);
      }

      if (businessId) {
        query = query.eq('business_id', businessId);
      }

      const { data, error } = await query;
      if (error) fail(error);

      return ((data ?? []) as unknown as OrderRow[]).map(toOrder);
    },

    async updateOrderStatus(id: string, status: OrderStatus): Promise<void> {
      const { error } = await supabase.from('orders').update({ status }).eq('id', id);
      if (error) fail(error);
    },

    async currentAdmin(): Promise<AdminUser | null> {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return null;

      const { data, error } = await supabase
        .from('admins')
        .select(ADMIN_COLUMNS)
        .eq('user_id', auth.user.id)
        .maybeSingle();

      if (error) fail(error);
      return data ? toAdminUser(data as AdminRow) : null;
    },

    async listUsers(): Promise<AdminUser[]> {
      const { data, error } = await supabase
        .from('admins')
        .select(ADMIN_COLUMNS)
        .order('created_at');

      if (error) fail(error);
      return ((data ?? []) as AdminRow[]).map(toAdminUser);
    },

    /** Sin contraseña, Supabase envía una invitación al email. */
    async inviteUser(input: AdminUserInput): Promise<void> {
      await invokeManageAdmins({
        action: 'invite',
        email: input.email,
        password: input.password || undefined,
        role: input.role,
        businessId: input.businessId,
      });
    },

    async setUserRole(
      userId: string,
      role: AdminRole,
      businessId: string | null = null,
    ): Promise<void> {
      await invokeManageAdmins({ action: 'setRole', userId, role, businessId });
    },

    /** Revoca el acceso al panel; el usuario de auth se conserva. */
    async removeUser(userId: string): Promise<void> {
      await invokeManageAdmins({ action: 'remove', userId });
    },

    /**
     * Historial de cambios. La policy solo se lo sirve al admin general, así que
     * para el resto de roles llega vacío.
     */
    async listActivity(
      filters: { businessId?: string | null; entity?: string | null } = {},
      limit = 200,
    ): Promise<ActivityEntry[]> {
      let query = supabase
        .from('activity_log')
        .select('id, at, actor_email, actor_role, business_id, entity, entity_id, action, changes')
        .order('at', { ascending: false })
        .limit(limit);

      if (filters.businessId) query = query.eq('business_id', filters.businessId);
      if (filters.entity) query = query.eq('entity', filters.entity);

      const { data, error } = await query;
      if (error) fail(error);
      return ((data ?? []) as ActivityRow[]).map(toActivityEntry);
    },
  },
};

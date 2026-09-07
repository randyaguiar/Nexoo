import type { PostgrestError } from '@supabase/supabase-js';
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
  UserProfile,
} from './types';

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
  photo_url: string | null;
  available: boolean;
  stock: number | null;
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
  photoUrl: row.photo_url,
  available: row.available,
  stock: Number(row.stock ?? 0),
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

const toRow = (input: ProductInput) => ({
  business_id: input.businessId,
  name: input.name,
  description: input.description,
  price_usd: input.priceUsd,
  photo_url: input.photoUrl,
  available: input.available,
  stock: input.stock,
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
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw new Error(translateAuthError(error.message));
      return { needsConfirmation: data.session === null };
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

    async listProducts(businessId?: string): Promise<Product[]> {
      let query = supabase.from('products').select('*').order('name');
      if (businessId) {
        query = query.eq('business_id', businessId);
      }

      const { data, error } = await query;
      if (error) fail(error);
      return (data ?? []).map((row) => toProduct(row as ProductRow));
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

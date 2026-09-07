import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type {
  AdminRole,
  AdminUser,
  AdminUserInput,
  Business,
  BusinessDetail,
  BusinessInput,
  CreateOrderInput,
  Order,
  OrderStatus,
  Product,
  ProductInput,
  Province,
} from './types';

/** Las tablas usan snake_case; la UI trabaja en camelCase. */
interface BusinessRow {
  id: string;
  name: string;
  description: string | null;
  province: Province;
  municipality: string;
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
}

const toBusiness = (row: BusinessRow, productCount: number): Business => ({
  id: row.id,
  name: row.name,
  description: row.description,
  province: row.province,
  municipality: row.municipality,
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
});

const toBusinessRow = (input: BusinessInput) => ({
  name: input.name,
  description: input.description,
  province: input.province,
  municipality: input.municipality,
  contact_phone: input.contactPhone,
  active: input.active,
});

interface AdminRow {
  user_id: string;
  email: string;
  role: AdminRole;
  created_at: string;
}

const toAdminUser = (row: AdminRow): AdminUser => ({
  userId: row.user_id,
  email: row.email,
  role: row.role,
  createdAt: row.created_at,
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

  throw new Error(error.message);
}

export const api = {
  async listBusinesses(province?: Province | null): Promise<Business[]> {
    let query = supabase
      .from('business_catalog')
      .select('id, name, description, province, municipality, contact_phone, active, product_count')
      .eq('active', true)
      .order('name');

    if (province) {
      query = query.eq('province', province);
    }

    const { data, error } = await query;
    if (error) fail(error);

    return (data ?? []).map((row) => toBusiness(row as BusinessRow, Number(row.product_count)));
  },

  async getBusiness(id: string): Promise<BusinessDetail> {
    const { data, error } = await supabase
      .from('businesses')
      .select(
        'id, name, description, province, municipality, contact_phone, active, products(*)',
      )
      .eq('id', id)
      .maybeSingle();

    if (error) fail(error);
    if (!data) throw new Error('Negocio no encontrado.');

    const products = ((data.products ?? []) as ProductRow[])
      .map(toProduct)
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));

    return { business: toBusiness(data as unknown as BusinessRow, products.length), products };
  },

  async createOrder(input: CreateOrderInput): Promise<{ id: string }> {
    // El total y los precios los calcula create_order() en la base de datos.
    const { data, error } = await supabase.rpc('create_order', { payload: input });
    if (error) fail(error);
    return { id: data as string };
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

    /** Los pedidos hechos con la sesión iniciada; los anónimos no aparecen aquí. */
    async listMyOrders(): Promise<Order[]> {
      const { data, error } = await supabase
        .from('orders')
        .select('*, businesses(name), order_items(*)')
        .order('created_at', { ascending: false });

      if (error) fail(error);
      return ((data ?? []) as unknown as OrderRow[]).map(toOrder);
    },
  },

  admin: {
    async listBusinesses(): Promise<Business[]> {
      const { data, error } = await supabase
        .from('businesses')
        .select(
          'id, name, description, province, municipality, contact_phone, active, products(count)',
        )
        .order('name');

      if (error) fail(error);

      return (data ?? []).map((row) => {
        const counts = row.products as unknown as { count: number }[] | null;
        return toBusiness(row as unknown as BusinessRow, counts?.[0]?.count ?? 0);
      });
    },

    async createBusiness(input: BusinessInput): Promise<void> {
      const { error } = await supabase.from('businesses').insert(toBusinessRow(input));
      if (error) fail(error);
    },

    async updateBusiness(id: string, input: BusinessInput): Promise<void> {
      const { error } = await supabase.from('businesses').update(toBusinessRow(input)).eq('id', id);
      if (error) fail(error);
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

    async listOrders(status?: OrderStatus | null): Promise<Order[]> {
      let query = supabase
        .from('orders')
        .select('*, businesses(name), order_items(*)')
        .order('created_at', { ascending: false });

      if (status) {
        query = query.eq('status', status);
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
        .select('user_id, email, role, created_at')
        .eq('user_id', auth.user.id)
        .maybeSingle();

      if (error) fail(error);
      return data ? toAdminUser(data as AdminRow) : null;
    },

    async listUsers(): Promise<AdminUser[]> {
      const { data, error } = await supabase
        .from('admins')
        .select('user_id, email, role, created_at')
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
      });
    },

    async setUserRole(userId: string, role: AdminRole): Promise<void> {
      await invokeManageAdmins({ action: 'setRole', userId, role });
    },

    /** Revoca el acceso al panel; el usuario de auth se conserva. */
    async removeUser(userId: string): Promise<void> {
      await invokeManageAdmins({ action: 'remove', userId });
    },
  },
};

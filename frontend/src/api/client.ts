import type {
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

const BASE_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:5080';

const TOKEN_KEY = 'nexoo.admin.token';

export const adminToken = {
  get: (): string | null => localStorage.getItem(TOKEN_KEY),
  set: (token: string): void => localStorage.setItem(TOKEN_KEY, token),
  clear: (): void => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = false } = options;
  const headers: Record<string, string> = {};

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (auth) {
    const token = adminToken.get();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 401 && auth) {
    adminToken.clear();
    throw new ApiError('Sesión expirada. Inicia sesión de nuevo.', 401);
  }

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as {
      error?: string;
      title?: string;
      errors?: Record<string, string[]>;
    };

    if (payload.errors) {
      const first = Object.values(payload.errors)[0];
      if (first?.length) {
        return first[0];
      }
    }

    return payload.error ?? payload.title ?? `Error ${response.status}`;
  } catch {
    return `Error ${response.status}`;
  }
}

export const api = {
  listBusinesses: (province?: Province | null) =>
    request<Business[]>(`/api/catalog/businesses${province ? `?province=${province}` : ''}`),

  getBusiness: (id: string) => request<BusinessDetail>(`/api/catalog/businesses/${id}`),

  createOrder: (input: CreateOrderInput) =>
    request<Order>('/api/orders', { method: 'POST', body: input }),

  getOrder: (id: string) => request<Order>(`/api/orders/${id}`),

  admin: {
    login: (email: string, password: string) =>
      request<{ token: string; expiresAt: string }>('/api/admin/login', {
        method: 'POST',
        body: { email, password },
      }),

    listBusinesses: () => request<Business[]>('/api/admin/businesses', { auth: true }),

    createBusiness: (input: BusinessInput) =>
      request<Business>('/api/admin/businesses', { method: 'POST', body: input, auth: true }),

    updateBusiness: (id: string, input: BusinessInput) =>
      request<Business>(`/api/admin/businesses/${id}`, { method: 'PUT', body: input, auth: true }),

    deleteBusiness: (id: string) =>
      request<void>(`/api/admin/businesses/${id}`, { method: 'DELETE', auth: true }),

    listProducts: (businessId?: string) =>
      request<Product[]>(`/api/admin/products${businessId ? `?businessId=${businessId}` : ''}`, {
        auth: true,
      }),

    createProduct: (input: ProductInput) =>
      request<Product>('/api/admin/products', { method: 'POST', body: input, auth: true }),

    updateProduct: (id: string, input: ProductInput) =>
      request<Product>(`/api/admin/products/${id}`, { method: 'PUT', body: input, auth: true }),

    deleteProduct: (id: string) =>
      request<void>(`/api/admin/products/${id}`, { method: 'DELETE', auth: true }),

    listOrders: (status?: OrderStatus | null) =>
      request<Order[]>(`/api/admin/orders${status ? `?status=${status}` : ''}`, { auth: true }),

    updateOrderStatus: (id: string, status: OrderStatus) =>
      request<Order>(`/api/admin/orders/${id}/status`, {
        method: 'PUT',
        body: { status },
        auth: true,
      }),
  },
};

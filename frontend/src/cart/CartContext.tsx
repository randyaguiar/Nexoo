import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from '../api/client';
import type { Business, CartReservation, Product } from '../api/types';

export interface CartLine {
  product: Product;
  quantity: number;
}

interface CartState {
  businessId: string | null;
  businessName: string | null;
  lines: CartLine[];
}

/** Una línea cuyo producto no tenía unidades suficientes para reservarse entera. */
export interface CartShortage {
  productId: string;
  productName: string;
  requested: number;
  reserved: number;
}

interface CartContextValue extends CartState {
  itemCount: number;
  total: number;
  /** Identifica al carrito ante la reserva de stock; el comprador puede no tener cuenta. */
  cartToken: string;
  /** Última respuesta de la reserva, o null si aún no se ha hecho ninguna. */
  reservation: CartReservation | null;
  /** Productos de los que no quedaban unidades para todo lo que hay en el carrito. */
  shortages: CartShortage[];
  /**
   * Adds a product. A cart is limited to a single business because each business
   * is paid separately; adding from another business requires clearing the cart first.
   */
  addProduct: (product: Product, business: Business, quantity?: number) => void;
  setQuantity: (productId: string, quantity: number) => void;
  removeProduct: (productId: string) => void;
  clear: () => void;
  canAddFrom: (businessId: string) => boolean;
}

const STORAGE_KEY = 'nexoo.cart';
const TOKEN_KEY = 'nexoo.cart.token';

/** El token vive en el navegador y sobrevive a vaciar el carrito. */
function loadToken(): string {
  try {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (stored) return stored;

    const created = crypto.randomUUID();
    localStorage.setItem(TOKEN_KEY, created);
    return created;
  } catch {
    // Sin storage (modo privado) el token dura lo que la pestaña: la reserva
    // sigue funcionando, solo que no se reaprovecha entre recargas.
    return crypto.randomUUID();
  }
}

const emptyCart: CartState = { businessId: null, businessName: null, lines: [] };

function loadCart(): CartState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CartState) : emptyCart;
  } catch {
    return emptyCart;
  }
}

function persist(state: CartState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage is a convenience only; ignore quota/private-mode failures.
  }
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CartState>(loadCart);
  const [cartToken] = useState<string>(loadToken);
  const [reservation, setReservation] = useState<CartReservation | null>(null);

  // La reserva se renueva con cada cambio del carrito. La clave evita repetirla
  // cuando cambia el estado sin cambiar lo que hay que reservar.
  const lines = state.lines;
  const linesKey = lines.map((l) => `${l.product.id}:${l.quantity}`).join(',');

  useEffect(() => {
    const items = lines.map((l) => ({ productId: l.product.id, quantity: l.quantity }));

    // Se espera un momento para no reservar en cada pulsación del selector de cantidad.
    const timer = setTimeout(() => {
      api
        .reserveCart(cartToken, items)
        .then(setReservation)
        // Si la reserva falla, el carrito sigue siendo usable: el stock se
        // vuelve a comprobar al confirmar el pedido.
        .catch(() => setReservation(null));
    }, 400);

    return () => clearTimeout(timer);
    // linesKey, no `lines`: el array se recrea en cada render aunque no cambie
    // lo que hay que reservar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartToken, linesKey]);

  const update = useCallback((next: CartState) => {
    persist(next);
    setState(next);
  }, []);

  const addProduct = useCallback(
    (product: Product, business: Business, quantity = 1) => {
      setState((current) => {
        const base =
          current.businessId && current.businessId !== business.id ? emptyCart : current;

        const existing = base.lines.find((l) => l.product.id === product.id);
        const lines = existing
          ? base.lines.map((l) =>
              l.product.id === product.id ? { ...l, quantity: l.quantity + quantity } : l,
            )
          : [...base.lines, { product, quantity }];

        const next: CartState = {
          businessId: business.id,
          businessName: business.name,
          lines,
        };
        persist(next);
        return next;
      });
    },
    [],
  );

  const setQuantity = useCallback((productId: string, quantity: number) => {
    setState((current) => {
      const lines =
        quantity <= 0
          ? current.lines.filter((l) => l.product.id !== productId)
          : current.lines.map((l) => (l.product.id === productId ? { ...l, quantity } : l));

      const next = lines.length ? { ...current, lines } : emptyCart;
      persist(next);
      return next;
    });
  }, []);

  const removeProduct = useCallback(
    (productId: string) => setQuantity(productId, 0),
    [setQuantity],
  );

  const clear = useCallback(() => update(emptyCart), [update]);

  const shortages = useMemo<CartShortage[]>(
    () =>
      (reservation?.items ?? [])
        .filter((item) => item.reserved < item.requested)
        .map((item) => ({
          productId: item.productId,
          productName:
            state.lines.find((l) => l.product.id === item.productId)?.product.name ?? '',
          requested: item.requested,
          reserved: item.reserved,
        })),
    [reservation, state.lines],
  );

  const value = useMemo<CartContextValue>(
    () => ({
      ...state,
      itemCount: state.lines.reduce((sum, l) => sum + l.quantity, 0),
      total: state.lines.reduce((sum, l) => sum + l.quantity * l.product.priceUsd, 0),
      cartToken,
      reservation,
      shortages,
      addProduct,
      setQuantity,
      removeProduct,
      clear,
      canAddFrom: (businessId: string) =>
        state.businessId === null || state.businessId === businessId,
    }),
    [state, cartToken, reservation, shortages, addProduct, setQuantity, removeProduct, clear],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart must be used inside a CartProvider');
  }
  return context;
}

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Business, Product } from '../api/types';

export interface CartLine {
  product: Product;
  quantity: number;
}

interface CartState {
  businessId: string | null;
  businessName: string | null;
  lines: CartLine[];
}

interface CartContextValue extends CartState {
  itemCount: number;
  total: number;
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

  const value = useMemo<CartContextValue>(
    () => ({
      ...state,
      itemCount: state.lines.reduce((sum, l) => sum + l.quantity, 0),
      total: state.lines.reduce((sum, l) => sum + l.quantity * l.product.priceUsd, 0),
      addProduct,
      setQuantity,
      removeProduct,
      clear,
      canAddFrom: (businessId: string) =>
        state.businessId === null || state.businessId === businessId,
    }),
    [state, addProduct, setQuantity, removeProduct, clear],
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

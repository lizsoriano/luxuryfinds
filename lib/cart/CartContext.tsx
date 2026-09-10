"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type CartItem = {
  /** Routing identifier for the product (slug when available, otherwise the raw id). */
  productId: string;
  /** Real product_variants.id, when known (e.g. added from the product detail page). */
  variantId: string | null;
  /** Product slug, used to re-fetch/revalidate the product at checkout time. */
  slug: string;
  name: string;
  brand: string;
  imageUrl: string | null;
  priceCents: number;
  quantity: number;
};

type CartContextValue = {
  items: CartItem[];
  count: number;
  subtotalCents: number;
  addItem: (item: Omit<CartItem, "quantity">, quantity?: number) => void;
  removeItem: (productId: string, variantId: string | null) => void;
  updateQuantity: (productId: string, variantId: string | null, quantity: number) => void;
  clear: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);
const STORAGE_KEY = "luxuryfinds:cart";

function sameLine(a: CartItem, productId: string, variantId: string | null) {
  return a.productId === productId && a.variantId === variantId;
}

function readStoredCart(): CartItem[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is CartItem =>
        item && typeof item.productId === "string" && typeof item.priceCents === "number" && typeof item.quantity === "number",
    );
  } catch {
    return [];
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage on the client only, after mount, to avoid an SSR/CSR
  // mismatch (the server always renders an empty cart). This one-time read of an
  // external, browser-only store is the standard exception to "don't setState in
  // an effect" — there's no way to know the stored cart before the DOM exists.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(readStoredCart());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Storage can be unavailable (private mode, quota). The cart still works in-memory.
    }
  }, [items, hydrated]);

  const addItem = useCallback((item: Omit<CartItem, "quantity">, quantity = 1) => {
    setItems((current) => {
      const existing = current.find((line) => sameLine(line, item.productId, item.variantId));
      if (existing) {
        return current.map((line) =>
          sameLine(line, item.productId, item.variantId) ? { ...line, quantity: line.quantity + quantity } : line,
        );
      }
      return [...current, { ...item, quantity }];
    });
  }, []);

  const removeItem = useCallback((productId: string, variantId: string | null) => {
    setItems((current) => current.filter((line) => !sameLine(line, productId, variantId)));
  }, []);

  const updateQuantity = useCallback((productId: string, variantId: string | null, quantity: number) => {
    setItems((current) => {
      if (quantity <= 0) return current.filter((line) => !sameLine(line, productId, variantId));
      return current.map((line) => (sameLine(line, productId, variantId) ? { ...line, quantity } : line));
    });
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const value = useMemo<CartContextValue>(() => {
    const count = items.reduce((sum, item) => sum + item.quantity, 0);
    const subtotalCents = items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
    return { items, count, subtotalCents, addItem, removeItem, updateQuantity, clear };
  }, [items, addItem, removeItem, updateQuantity, clear]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart debe usarse dentro de un CartProvider.");
  return context;
}

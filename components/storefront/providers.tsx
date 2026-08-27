"use client";

import { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import type { Settings } from "@/types";

export type CartItem = {
  product_id: string;
  variant_id?: string | null;
  slug: string;
  name: string;
  price: number;
  qty: number;
  image: string | null;
  color?: string | null;
  size?: string | null;
  sku?: string | null;
};

type CartCtx = {
  items: CartItem[];
  count: number;
  subtotal: number;
  isOpen: boolean;
  addToCart: (item: Omit<CartItem, "qty"> & { qty?: number }) => void;
  removeFromCart: (productId: string) => void;
  updateQty: (productId: string, qty: number, color?: string | null, size?: string | null, variantId?: string | null) => void;
  clearCart: () => void;
  openCart: () => void;
  closeCart: () => void;
};

const CartContext = createContext<CartCtx | null>(null);

type FavCtx = {
  favs: Set<string>;
  isFav: (id: string) => boolean;
  toggleFav: (id: string) => void;
};

const FavContext = createContext<FavCtx | null>(null);

function useLocalStorage<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) setValue(JSON.parse(raw));
    } catch {}
  }, [key]);
  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }, [key, value]);
  return [value, setValue] as const;
}

export function StoreProviders({ settings, children }: { settings: Settings; children: React.ReactNode }) {
  const [items, setItems] = useLocalStorage<CartItem[]>("gs_cart", []);
  const [favs, setFavs] = useLocalStorage<string[]>("gs_favs", []);
  const [isOpen, setIsOpen] = useState(false);

  const addToCart = useCallback((item: Omit<CartItem, "qty"> & { qty?: number }) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.product_id === item.product_id && (i.variant_id || null) === (item.variant_id || null) && (i.color || null) === (item.color || null) && (i.size || null) === (item.size || null));
      if (existing) {
        return prev.map((i) => (i.product_id === item.product_id && (i.variant_id || null) === (item.variant_id || null) && (i.color || null) === (item.color || null) && (i.size || null) === (item.size || null) ? { ...i, qty: i.qty + (item.qty || 1) } : i));
      }
      return [...prev, { ...item, qty: item.qty || 1 }];
    });
  }, [setItems]);

  const removeFromCart = useCallback((productId: string) => {
    setItems((prev) => prev.filter((i) => i.product_id !== productId));
  }, [setItems]);

  const updateQty = useCallback((productId: string, qty: number, color?: string | null, size?: string | null, variantId?: string | null) => {
    setItems((prev) =>
      qty <= 0
        ? prev.filter((i) => !(i.product_id === productId && (color === undefined || (i.color || null) === (color || null)) && (size === undefined || (i.size || null) === (size || null)) && (variantId === undefined || (i.variant_id || null) === (variantId || null))))
        : prev.map((i) => (i.product_id === productId && (color === undefined || (i.color || null) === (color || null)) && (size === undefined || (i.size || null) === (size || null)) && (variantId === undefined || (i.variant_id || null) === (variantId || null)) ? { ...i, qty } : i))
    );
  }, [setItems]);

  const clearCart = useCallback(() => setItems([]), [setItems]);

  const subtotal = useMemo(() => items.reduce((s, i) => s + i.price * i.qty, 0), [items]);
  const count = useMemo(() => items.reduce((s, i) => s + i.qty, 0), [items]);

  const isFav = useCallback((id: string) => favs.includes(id), [favs]);
  const toggleFav = useCallback((id: string) => {
    setFavs((prev) => (prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]));
  }, [setFavs]);

  const cartValue = useMemo(
    () => ({ items, count, subtotal, isOpen, addToCart, removeFromCart, updateQty, clearCart, openCart: () => setIsOpen(true), closeCart: () => setIsOpen(false) }),
    [items, count, subtotal, isOpen, addToCart, removeFromCart, updateQty, clearCart]
  );

  const favValue = useMemo(
    () => ({ favs: new Set(favs), isFav, toggleFav }),
    [favs, isFav, toggleFav]
  );

  return (
    <CartContext.Provider value={cartValue}>
      <FavContext.Provider value={favValue}>{children}</FavContext.Provider>
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within StoreProviders");
  return ctx;
}

export function useFavorites() {
  const ctx = useContext(FavContext);
  if (!ctx) throw new Error("useFavorites must be used within StoreProviders");
  return ctx;
}

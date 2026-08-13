"use client";

import { useEffect, useState } from "react";
import { HeartOff, Loader2 } from "lucide-react";
import { useFavorites } from "@/components/storefront/providers";
import { ProductCard } from "@/components/storefront/product-card";
import { getFavProductsAction } from "@/app/actions/products";
import type { Product } from "@/types";

export function FavoritesGrid() {
  const { favs } = useFavorites();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getFavProductsAction([...favs]).then((p) => {
      if (!active) return;
      setProducts(p);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [favs]);

  if (loading) {
    return (
      <div className="mt-10 flex justify-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-gold" />
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="mt-10 rounded-3xl border border-sand bg-white p-16 text-center">
        <HeartOff className="w-12 h-12 mx-auto mb-3 text-gold/40" />
        <p className="text-stone-500">لا توجد قطع في المفضلة بعد</p>
      </div>
    );
  }

  return (
    <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-3 md:gap-6 lg:grid-cols-4">
      {products.map((p) => (
        <ProductCard key={p.id} product={p} />
      ))}
    </div>
  );
}

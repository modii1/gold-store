"use client";

import { useState } from "react";
import { ShoppingBag, Heart, Minus, Plus, Check, Loader2 } from "lucide-react";
import { useCart, useFavorites } from "@/components/storefront/providers";
import { effectivePrice, formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { WhatsappIcon } from "@/components/ui/social-icons";
import type { Product, Settings } from "@/types";

export function BuyPanel({ product, settings }: { product: Product; settings: Settings }) {
  const { addToCart, openCart } = useCart();
  const { isFav, toggleFav } = useFavorites();
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const price = effectivePrice(product);
  const outOfStock = product.stock <= 0;

  const handleAdd = () => {
    addToCart({
      product_id: product.id,
      slug: product.slug,
      name: product.name,
      price,
      image: product.images?.[0]?.url ?? null,
      qty,
    });
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
    openCart();
  };

  return (
    <div className="space-y-5 rounded-2xl border border-sand bg-white p-5 md:p-6">
      {!outOfStock ? (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-full border border-sand p-1.5">
            <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="h-9 w-9 rounded-full hover:bg-cream flex items-center justify-center text-stone-600 transition">
              <Minus className="w-4 h-4" />
            </button>
            <span className="w-8 text-center font-bold">{qty}</span>
            <button onClick={() => setQty((q) => q + 1)} className="h-9 w-9 rounded-full hover:bg-cream flex items-center justify-center text-stone-600 transition">
              <Plus className="w-4 h-4" />
            </button>
          </div>
          <button
            onClick={handleAdd}
            className="flex flex-1 items-center justify-center gap-2 rounded-full bg-ink py-3.5 font-bold text-ivory hover:bg-gold transition"
          >
            {added ? <Check className="w-5 h-5" /> : <ShoppingBag className="w-5 h-5" />}
            {added ? "أضيفت للسلة" : "أضيفي للسلة"}
          </button>
        </div>
      ) : (
        <p className="rounded-full bg-stone-100 py-3 text-center text-sm font-bold text-stone-500">نفدت الكمية — تواصلي معنا للطلب</p>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={() => toggleFav(product.id)}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 rounded-full border py-3 text-sm font-bold transition",
            isFav(product.id)
              ? "border-red-200 text-red-500 bg-red-50"
              : "border-sand text-stone-600 hover:border-gold hover:text-gold"
          )}
        >
          <Heart className={cn("w-4 h-4", isFav(product.id) && "fill-red-500")} />
          {isFav(product.id) ? "في المفضلة" : "أضيفي للمفضلة"}
        </button>
        {settings.whatsapp && (
          <a
            href={`https://wa.me/${settings.whatsapp}?text=${encodeURIComponent(`مرحباً، أريد الاستفسار عن: ${product.name} (SKU: ${product.sku || product.id.slice(0, 8)})`)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-full border-2 border-emerald-500 px-5 py-3 text-sm font-bold text-emerald-600 hover:bg-emerald-50 transition"
          >
            <WhatsappIcon className="w-4 h-4" /> واتساب
          </a>
        )}
      </div>

      {settings.payment_instructions && (
        <p className="text-xs text-stone-500 leading-relaxed border-t border-sand pt-4 whitespace-pre-line">
          {settings.payment_instructions}
        </p>
      )}
    </div>
  );
}

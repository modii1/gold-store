"use client";

import { useState, useMemo } from "react";
import { ShoppingBag, Heart, Minus, Plus, Check } from "lucide-react";
import { useCart, useFavorites } from "@/components/storefront/providers";
import { effectivePrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { WhatsappIcon } from "@/components/ui/social-icons";
import type { Product, Settings } from "@/types";

function colorHex(name: string): string {
  const n = name.trim().toLowerCase();
  const map: Record<string, string> = {
    "ذهبي": "#D4AF37", "ذهب": "#D4AF37", "ذهبي فاتح": "#E7C77A", "ذهبي غامق": "#8F6F3F",
    "فضي": "#C0C0C0", "فضة": "#C0C0C0",
    "روز قولد": "#B76E79", "روز": "#B76E79", "روزغولد": "#B76E79", "وردي ذهبي": "#B76E79",
    "أسود": "#1A1A1A", "اسود": "#1A1A1A", "black": "#1A1A1A",
    "أبيض": "#F5F5F5", "ابيض": "#F5F5F5", "white": "#F5F5F5",
    "أحمر": "#C0392B", "احمر": "#C0392B",
    "أزرق": "#2E86AB", "ازرق": "#2E86AB", "كحلي": "#1B2A4E",
    "أخضر": "#27AE60", "اخضر": "#27AE60", "زمردي": "#1ABC9C",
    "بنفسجي": "#8E44AD", "موف": "#8E44AD",
    "بني": "#8B5A2B", "بيج": "#D8CAB5", "عسلي": "#C9A86A",
    "نحاسي": "#B87333",
  };
  return map[n] || "#D4AF37";
}

export function BuyPanel({ product, settings }: { product: Product; settings: Settings }) {
  const { addToCart, openCart } = useCart();
  const { isFav, toggleFav } = useFavorites();
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const price = effectivePrice(product);
  const outOfStock = product.stock <= 0;

  const colors = useMemo(() => {
    if (!product.color) return [];
    return product.color.split(/[،,]/).map((c) => c.trim()).filter(Boolean);
  }, [product.color]);
  const hasColors = colors.length > 1;
  const [selectedColor, setSelectedColor] = useState<string | null>(colors.length === 1 ? colors[0] : null);
  const needColor = hasColors && !selectedColor;

  const handleAdd = () => {
    if (needColor) return;
    addToCart({
      product_id: product.id,
      slug: product.slug,
      name: hasColors && selectedColor ? `${product.name} — ${selectedColor}` : product.name,
      price,
      image: product.images?.[0]?.url ?? null,
      qty,
      color: selectedColor,
    });
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
    openCart();
  };

  return (
    <div className="space-y-5 rounded-2xl border border-sand bg-white p-5 md:p-6">
      {/* Color selector — like Limora */}
      {colors.length > 0 && (
        <div>
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-ink">اللون {hasColors && <span className="font-normal text-stone-400">— {selectedColor || "اختاري"}</span>}</p>
            {hasColors && selectedColor && (
              <button onClick={() => setSelectedColor(null)} className="text-xs text-stone-400 hover:text-gold">مسح</button>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {colors.map((c, idx) => {
              const active = selectedColor === c;
              return (
                <button
                  key={c}
                  onClick={() => {
                    setSelectedColor(c);
                    window.dispatchEvent(new CustomEvent("color-select", { detail: { color: c, index: idx } }));
                  }}
                  className={cn(
                    "flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold transition",
                    active ? "border-gold bg-gold text-white shadow" : "border-sand bg-white text-stone-700 hover:border-gold/50 hover:bg-cream"
                  )}
                >
                  <span className="h-4 w-4 rounded-full border border-black/10 shadow-sm" style={{ background: colorHex(c) }} />
                  {c}
                  {active && <Check className="h-3.5 w-3.5" />}
                </button>
              );
            })}
          </div>
          {needColor && <p className="mt-2 text-xs font-bold text-red-500">الرجاء اختيار اللون أولاً</p>}
          {!hasColors && <p className="mt-1 text-xs text-stone-400">اللون: {colors[0]}</p>}
        </div>
      )}

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
            disabled={!!needColor}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-full py-3.5 font-bold transition",
              needColor ? "bg-stone-200 text-stone-400 cursor-not-allowed" : "bg-ink text-ivory hover:bg-gold"
            )}
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

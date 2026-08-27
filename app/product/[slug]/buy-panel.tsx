"use client";

import { useState, useMemo } from "react";
import { ShoppingBag, Heart, Minus, Plus, Check } from "lucide-react";
import { useCart, useFavorites } from "@/components/storefront/providers";
import { effectivePrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { WhatsappIcon } from "@/components/ui/social-icons";
import type { Product, ProductVariant, Settings } from "@/types";

function fallbackHex(name: string): string {
  const n = name.trim().toLowerCase();
  const map: Record<string, string> = {
    "ذهبي": "#D4AF37", "ذهب": "#D4AF37", "ذهبي فاتح": "#E7C77A", "ذهبي غامق": "#8F6F3F",
    "فضي": "#C0C0C0", "فضة": "#C0C0C0",
    "روز قولد": "#B76E79", "روز": "#B76E79", "روزغولد": "#B76E79",
    "أسود": "#1A1A1A", "اسود": "#1A1A1A", "أبيض": "#F5F5F5", "ابيض": "#F5F5F5",
    "أحمر": "#C0392B", "احمر": "#C0392B", "أزرق": "#2E86AB", "ازرق": "#2E86AB",
    "أخضر": "#27AE60", "اخضر": "#27AE60", "بنفسجي": "#8E44AD", "موف": "#8E44AD",
    "بني": "#8B5A2B", "بيج": "#D8CAB5", "عسلي": "#C9A86A", "نحاسي": "#B87333",
  };
  return map[n] || "#D4AF37";
}

export function BuyPanel({ product, settings }: { product: Product; settings: Settings }) {
  const { addToCart, openCart } = useCart();
  const { isFav, toggleFav } = useFavorites();
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  const variants = (product as any).variants as ProductVariant[] | undefined;
  const hasVariants = !!variants?.length;

  // --- Variant mode (Amazon style) ---
  const colors = useMemo(() => {
    if (!hasVariants) return [];
    const map = new Map<string, { name: string; hex: string; stock: number }>();
    for (const v of variants!) {
      if (!v.color) continue;
      const key = v.color.trim();
      const entry = map.get(key) || { name: key, hex: v.color_hex || fallbackHex(key), stock: 0 };
      entry.stock += v.stock;
      if (v.color_hex) entry.hex = v.color_hex;
      map.set(key, entry);
    }
    return Array.from(map.values());
  }, [variants, hasVariants]);

  const sizesForColor = useMemo(() => {
    if (!hasVariants) return [];
    if (!colors.length) {
      const set = new Set<string>();
      for (const v of variants!) if (v.size) set.add(v.size.trim());
      return Array.from(set);
    }
    // sizes available for selected color
    return [];
  }, [variants, hasVariants, colors]);

  const [selectedColor, setSelectedColor] = useState<string | null>(() => {
    if (hasVariants && colors.length === 1) return colors[0].name;
    if (!hasVariants && product.color && !product.color.includes("،") && !product.color.includes(",")) return product.color.trim();
    return null;
  });
  const [selectedSize, setSelectedSize] = useState<string | null>(null);

  // fallback old comma colors
  const fallbackColors = useMemo(() => {
    if (hasVariants || !product.color) return [];
    return product.color.split(/[،,]/).map((c) => c.trim()).filter(Boolean);
  }, [product.color, hasVariants]);

  const activeColors = hasVariants ? colors : fallbackColors.map((c) => ({ name: c, hex: fallbackHex(c), stock: 1 }));
  const hasColorOptions = activeColors.length > 1 || (hasVariants && colors.length > 0);

  const availableSizes = useMemo(() => {
    if (!hasVariants) return [];
    const list = variants!.filter((v) => !selectedColor || v.color === selectedColor).map((v) => v.size).filter(Boolean) as string[];
    return Array.from(new Set(list.map((s) => s.trim())));
  }, [variants, hasVariants, selectedColor]);

  const hasSizeOptions = hasVariants && availableSizes.length > 0;

  const selectedVariant: ProductVariant | null = useMemo(() => {
    if (!hasVariants) return null;
    return (
      variants!.find((v) => {
        const colorMatch = selectedColor ? v.color === selectedColor : !v.color;
        const sizeMatch = hasSizeOptions ? v.size === selectedSize : true;
        if (hasSizeOptions && !selectedSize) return false;
        if (selectedColor && hasSizeOptions) return colorMatch && sizeMatch;
        if (selectedColor) return colorMatch;
        return false;
      }) || null
    );
  }, [variants, hasVariants, selectedColor, selectedSize, hasSizeOptions]);

  const needsColor = hasColorOptions && !selectedColor;
  const needsSize = hasSizeOptions && !selectedSize;

  const displayPrice = (selectedVariant?.price as number | null) ?? effectivePrice(product);
  // if variant has its own sale_price, effective is sale else price
  const variantEffective = selectedVariant ? (selectedVariant.sale_price ?? selectedVariant.price ?? displayPrice) : displayPrice;
  const variantStock = selectedVariant ? selectedVariant.stock : product.stock;
  const outOfStock = hasVariants ? (selectedVariant ? variantStock <= 0 : false) : product.stock <= 0;
  const variantImage = selectedVariant?.image_url || product.images?.[0]?.url || null;

  const handleAdd = () => {
    if (needsColor || needsSize) return;
    if (hasVariants && !selectedVariant && (hasColorOptions || hasSizeOptions)) return;
    const color = hasVariants ? selectedColor : selectedColor;
    const size = hasVariants ? selectedSize : null;
    const variant = hasVariants ? selectedVariant : null;
    const priceToUse = variant ? (variant.sale_price ?? variant.price ?? displayPrice) : displayPrice;
    const imageToUse = variant?.image_url || variantImage;
    const nameSuffix = [color, size].filter(Boolean).join(" / ");
    addToCart({
      product_id: product.id,
      variant_id: variant?.id || null,
      slug: product.slug,
      name: nameSuffix ? `${product.name} — ${nameSuffix}` : product.name,
      price: priceToUse,
      image: imageToUse,
      qty,
      color: color || null,
      size: size || null,
      sku: variant?.sku || product.sku,
    });
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
    openCart();
  };

  // Sync gallery when color changes — each image has its color
  const handleColorSelect = (c: string, idx: number) => {
    setSelectedColor(c);
    setSelectedSize(null);
    const v = variants?.find((x) => x.color === c);
    const imageIdx = v?.image_url ? (product.images || []).findIndex((im) => im.url === v.image_url) : idx;
    window.dispatchEvent(new CustomEvent("color-select", { detail: { color: c, index: imageIdx >= 0 ? imageIdx : idx, image_url: v?.image_url || undefined } }));
  };

  return (
    <div className="space-y-5 rounded-2xl border border-sand bg-white p-5 md:p-6">
      {/* Color — visual circles */}
      {activeColors.length > 0 && (
        <div>
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-ink">
              اللون {hasColorOptions && <span className="font-normal text-stone-400">— {selectedColor || "اختاري"}</span>}
            </p>
            {selectedColor && <button onClick={() => { setSelectedColor(null); setSelectedSize(null); }} className="text-xs text-stone-400 hover:text-gold">مسح</button>}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {activeColors.map((c, idx) => {
              const active = selectedColor === c.name;
              const noStock = hasVariants && c.stock <= 0;
              return (
                <button
                  key={c.name}
                  onClick={() => !noStock && handleColorSelect(c.name, idx)}
                  disabled={noStock}
                  className={cn(
                    "flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-bold transition",
                    active ? "border-gold bg-gold text-white shadow" : "border-sand bg-white text-stone-700 hover:border-gold/50 hover:bg-cream",
                    noStock && "opacity-40 cursor-not-allowed line-through"
                  )}
                >
                  <span className="h-5 w-5 rounded-full border-2 border-white shadow-sm shrink-0" style={{ background: c.hex }} />
                  {c.name}
                  {active && <Check className="h-3.5 w-3.5" />}
                </button>
              );
            })}
          </div>
          {needsColor && <p className="mt-2 text-xs font-bold text-red-500">الرجاء اختيار اللون أولاً</p>}
        </div>
      )}

      {/* Size — free text pills */}
      {hasSizeOptions && (
        <div>
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-ink">المقاس <span className="font-normal text-stone-400">— {selectedSize || "اختاري"}</span></p>
            {selectedSize && <button onClick={() => setSelectedSize(null)} className="text-xs text-stone-400 hover:text-gold">مسح</button>}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {availableSizes.map((s) => {
              const active = selectedSize === s;
              const v = variants!.find((x) => x.color === selectedColor && x.size === s) || variants!.find((x) => x.size === s);
              const noStock = v ? v.stock <= 0 : false;
              return (
                <button
                  key={s}
                  onClick={() => !noStock && setSelectedSize(s)}
                  disabled={noStock}
                  className={cn(
                    "rounded-full border px-4 py-1.5 text-sm font-bold transition",
                    active ? "border-gold bg-gold text-white shadow" : "border-sand bg-white text-stone-700 hover:border-gold/50",
                    noStock && "opacity-40 cursor-not-allowed"
                  )}
                >
                  {s} {noStock && "— نفذ"}
                </button>
              );
            })}
          </div>
          {needsSize && selectedColor && <p className="mt-2 text-xs font-bold text-red-500">الرجاء اختيار المقاس</p>}
        </div>
      )}

      {/* Price / stock for selected variant */}
      {hasVariants && selectedVariant && (
        <div className="flex items-center gap-2 text-xs">
          <span className={cn("rounded-full px-2.5 py-0.5 font-bold", variantStock > 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-600")}>
            {variantStock > 0 ? `متوفر (${variantStock})` : "نفذت الكمية"}
          </span>
          {selectedVariant.sku && <span className="text-stone-400" dir="ltr">SKU: {selectedVariant.sku}</span>}
        </div>
      )}

      {!outOfStock || (hasVariants && !selectedVariant) ? (
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
            disabled={!!(needsColor || needsSize) || (hasVariants && !!selectedColor && hasSizeOptions && !selectedVariant)}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-full py-3.5 font-bold transition",
              needsColor || needsSize ? "bg-stone-200 text-stone-400 cursor-not-allowed" : "bg-ink text-ivory hover:bg-gold"
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
            isFav(product.id) ? "border-red-200 text-red-500 bg-red-50" : "border-sand text-stone-600 hover:border-gold hover:text-gold"
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
        <p className="text-xs text-stone-500 leading-relaxed border-t border-sand pt-4 whitespace-pre-line">{settings.payment_instructions}</p>
      )}
    </div>
  );
}

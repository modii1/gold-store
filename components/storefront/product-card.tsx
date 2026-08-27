"use client";

import { useState } from "react";
import Link from "next/link";
import { Heart, PlayCircle, Plus, Check } from "lucide-react";
import { useCart, useFavorites } from "./providers";
import { effectivePrice, discountPercent } from "@/lib/format";
import { Currency } from "@/components/storefront/currency";
import { cn } from "@/lib/utils";
import type { Product } from "@/types";

export function ProductCard({ product }: { product: Product }) {
  const { isFav, toggleFav } = useFavorites();
  const { addToCart } = useCart();
  const [added, setAdded] = useState(false);
  const cover = product.images?.[0]?.url;
  const hover = product.images?.[1]?.url;
  const hasVideo = product.videos && product.videos.length > 0;
  const price = effectivePrice(product);
  const disc = discountPercent(product);
  const outOfStock = product.stock <= 0;

  const variantList = (product as any).variants as any[] | undefined;
  const colors: { name: string; hex: string }[] = variantList?.length
    ? Array.from(new Map(variantList.filter((v: any) => v.color).map((v: any) => [v.color.trim(), { name: v.color.trim(), hex: v.color_hex || ({ "ذهبي": "#D4AF37", "فضي": "#C0C0C0", "روز قولد": "#B76E79", "روز": "#B76E79" } as any)[v.color.trim()] || "#D4AF37" }])).values())
    : (product.color ? product.color.split(/[،,]/).map((c) => c.trim()).filter(Boolean).map((c) => ({ name: c, hex: ({ "ذهبي": "#D4AF37", "فضي": "#C0C0C0", "روز قولد": "#B76E79" } as any)[c] || "#D4AF37" })) : []);
  const hasMultipleColors = variantList ? variantList.length > 1 : colors.length > 1;

  const handleQuickAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (outOfStock || added) return;
    if (hasMultipleColors) {
      window.location.href = `/product/${product.slug}`;
      return;
    }
    const single = variantList?.length === 1 ? variantList[0] : null;
    addToCart({
      product_id: product.id,
      variant_id: single?.id || null,
      slug: product.slug,
      name: single ? `${product.name} — ${[single.color, single.size].filter(Boolean).join(" / ")}` : product.name,
      price: single?.sale_price ?? single?.price ?? price,
      image: single?.image_url || cover || null,
      color: single?.color || colors[0]?.name || null,
      size: single?.size || null,
      sku: single?.sku || product.sku,
    });
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  };

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl bg-white border border-sand/70 shadow-sm hover:shadow-xl hover:border-gold/30 transition duration-300">
      <Link href={`/product/${product.slug}`} className="block">
        <div className="relative aspect-[3/4] overflow-hidden bg-cream">
          {cover ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={cover}
                alt={product.name}
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:opacity-0"
              />
              {hover && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={hover}
                  alt=""
                  loading="lazy"
                  className="absolute inset-0 h-full w-full object-cover opacity-0 transition duration-700 group-hover:opacity-100"
                />
              )}
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-stone-300 text-xs">لا توجد صورة</div>
          )}

          {/* Badges */}
          <div className="absolute top-3 end-3 flex flex-col gap-1.5 items-end">
            {disc > 0 && (
              <span className="rounded-full bg-gold px-2.5 py-0.5 text-[10px] font-bold text-ivory shadow">
                خصم {disc}%
              </span>
            )}
            {product.is_best_seller && !outOfStock && (
              <span className="rounded-full bg-ink px-2.5 py-0.5 text-[10px] font-bold text-ivory shadow">
                الأكثر مبيعاً
              </span>
            )}
            {outOfStock && (
              <span className="rounded-full bg-stone-500 px-2.5 py-0.5 text-[10px] font-bold text-white shadow">
                نفد المخزون
              </span>
            )}
          </div>

          {hasVideo && (
            <span className="absolute bottom-3 end-3 flex items-center gap-1 rounded-full bg-ink/70 text-ivory text-[10px] px-2.5 py-1 backdrop-blur">
              <PlayCircle className="w-3.5 h-3.5 text-gold" /> فيديو
            </span>
          )}
        </div>
      </Link>

      {/* Favorite */}
      <button
        onClick={() => toggleFav(product.id)}
        aria-label="إضافة للمفضلة"
        className="absolute top-3 start-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/85 backdrop-blur shadow border border-sand text-stone-500 hover:text-red-500 transition z-10"
      >
        <Heart className={cn("w-4 h-4", isFav(product.id) && "fill-red-500 text-red-500")} />
      </button>

      {/* Quick Add */}
      {!outOfStock && (
        <button
          onClick={handleQuickAdd}
          aria-label="إضافة للسلة"
          className={cn(
            "absolute bottom-3 end-3 flex h-9 w-9 items-center justify-center rounded-full shadow border transition z-10",
            added
              ? "bg-emerald-500 border-emerald-500 text-white scale-110"
              : "bg-white/90 backdrop-blur border-sand text-ink hover:bg-gold hover:border-gold hover:text-white"
          )}
        >
          {added ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
        </button>
      )}

      <div className="flex flex-1 flex-col p-3 md:p-4">
        <Link href={`/product/${product.slug}`} className="block">
          <h3 className="text-sm md:text-base font-bold text-ink line-clamp-2 group-hover:text-gold transition leading-snug">
            {product.name}
          </h3>
          {product.brand && <p className="mt-0.5 text-xs text-stone-400">{product.brand}</p>}
        </Link>

        {colors.length > 0 && (
          <div className="mt-2 flex items-center gap-1.5">
            {colors.slice(0, 4).map((c) => (
              <span key={c.name} title={c.name} className="h-3.5 w-3.5 rounded-full border border-black/10 shadow-sm" style={{ background: c.hex }} />
            ))}
            {colors.length > 4 && <span className="text-[10px] text-stone-400">+{colors.length - 4}</span>}
            <span className="text-[10px] text-stone-400">· {colors.map((c) => c.name).join("، ")}</span>
          </div>
        )}
        <div className="mt-auto pt-2 flex items-baseline gap-2">
          <Currency value={price} className="text-lg md:text-xl font-bold text-gold" />
          {disc > 0 && product.sale_price && (
            <Currency value={product.price} className="text-xs text-stone-400 line-through" />
          )}
        </div>
      </div>
    </div>
  );
}

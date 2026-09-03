"use client";

import Link from "next/link";
import { ChevronLeft, LayoutGrid, Rows3 } from "lucide-react";
import { useState, useEffect } from "react";
import { ProductCard } from "./product-card";
import type { Product, Settings } from "@/types";

const STORAGE_KEY = "gold-store-product-layout";

export function ProductSection({
  title,
  subtitle,
  viewAll,
  products,
  dark,
  settings,
}: {
  title: string;
  subtitle?: string;
  viewAll: string;
  products: Product[];
  dark?: boolean;
  settings?: Settings;
}) {
  const allowToggle = settings?.mobile_products_allow_user_toggle === true;
  const defaultLayout = settings?.mobile_products_layout === "horizontal" ? "horizontal" : "grid";

  const [mobileLayout, setMobileLayout] = useState<"grid" | "horizontal">(defaultLayout);

  useEffect(() => {
    if (!allowToggle) return;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "grid" || saved === "horizontal") {
        setMobileLayout(saved);
      }
    } catch {}
  }, [allowToggle]);

  const toggleLayout = (v: "grid" | "horizontal") => {
    setMobileLayout(v);
    try { localStorage.setItem(STORAGE_KEY, v); } catch {}
  };

  if (products.length === 0) return null;

  const effectiveLayout = allowToggle ? mobileLayout : defaultLayout;

  return (
    <section className={`py-12 md:py-16 ${dark ? "bg-ink text-ivory" : "bg-ivory"}`}>
      <div className="mx-auto max-w-7xl px-4 md:px-6">
        <div className="flex items-end justify-between mb-8 gap-4">
          <div className="flex items-center gap-3">
            <div>
              <h2 className={`text-2xl md:text-3xl font-bold ${dark ? "text-ivory" : "text-ink"}`}>{title}</h2>
              {subtitle && <p className={`mt-1 text-sm md:text-base ${dark ? "text-ivory/60" : "text-stone-500"}`}>{subtitle}</p>}
            </div>
            {allowToggle && (
              <div className="flex items-center gap-1 md:hidden">
                <button
                  onClick={() => toggleLayout("grid")}
                  className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
                    effectiveLayout === "grid"
                      ? "bg-gold text-white"
                      : dark ? "bg-white/10 text-ivory/60 hover:text-ivory" : "bg-stone-100 text-stone-400 hover:text-stone-700"
                  }`}
                  aria-label="عرض شبكي"
                >
                  <LayoutGrid className="w-4 h-4" />
                </button>
                <button
                  onClick={() => toggleLayout("horizontal")}
                  className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
                    effectiveLayout === "horizontal"
                      ? "bg-gold text-white"
                      : dark ? "bg-white/10 text-ivory/60 hover:text-ivory" : "bg-stone-100 text-stone-400 hover:text-stone-700"
                  }`}
                  aria-label="عرض أفقي"
                >
                  <Rows3 className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
          <Link
            href={viewAll}
            className={`flex items-center gap-1 text-sm font-bold whitespace-nowrap ${dark ? "text-gold-light hover:text-ivory" : "text-gold-dark hover:text-ink"} transition`}
          >
            عرض الكل <ChevronLeft className="w-4 h-4" />
          </Link>
        </div>

        {/* Desktop: always grid */}
        <div className="hidden md:grid grid-cols-3 lg:grid-cols-4 gap-6">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>

        {/* Mobile: grid or horizontal scroll */}
        {effectiveLayout === "grid" ? (
          <div className="grid grid-cols-2 gap-3 md:hidden">
            {products.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        ) : (
          <div
            className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scroll-smooth md:hidden"
            style={{ scrollbarWidth: "none", msOverflowStyle: "none", WebkitOverflowScrolling: "touch" }}
          >
            {products.map((p) => (
              <div key={p.id} className="w-[45%] min-w-[160px] shrink-0 snap-start">
                <ProductCard product={p} />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

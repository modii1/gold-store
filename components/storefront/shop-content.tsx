"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SlidersHorizontal, ChevronLeft, ChevronRight, X } from "lucide-react";
import { ProductCard } from "./product-card";
import { cn } from "@/lib/utils";
import { pluralizeArabic } from "@/lib/format";
import type { Product, Category } from "@/types";

const SORTS = [
  { value: "newest", label: "الأحدث" },
  { value: "best", label: "الأكثر مبيعاً" },
  { value: "price_asc", label: "السعر: من الأقل للأعلى" },
  { value: "price_desc", label: "السعر: من الأعلى للأقل" },
];

export type ShopInit = {
  products: Product[];
  total: number;
  categories: Category[];
  facets: { karat: string[]; material: string[]; color: string[]; brand: string[] };
  perPage: number;
};

function Check({ label, param, value, basePath }: { label: string; param: string; value: string; basePath: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const active = searchParams.getAll(param).includes(value);

  const toggle = () => {
    const params = new URLSearchParams(searchParams.toString());
    const list = params.getAll(param).filter((v) => v !== value);
    if (!active) list.push(value);
    params.delete(param);
    list.forEach((v) => params.append(param, v));
    params.set("page", "1");
    router.push(`${basePath}?${params.toString()}`);
  };

  return (
    <label className="flex items-center gap-2 text-sm text-stone-600 cursor-pointer hover:text-gold transition">
      <input type="checkbox" checked={active} onChange={toggle} className="accent-gold h-4 w-4 rounded" />
      {label}
    </label>
  );
}

function FacetBlock({ title, values, param, basePath }: { title: string; values: string[]; param: string; basePath: string }) {
  if (!values || values.length === 0) return null;
  return (
    <div>
      <p className="text-sm font-bold text-ink mb-2">{title}</p>
      <div className="space-y-1.5">
        {values.map((v) => (
          <Check key={v} label={v} param={param} value={v} basePath={basePath} />
        ))}
      </div>
    </div>
  );
}

export function ShopContent({ init, fixedCategory, basePath = "/shop" }: { init: ShopInit; fixedCategory?: string; basePath?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [filtersOpen, setFiltersOpen] = useState(false);

  const sort = searchParams.get("sort") || "newest";
  const page = parseInt(searchParams.get("page") || "1") || 1;
  const totalPages = Math.max(1, Math.ceil(init.total / init.perPage));

  const onSort = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("sort", value);
    params.set("page", "1");
    startTransition(() => router.push(`${basePath}?${params.toString()}`));
  };

  const setPage = (p: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(p));
    startTransition(() => router.push(`${basePath}?${params.toString()}`));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const clearFilters = () => {
    startTransition(() => router.push(basePath));
  };

  const filterPanel = (
    <div className="space-y-6">
      {!fixedCategory && init.categories.length > 0 && (
        <div>
          <p className="text-sm font-bold text-ink mb-2">التصنيف</p>
          <div className="space-y-1.5">
            {init.categories.map((c) => (
              <Check key={c.id} label={c.name} param="category" value={c.name} basePath={basePath} />
            ))}
          </div>
        </div>
      )}
      <FacetBlock title="العيار" values={init.facets.karat} param="karat" basePath={basePath} />
      <FacetBlock title="المادة" values={init.facets.material} param="material" basePath={basePath} />
      <FacetBlock title="اللون" values={init.facets.color} param="color" basePath={basePath} />
      <FacetBlock title="العلامة التجارية" values={init.facets.brand} param="brand" basePath={basePath} />
      <div>
        <p className="text-sm font-bold text-ink mb-2">التوفر</p>
        <Check label="متوفر حالياً" param="in_stock" value="1" basePath={basePath} />
        <Check label="عروض (خصم)" param="sale" value="1" basePath={basePath} />
        <Check label="مميزة" param="featured" value="1" basePath={basePath} />
      </div>
      <button onClick={clearFilters} className="w-full rounded-full border border-sand py-2 text-sm font-semibold text-stone-500 hover:border-gold hover:text-gold transition">
        مسح الفلاتر
      </button>
    </div>
  );

  return (
    <div className="mx-auto max-w-7xl px-4 md:px-6 py-8">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-1.5 text-xs text-stone-400 mb-6">
        <a href="/" className="hover:text-gold transition">الرئيسية</a>
        <ChevronLeft className="w-3.5 h-3.5" />
        <span className="text-gold font-semibold">{fixedCategory || "المتجر"}</span>
      </nav>

      <div className="flex items-end justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-ink">{fixedCategory || "جميع المنتجات"}</h1>
          <p className="mt-1 text-sm text-stone-500">{init.total.toLocaleString("en-US")} {pluralizeArabic(init.total, "منتج", "منتجين", "منتجات")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setFiltersOpen(true)} className="md:hidden flex items-center gap-2 rounded-full border border-sand bg-white px-4 py-2 text-sm font-semibold text-ink">
            <SlidersHorizontal className="w-4 h-4 text-gold" /> الفلاتر
          </button>
          <select value={sort} onChange={(e) => onSort(e.target.value)}
            className="rounded-full border border-sand bg-white px-4 py-2 text-sm font-semibold text-ink focus:outline-none focus:border-gold">
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex gap-8">
        {/* Sidebar (desktop) */}
        <aside className="hidden md:block w-56 lg:w-64 shrink-0">
          <div className="sticky top-24 space-y-6 border border-sand bg-white rounded-2xl p-5">
            {filterPanel}
          </div>
        </aside>

        {/* Grid */}
        <div className="flex-1 min-w-0">
          <div className={cn("grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-5", isPending && "opacity-60 transition")}>
            {init.products.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>

          {init.products.length === 0 && (
            <div className="rounded-2xl border border-sand bg-white p-16 text-center text-stone-400">
              لا توجد منتجات مطابقة للفلاتر
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-10 flex items-center justify-center gap-2">
              <button onClick={() => page > 1 && setPage(page - 1)} disabled={page <= 1}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-sand bg-white text-stone-500 hover:border-gold hover:text-gold transition disabled:opacity-40">
                <ChevronRight className="w-4 h-4" />
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                .map((p, idx, arr) => (
                  <span key={p} className="flex items-center gap-2">
                    {idx > 0 && arr[idx - 1] !== p - 1 && <span className="text-stone-300">…</span>}
                    <button onClick={() => setPage(p)}
                      className={cn(
                        "h-10 w-10 rounded-full text-sm font-bold transition",
                        p === page ? "bg-gold text-ivory" : "border border-sand bg-white text-stone-600 hover:border-gold hover:text-gold"
                      )}>
                      {p.toLocaleString("en-US")}
                    </button>
                  </span>
                ))}
              <button onClick={() => page < totalPages && setPage(page + 1)} disabled={page >= totalPages}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-sand bg-white text-stone-500 hover:border-gold hover:text-gold transition disabled:opacity-40">
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Mobile filters bottom sheet */}
      {filtersOpen && (
        <div className="fixed inset-0 z-[90] md:hidden">
          <div className="absolute inset-0 bg-ink/50 fade-in" onClick={() => setFiltersOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto bg-ivory rounded-t-3xl p-5 slide-up">
            <div className="flex items-center justify-between mb-4">
              <p className="font-bold text-ink">الفلاتر</p>
              <button onClick={() => setFiltersOpen(false)} className="text-stone-400 hover:text-ink"><X className="w-6 h-6" /></button>
            </div>
            {filterPanel}
            <button onClick={() => setFiltersOpen(false)}
              className="mt-5 w-full rounded-full bg-ink py-3 font-bold text-ivory hover:bg-gold transition">
              عرض النتائج
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

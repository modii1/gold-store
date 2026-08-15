"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X, TrendingUp, Loader2 } from "lucide-react";
import { searchProductsAction } from "@/app/actions/search";
import { formatCurrency } from "@/lib/format";
import { Currency } from "@/components/storefront/currency";
import type { SearchResult } from "@/lib/services/products";

export function SearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setResults([]);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const runSearch = (value: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (!value.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(async () => {
      const r = await searchProductsAction(value.trim());
      setResults(r);
      setLoading(false);
    }, 250);
  };

  if (!open) return null;

  const goTo = (slug: string) => {
    onClose();
    router.push(`/product/${slug}`);
  };

  return (
    <div className="fixed inset-0 z-[100]">
      <div className="absolute inset-0 bg-ink/50 fade-in" onClick={onClose} />
      <div className="absolute inset-x-0 top-0 bg-ivory shadow-2xl slide-up">
        <div className="mx-auto max-w-3xl px-4 py-5">
          <div className="flex items-center gap-3 rounded-full bg-white border border-sand px-5 py-3 shadow-sm">
            <Search className="w-5 h-5 text-gold" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                runSearch(e.target.value);
              }}
              placeholder="ابحثي عن قطعة تليق بك..."
              className="flex-1 bg-transparent text-sm font-medium text-ink placeholder:text-stone-400 focus:outline-none"
            />
            {loading && <Loader2 className="w-4 h-4 animate-spin text-gold" />}
            <button onClick={onClose} className="text-stone-400 hover:text-ink transition">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="mt-5 min-h-[200px] max-h-[60vh] overflow-y-auto">
            {!q.trim() && (
              <div className="text-center py-10 text-stone-400 text-sm">
                <TrendingUp className="w-8 h-8 mx-auto mb-3 text-gold/60" />
                اكتبي اسم المنتج أو SKU أو التصنيف لبدء البحث
              </div>
            )}

            {q.trim() && !loading && results.length === 0 && (
              <div className="text-center py-10 text-stone-400 text-sm">لا توجد نتائج لـ "{q}"</div>
            )}

            {results.length > 0 && (
              <ul className="space-y-1">
                {results.map((r) => (
                  <li key={r.id}>
                    <button
                      onClick={() => goTo(r.slug)}
                      className="flex w-full items-center gap-4 rounded-xl p-2 hover:bg-white transition"
                    >
                      {r.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.image} alt="" loading="lazy" className="h-14 w-14 rounded-lg object-cover bg-white" />
                      ) : (
                        <div className="h-14 w-14 rounded-lg bg-sand/50" />
                      )}
                      <div className="flex-1 text-end">
                        <p className="text-sm font-bold text-ink">{r.name}</p>
                        <p className="text-xs text-stone-400">
                          {r.category || ""}
                          {r.sku ? ` • ${r.sku}` : ""}
                        </p>
                      </div>
                      <Currency value={r.sale_price || r.price} className="text-sm font-bold text-gold" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

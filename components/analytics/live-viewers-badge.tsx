"use client";

import { useEffect, useState } from "react";
import { pluralizeArabic } from "@/lib/format";

/**
 * Motivational live-viewer badge shown on product pages.
 * Polls `/api/analytics/viewers` for a boosted viewing count and renders it.
 * Read-only — fires no analytics events itself (the ProductViewTracker does).
 */
export function LiveViewersBadge({ productId }: { productId: string }) {
  const [viewers, setViewers] = useState<number | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const res = await fetch(`/api/analytics/viewers?product_id=${encodeURIComponent(productId)}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (active && typeof data.viewers === "number") setViewers(data.viewers);
      } catch {
        /* best-effort; leave count hidden on failure */
      }
    };

    load();
    const interval = setInterval(load, 30000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [productId]);

  if (viewers === null) return null;

  return (
    <div className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 transition">
      <span className="relative flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
      </span>
      <span>{viewers} {pluralizeArabic(viewers, "عميل", "عميلين", "عملاء")} {pluralizeArabic(viewers, "يشاهد", "يشاهدان", "يشاهدون")} هذا المنتج الآن</span>
    </div>
  );
}

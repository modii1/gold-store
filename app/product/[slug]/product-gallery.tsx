"use client";

import { useState, useEffect } from "react";
import { PlayCircle, Image as ImageIcon, Maximize2, ZoomIn, ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Product } from "@/types";

export function ProductGallery({ product }: { product: Product }) {
  const items = [
    ...(product.videos || []).map((v) => ({ ...v, type: "video" as const })),
    ...(product.images || []).map((i) => ({ ...i, type: "image" as const })),
  ];
  const [active, setActive] = useState(0);

  const [override, setOverride] = useState<string | null>(null);
  // Sync gallery image when color selected in BuyPanel (supports variant image_url)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ index: number; image_url?: string }>).detail;
      if (detail.image_url) {
        const idx = items.findIndex((it) => it.url === detail.image_url);
        if (idx >= 0) { setOverride(null); setActive(idx); }
        else setOverride(detail.image_url);
        return;
      }
      const videoCount = (product.videos || []).length;
      const imageCount = (product.images || []).length;
      if (detail.index >= 0 && detail.index < imageCount) {
        setOverride(null);
        setActive(videoCount + detail.index);
      }
    };
    window.addEventListener("color-select" as any, handler);
    return () => window.removeEventListener("color-select" as any, handler);
  }, [product.videos, product.images, items]);
  const [fullscreen, setFullscreen] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFullscreen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);
  const current = items[active];
  const displayItem = override ? { url: override, type: "image" as const } : current;

  const previous = () => { setOverride(null); setActive((value) => (value - 1 + items.length) % items.length); };
  const next = () => { setOverride(null); setActive((value) => (value + 1) % items.length); };

  if (items.length === 0) {
    return (
      <div className="rounded-2xl bg-cream border border-sand aspect-[4/5] flex items-center justify-center text-stone-300">
        لا توجد وسائط
      </div>
    );
  }

  const media = (autoPlay: boolean) =>
    displayItem.type === "video" ? (
      <video
        key={displayItem.url}
        src={displayItem.url}
        controls
        autoPlay={autoPlay}
        muted
        playsInline
        preload="metadata"
        className="h-full w-full object-contain p-2 md:p-4"
      />
    ) : (
      // eslint-disable-next-line @next/next/no-img-element
       <img src={displayItem.url} alt={product.name} className="h-full w-full object-contain p-2 md:p-6 select-none" draggable={false} fetchPriority="high" />
    );

  return (
    <div className="space-y-4">
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl bg-white border border-sand shadow-sm aspect-square md:aspect-[4/5]",
          fullscreen && "fixed inset-0 z-[120] rounded-none bg-white flex items-center justify-center"
        )}
      >
        <div
          className="h-full w-full cursor-zoom-in"
          onClick={() => !fullscreen && setFullscreen(true)}
          onTouchStart={(event) => setTouchStart(event.touches[0]?.clientX ?? null)}
          onTouchEnd={(event) => {
            if (touchStart === null) return;
            const distance = (event.changedTouches[0]?.clientX ?? touchStart) - touchStart;
            if (Math.abs(distance) > 45) (distance > 0 ? previous : next)();
            setTouchStart(null);
          }}
        >
          {media(fullscreen)}
        </div>

        {!fullscreen && (
          <>
            {items.length > 1 && (
              <>
                <button onClick={previous} className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-ink shadow backdrop-blur transition hover:text-gold" aria-label="الصورة السابقة">
                  <ChevronRight className="h-5 w-5" />
                </button>
                <button onClick={next} className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-ink shadow backdrop-blur transition hover:text-gold" aria-label="الصورة التالية">
                  <ChevronLeft className="h-5 w-5" />
                </button>
              </>
            )}
            <button
              onClick={() => setZoomed((z) => !z)}
              className="absolute bottom-4 start-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/85 backdrop-blur text-ink shadow border border-sand hover:text-gold transition"
              aria-label="تكبير"
            >
              <ZoomIn className="w-5 h-5" />
            </button>
            <button
              onClick={() => setFullscreen(true)}
              className="absolute bottom-4 end-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/85 backdrop-blur text-ink shadow border border-sand hover:text-gold transition"
              aria-label="ملء الشاشة"
            >
              <Maximize2 className="w-5 h-5" />
            </button>
            {zoomed && displayItem.type === "image" && (
              <div className="pointer-events-none absolute inset-0 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={displayItem.url} alt="" className="absolute inset-0 h-full w-full object-contain scale-[2] cursor-zoom-out" />
              </div>
            )}
          </>
        )}
        {fullscreen && (
          <>
            <button
              onClick={() => setFullscreen(false)}
              className="absolute top-4 start-4 flex h-10 w-10 items-center justify-center rounded-full bg-ink text-white shadow-lg hover:bg-gold transition z-10"
              aria-label="إغلاق"
            >
              <X className="w-5 h-5" />
            </button>
            {items.length > 1 && (
              <>
                <button onClick={previous} className="absolute right-4 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-ink shadow-lg hover:text-gold transition z-10" aria-label="السابق">
                  <ChevronRight className="h-6 w-6" />
                </button>
                <button onClick={next} className="absolute left-4 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-ink shadow-lg hover:text-gold transition z-10" aria-label="التالي">
                  <ChevronLeft className="h-6 w-6" />
                </button>
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-1.5 bg-black/50 backdrop-blur rounded-full px-3 py-1.5">
                  {items.map((_, i) => (
                    <span key={i} className={cn("h-1.5 rounded-full transition-all", i === active && !override ? "w-5 bg-white" : override ? "w-1.5 bg-white/60" : "w-1.5 bg-white/60")} />
                  ))}
                  {override && <span className="h-1.5 w-5 rounded-full bg-gold" />}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {items.length > 1 && (
        <div className="space-y-3">
          <div className="flex justify-center gap-1.5" aria-label="مؤشر الصور">
            {items.map((item, i) => (
              <button key={`dot-${i}`} onClick={() => setActive(i)} className={cn("h-1.5 rounded-full transition-all", active === i ? "w-6 bg-gold" : "w-1.5 bg-sand")} aria-label={`الصورة ${i + 1}`} />
            ))}
          </div>
          <div className="scrollbar-hide flex gap-3 overflow-x-auto pb-1">
          {items.map((item, i) => {
            const variant = (product as any).variants?.find((v: any) => v.image_url === item.url) as any;
            return (
            <button
              key={i}
              onClick={() => { setOverride(null); setActive(i); }}
              className={cn(
                "relative h-20 w-20 md:h-24 md:w-24 shrink-0 overflow-hidden rounded-xl border-2 bg-white transition",
                active === i ? "border-gold" : "border-transparent opacity-60 hover:opacity-100"
              )}
            >
              {item.type === "video" ? (
                <span className="flex h-full w-full items-center justify-center bg-ink text-ivory">
                  <PlayCircle className="w-6 h-6 text-gold" />
                </span>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                 <img src={item.url} alt="" loading={i === 0 ? "eager" : "lazy"} className="h-full w-full object-cover" />
              )}
              <span className="absolute bottom-0 inset-x-0 bg-black/40 flex items-center justify-center py-0.5">
                {item.type === "video" ? <PlayCircle className="w-3 h-3 text-gold" /> : <ImageIcon className="w-3 h-3 text-white" />}
              </span>
              {variant?.color_hex && (
                <span className="absolute top-1.5 start-1.5 h-4 w-4 rounded-full border-2 border-white shadow" style={{ background: variant.color_hex }} title={variant.color || ""} />
              )}
              {variant?.color && !variant?.color_hex && (
                <span className="absolute top-1.5 start-1.5 rounded-full bg-black/60 px-1 py-0.5 text-[9px] font-bold text-white">{variant.color}</span>
              )}
            </button>
          )})}
          </div>
        </div>
      )}
    </div>
  );
}

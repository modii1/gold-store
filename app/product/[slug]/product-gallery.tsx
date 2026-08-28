"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Play, X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCcw, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MediaItem, Product } from "@/types";

type GalleryItem = MediaItem & { type: "image" | "video" };

const MAX_STAGE_H = 640;
const MAX_STAGE_W = 560;
const PLACEHOLDER_RATIO = 4 / 5;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.5;

type GalleryProps =
  | { images: MediaItem[]; videos: MediaItem[]; productName: string }
  | { product: Product };

export function ProductGallery(props: GalleryProps) {
  const images = "images" in props ? props.images : (props.product.images || []);
  const videos = "videos" in props ? props.videos : (props.product.videos || []);
  const productName = "productName" in props ? props.productName : props.product.name;

  const items: GalleryItem[] = [
    ...videos.map((v) => ({ ...v, type: "video" as const })),
    ...images.map((i) => ({ ...i, type: "image" as const })),
  ];

  const [active, setActive] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [override, setOverride] = useState<string | null>(null);

  const viewportRef = useRef<HTMLDivElement>(null);
  const touchRef = useRef<{ startX: number; startY: number; time: number } | null>(null);

  // Zoom state
  const [zoom, setZoom] = useState(1);
  const [origin, setOrigin] = useState({ x: 0.5, y: 0.5 }); // zoom focal point (0-1)
  const [offset, setOffset] = useState({ x: 0, y: 0 }); // pan px
  const dragRef = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const current = items[active];
  // When a color is selected but its image is not part of the gallery items,
  // show it as an override (always an image).
  const displayItem: GalleryItem | null = override ? { url: override, type: "image" as const } : current;

  const resetZoom = useCallback(() => {
    setZoom(1);
    setOrigin({ x: 0.5, y: 0.5 });
    setOffset({ x: 0, y: 0 });
  }, []);

  const goTo = useCallback((index: number) => {
    setActive(index);
    setNatural(null);
    setOverride(null);
    resetZoom();
  }, [resetZoom]);

  const previous = useCallback(() => goTo((active - 1 + items.length) % items.length), [active, goTo, items.length]);
  const next = useCallback(() => goTo((active + 1) % items.length), [active, goTo, items.length]);

  // Sync gallery when a color/tolifa is selected in BuyPanel: switch to that variant's image
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ index: number; image_url?: string }>).detail;
      if (!detail) return;
      if (detail.image_url) {
        const idx = items.findIndex((it) => it.url === detail.image_url);
        if (idx >= 0) { setOverride(null); setActive(idx); }
        else setOverride(detail.image_url);
      } else if (detail.index >= 0 && detail.index < items.length) {
        setOverride(null);
        setActive(detail.index);
      }
    };
    window.addEventListener("color-select" as any, handler);
    return () => window.removeEventListener("color-select" as any, handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  useEffect(() => { if (active >= items.length) setActive(0); }, [items.length, active]);
  useEffect(() => { setNatural(null); resetZoom(); }, [active, resetZoom]);

  useEffect(() => {
    if (fullscreen) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [fullscreen]);

  useEffect(() => { resetZoom(); }, [fullscreen, resetZoom]);

  const zoomBy = useCallback((dir: 1 | -1) => {
    setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z + dir * ZOOM_STEP)));
  }, []);

  const clampOffset = useCallback((x: number, y: number, z: number) => {
    const el = viewportRef.current;
    if (!el) return { x, y };
    const maxX = (el.clientWidth * (z - 1)) / 2;
    const maxY = (el.clientHeight * (z - 1)) / 2;
    return { x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) };
  }, []);

  // Zoom focus onto a given client point (double-click)
  const zoomAtPoint = useCallback((clientX: number, clientY: number) => {
    const el = viewportRef.current;
    if (!el) return;
    // Recenter focal origin to the clicked point for the new zoom level
    setOrigin((prev) => {
      const rect = el.getBoundingClientRect();
      const px = (clientX - rect.left) / rect.width;
      const py = (clientY - rect.top) / rect.height;
      return { x: px, y: py };
    });
    setZoom((prev) => Math.min(MAX_ZOOM, prev * 2));
    // Reset pan so focal point is centered at zoom-in
    setOffset((o) => clampOffset(o.x, o.y, Math.min(MAX_ZOOM, zoom * 2)));
  }, [clampOffset, zoom]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (displayItem?.type === "video") return;
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1 : -1);
  }, [displayItem?.type, zoomBy]);

  if (items.length === 0) {
    return (
      <div className="relative bg-stone-50 border border-stone-100 flex items-center justify-center aspect-[4/5]">
        <p className="text-sm text-stone-300">لا توجد صور</p>
      </div>
    );
  }

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.naturalWidth > 0) setNatural({ w: img.naturalWidth, h: img.naturalHeight });
  };

  function stageStyle(): React.CSSProperties {
    if (displayItem?.type === "video") {
      return { aspectRatio: "16/9", maxHeight: MAX_STAGE_H, width: "100%" };
    }
    if (natural && natural.h > 0) {
      const ratio = natural.w / natural.h;
      let w = MAX_STAGE_W;
      let h = w / ratio;
      if (h > MAX_STAGE_H) { h = MAX_STAGE_H; w = h * ratio; }
      return { aspectRatio: `${w} / ${h}`, maxWidth: "100%", marginLeft: "auto", marginRight: "auto" };
    }
    return { aspectRatio: `${PLACEHOLDER_RATIO}`, width: "100%" };
  }

  const renderMedia = (item: GalleryItem) => {
    if (item.type === "video") {
      return <video key={item.url} src={item.url} controls muted playsInline preload="metadata" className="w-full h-full object-contain" />;
    }
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        key={item.url}
        src={item.url}
        alt={item.caption || productName}
        onLoad={handleImageLoad}
        className="w-full h-full object-contain select-none pointer-events-none"
        draggable={false}
      />
    );
  };

  const thumbBtn = (item: GalleryItem, i: number) => (
    <button
      key={i}
      onClick={() => goTo(i)}
      className={cn(
        "relative shrink-0 overflow-hidden rounded-lg border-2 transition",
        "w-16 h-20 md:w-20 md:h-24",
        active === i ? "border-gold" : "border-transparent opacity-60 hover:opacity-100"
      )}
    >
      {item.type === "video" ? (
        <div className="w-full h-full bg-stone-900 flex items-center justify-center"><Play className="w-4 h-4 text-gold" /></div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.url} alt="" loading={i === 0 ? "eager" : "lazy"} className="w-full h-full object-cover" />
      )}
    </button>
  );

  const navArrows = () => (
    items.length > 1 && (
      <div className="pointer-events-none absolute inset-0 flex items-center justify-between px-2">
        <button onClick={(e) => { e.stopPropagation(); previous(); }}
          className="pointer-events-auto w-10 h-10 flex items-center justify-center rounded-full bg-white/90 text-stone-500 hover:text-gold border border-stone-200 transition shadow-sm" aria-label="السابق">
          <ChevronRight className="w-5 h-5" />
        </button>
        <button onClick={(e) => { e.stopPropagation(); next(); }}
          className="pointer-events-auto w-10 h-10 flex items-center justify-center rounded-full bg-white/90 text-stone-500 hover:text-gold border border-stone-200 transition shadow-sm" aria-label="التالي">
          <ChevronLeft className="w-5 h-5" />
        </button>
      </div>
    )
  );

  const isVideo = displayItem?.type === "video";

  return (
    <>
      <div className="flex gap-3">
        {items.length > 1 && (
          <div className="hidden lg:flex flex-col gap-2 overflow-y-auto scrollbar-hide max-h-[640px]">
            {items.map((item, i) => thumbBtn(item, i))}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div
            className="relative rounded-2xl bg-cream border border-sand overflow-hidden group"
            style={stageStyle()}
            onTouchStart={(e) => {
              const t = e.touches[0];
              touchRef.current = { startX: t.clientX, startY: t.clientY, time: Date.now() };
            }}
            onTouchEnd={(e) => {
              if (!touchRef.current) return;
              const t = e.changedTouches[0];
              const dx = t.clientX - touchRef.current.startX;
              const dy = t.clientY - touchRef.current.startY;
              const dt = Date.now() - touchRef.current.time;
              touchRef.current = null;
              if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && dt < 500) {
                dx > 0 ? previous() : next();
              }
            }}
          >
            {displayItem && renderMedia(displayItem)}
            {displayItem?.type === "video" && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-14 h-14 rounded-full bg-black/30 flex items-center justify-center">
                  <Play className="w-6 h-6 text-white fill-white ml-0.5" />
                </div>
              </div>
            )}
            {navArrows()}
            {!isVideo && (
              <button onClick={() => setFullscreen(true)} className="absolute bottom-2.5 left-2.5 w-9 h-9 rounded-full bg-white/90 border border-stone-200 flex items-center justify-center text-stone-400 hover:text-gold transition shadow-sm" aria-label="عرض كامل">
                <Maximize2 className="w-4 h-4" />
              </button>
            )}
          </div>

          {items.length > 1 && (
            <div className="mt-3 flex gap-2 overflow-x-auto scrollbar-hide lg:hidden">
              {items.map((item, i) => thumbBtn(item, i))}
            </div>
          )}
        </div>
      </div>

      {/* Fullscreen with zoom & pan */}
      {fullscreen && displayItem && (
        <div className="fixed inset-0 z-[120] bg-black flex flex-col">
          {/* Top bar */}
          <div className="flex items-center justify-between p-3 md:p-4">
            <span className="text-white/60 text-sm">{active + 1} / {items.length}</span>
            <div className="flex items-center gap-2">
              {!isVideo && (
                <>
                  <button onClick={() => zoomBy(-1)} disabled={zoom <= 1}
                    className="w-9 h-9 md:w-10 md:h-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/25 transition disabled:opacity-30" aria-label="تصغير">
                    <ZoomOut className="w-5 h-5" />
                  </button>
                  <span className="text-white/70 text-xs w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
                  <button onClick={() => zoomBy(1)} disabled={zoom >= MAX_ZOOM}
                    className="w-9 h-9 md:w-10 md:h-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/25 transition disabled:opacity-30" aria-label="تكبير">
                    <ZoomIn className="w-5 h-5" />
                  </button>
                  <button onClick={resetZoom} disabled={zoom === 1}
                    className="w-9 h-9 md:w-10 md:h-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/25 transition disabled:opacity-30" aria-label="إعادة الحجم الأصلي">
                    <RotateCcw className="w-4 h-4" />
                  </button>
                </>
              )}
              <button onClick={() => setFullscreen(false)} className="w-9 h-9 md:w-10 md:h-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/25 transition" aria-label="إغلاق">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Zoomable viewport */}
          <div
            ref={viewportRef}
            className="flex-1 relative overflow-hidden select-none touch-none"
            onWheel={handleWheel}
            onDoubleClick={(e) => { e.stopPropagation(); if (!isVideo) { zoom === 1 ? zoomAtPoint(e.clientX, e.clientY) : resetZoom(); } }}
            onPointerDown={(e) => {
              if (isVideo || zoom === 1) return;
              e.stopPropagation();
              dragRef.current = { startX: e.clientX, startY: e.clientY, ox: offset.x, oy: offset.y };
              setDragging(true);
            }}
            onPointerMove={(e) => {
              if (!dragRef.current) return;
              const dx = e.clientX - dragRef.current.startX;
              const dy = e.clientY - dragRef.current.startY;
              setOffset(clampOffset(dragRef.current.ox + dx, dragRef.current.oy + dy, zoom));
            }}
            onPointerUp={() => { dragRef.current = null; setDragging(false); }}
            onPointerLeave={() => { dragRef.current = null; setDragging(false); }}
            style={{ cursor: zoom > 1 ? (dragging ? "grabbing" : "grab") : "zoom-in" }}
          >
            <div
              className="absolute inset-0 flex items-center justify-center will-change-transform"
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                transformOrigin: `${origin.x * 100}% ${origin.y * 100}%`,
                transition: dragging ? "none" : "transform 150ms ease-out",
              }}
            >
              {renderMedia(displayItem)}
            </div>

            {zoom === 1 && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 pointer-events-none text-[11px] text-white/70 bg-black/40 rounded-full px-3 py-1">
                نقرة مزدوجة للتكبير • عجلة الماوس للتقريب
              </div>
            )}

            {/* Floating close button — positioned in the upper area of the image so the
                center zoom/pan area stays clear for the magnifier + drag */}
            {!isVideo && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (zoom > 1) {
                    resetZoom();
                  } else {
                    setFullscreen(false);
                  }
                }}
                className="absolute left-1/2 top-[28%] -translate-x-1/2 -translate-y-1/2 flex h-11 w-11 items-center justify-center rounded-full shadow-xl transition hover:scale-105"
                aria-label={zoom > 1 ? "رجوع للحجم الأصلي" : "إغلاق والعودة للمنتج"}
                title={zoom > 1 ? "رجوع للحجم الأصلي" : "إغلاق والعودة للمنتج"}
                style={{ background: zoom > 1 ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.85)" }}
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
                onPointerMove={(e) => e.stopPropagation()}
                onPointerCancel={(e) => e.stopPropagation()}
              >
                {zoom > 1 ? (
                  <svg className="w-5 h-5 text-stone-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
                ) : (
                  <X className="w-5 h-5 text-stone-700" />
                )}
              </button>
            )}

            {!isVideo && zoom === 1 && items.length > 1 && (
              <div className="absolute inset-x-0 top-1/2 flex justify-between px-3 -translate-y-1/2">
                <button onClick={previous} className="w-10 h-10 rounded-full bg-white/10 text-white hover:bg-white/25 transition" aria-label="السابق"><ChevronRight className="w-5 h-5 mx-auto mt-2.5" /></button>
                <button onClick={next} className="w-10 h-10 rounded-full bg-white/10 text-white hover:bg-white/25 transition" aria-label="التالي"><ChevronLeft className="w-5 h-5 mx-auto mt-2.5" /></button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

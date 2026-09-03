"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { X, Check, Loader2 } from "lucide-react";

/**
 * أداة قصّ صور احترافية (أنيقة، متوافقة مع الجوال والكمبيوتر).
 * تُظهر الصورة داخل مساحة تحرير مع مربع تحديد قابل للسحب والتحجيم،
 * يُعتَّم ما خارج المربع، ويُحفظ الجزء المحدد فقط عبر canvas بأقصى جودة.
 * تعمل بـ Pointer Events (تلمس + ماوس) دون أي مكتبة خارجية.
 */
type DragMode = "move" | "resize" | "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w";
type DragState = { mode: DragMode; startX: number; startY: number; startCrop: { x: number; y: number; w: number; h: number }; imgW: number; imgH: number };

export function ImageCropperModal({
  src,
  fileType,
  onCancel,
  onConfirm,
  aspect = 1,
  title = "قصّ الصورة",
}: {
  src: string;
  fileType?: string; // MIME type الأصلي للملف (image/png, image/webp, إلخ)
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
  aspect?: number; // نسبة الأبعاد، 1 = مربع
  title?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [stage, setStage] = useState({ w: 0, h: 0, imgW: 0, imgH: 0, scale: 1 });
  const [crop, setCrop] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const dragRef = useRef<DragState | null>(null);

  // تحميل الصورة وتجهيز بيانات العرض
  const onImgLoad = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const availableW = containerRef.current?.clientWidth || 600;
    const availableH = Math.min(480, window.innerHeight * 0.6);
    // نقيّس الصورة لتناسب المساحة المتاحة (نسبة أبعادها الأصلية، دون إنزال جودتها)
    const scale = Math.min(availableW / img.naturalWidth, availableH / img.naturalHeight);
    const dispW = Math.round(img.naturalWidth * scale);
    const dispH = Math.round(img.naturalHeight * scale);
    setImgEl(img);
    setStage({ w: dispW, h: dispH, imgW: dispW, imgH: dispH, scale });
    // مربع القص الافتراضي: متمركز، بنسبة البُعد المستهدفة
    let cw: number, ch: number;
    if (aspect) {
      if (dispW / dispH > aspect) {
        ch = Math.min(dispH, dispW / aspect);
        cw = ch * aspect;
      } else {
        cw = Math.min(dispW, dispH * aspect);
        ch = cw / aspect;
      }
    } else {
      cw = dispW;
      ch = dispH;
    }
    // حدّ أقصى 95% من مساحة العرض كي يبقى المربع قابلاً للسحب
    const mw = Math.min(dispW * 0.95, dispW);
    const mh = Math.min(dispH * 0.95, dispH);
    if (aspect) {
      cw = Math.min(cw, mw);
      ch = cw / aspect;
      if (ch > mh) { ch = mh; cw = ch * aspect; }
    } else {
      // نسبة حرة: ابدأ بكامل الصورة مع هامش بسيط
      cw = mw;
      ch = mh;
    }
    const cx = (dispW - cw) / 2;
    const cy = (dispH - ch) / 2;
    setCrop({ x: cx, y: cy, w: cw, h: ch });
  }, [aspect]);

  useEffect(() => {
    // انتظار ظهور الحاوية لقياس أبعادها
    const t = setTimeout(() => onImgLoad(), 0);
    return () => clearTimeout(t);
  }, [onImgLoad]);

  // حساب حدود المربع داخل حدود الصورة المعروضة (المرحلة = أبعاد الصورة بالضبط)
  const clampCrop = useCallback((c: { x: number; y: number; w: number; h: number }) => {
    if (!stage.imgW || !stage.imgH) return c;
    const minX = 0;
    const maxX = stage.imgW;
    const minY = 0;
    const maxY = stage.imgH;
    const { w, h } = c;
    let { x, y } = c;
    if (x < minX) x = minX;
    if (y < minY) y = minY;
    if (x + w > maxX) x = maxX - w;
    if (y + h > maxY) y = maxY - h;
    return { x, y, w, h };
  }, [stage]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!stage.imgW || !stage.imgH) return;
    const rect = stageRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const edge = 14; // منطقة التحجيم من الحواف والزوايا
    const inX = px >= crop.x - edge && px <= crop.x + crop.w + edge;
    const inY = py >= crop.y - edge && py <= crop.y + crop.h + edge;
    let mode: DragMode = "move";
    if (inX && inY) {
      const nearL = Math.abs(px - crop.x) <= edge;
      const nearR = Math.abs(px - (crop.x + crop.w)) <= edge;
      const nearT = Math.abs(py - crop.y) <= edge;
      const nearB = Math.abs(py - (crop.y + crop.h)) <= edge;
      if (nearL && nearT) mode = "nw";
      else if (nearR && nearT) mode = "ne";
      else if (nearL && nearB) mode = "sw";
      else if (nearR && nearB) mode = "se";
      else if (nearT) mode = "n";
      else if (nearB) mode = "s";
      else if (nearL) mode = "w";
      else if (nearR) mode = "e";
      else mode = "move";
    } else if (!(px >= crop.x && px <= crop.x + crop.w && py >= crop.y && py <= crop.y + crop.h)) {
      // النقر خارج المربع: تجاهل (لمنع السحب العشوائي)
      return;
    }
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = { mode, startX: px, startY: py, startCrop: { ...crop }, imgW: stage.imgW, imgH: stage.imgH };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const rect = stageRef.current!.getBoundingClientRect();
    const dx = e.clientX - rect.left - d.startX;
    const dy = e.clientY - rect.top - d.startY;
    const c = { ...d.startCrop };

    if (d.mode === "move") {
      c.x = d.startCrop.x + dx;
      c.y = d.startCrop.y + dy;
    } else {
      // ---- التحجيم مع الحفاظ على موضع النقطة المقابلة للزاوية/الحافة المقابلة ----
      if (d.mode === 'se') {
        c.w = d.startCrop.w + dx;
        if (aspect) c.h = c.w / aspect;
        else c.h = d.startCrop.h + dy;
      } else if (d.mode === 'e') {
        c.w = d.startCrop.w + dx;
        if (aspect) c.h = c.w / aspect;
      } else if (d.mode === 'sw') {
        c.w = d.startCrop.w - dx;
        c.x = d.startCrop.x + dx;
        if (aspect) c.h = c.w / aspect;
        else c.h = d.startCrop.h + dy;
      } else if (d.mode === 'ne') {
        c.w = d.startCrop.w + dx;
        if (aspect) { c.h = c.w / aspect; c.y = d.startCrop.y + (d.startCrop.h - c.h); }
        else { c.h = d.startCrop.h - dy; c.y = d.startCrop.y + dy; }
      } else if (d.mode === 'nw') {
        c.w = d.startCrop.w - dx;
        c.x = d.startCrop.x + dx;
        if (aspect) { c.h = c.w / aspect; c.y = d.startCrop.y + (d.startCrop.h - c.h); }
        else { c.h = d.startCrop.h - dy; c.y = d.startCrop.y + dy; }
      } else if (d.mode === 'n') {
        c.h = d.startCrop.h - dy;
        c.y = d.startCrop.y + dy;
      } else if (d.mode === 's') {
        c.h = d.startCrop.h + dy;
      } else if (d.mode === 'w') {
        c.w = d.startCrop.w - dx;
        c.x = d.startCrop.x + dx;
      }
      if (aspect) {
        if (c.w < 30) return;
        // إعادة ضبط y وفق المحاذاة العمودية (المنتصف) عند التحجيم من الحواف e/w
        if (d.mode === 'e' || d.mode === 'w') { c.y = d.startCrop.y; }
      } else {
        if (c.w < 30 || c.h < 30) return;
      }
    }

    setCrop(clampCrop(c));
  };

  const endDrag = () => { dragRef.current = null; };

  // الحفظ: قصّ canvas بالجزء المحدد
  const doCrop = async () => {
    if (!imgEl || !stage.scale) return;
    setProcessing(true);
    const sx = crop.x / stage.scale;
    const sy = crop.y / stage.scale;
    const sw = crop.w / stage.scale;
    const sh = crop.h / stage.scale;

    // كشف الصيغة الحقيقية من أول 12 بايت للملف الأصلي
    let realMime = "image/jpeg";
    try {
      const resp = await fetch(src);
      const headerBuf = new Uint8Array(await resp.arrayBuffer()).slice(0, 12);
      const isPNG = headerBuf[0] === 0x89 && headerBuf[1] === 0x50 && headerBuf[2] === 0x4E && headerBuf[3] === 0x47;
      const isWEBP = headerBuf[0] === 0x52 && headerBuf[1] === 0x49 && headerBuf[2] === 0x46 && headerBuf[3] === 0x46
        && headerBuf[8] === 0x57 && headerBuf[9] === 0x45 && headerBuf[10] === 0x42 && headerBuf[11] === 0x50;
      const isGIF = headerBuf[0] === 0x47 && headerBuf[1] === 0x49 && headerBuf[2] === 0x46;
      realMime = isPNG ? "image/png" : isWEBP ? "image/webp" : isGIF ? "image/gif" : "image/jpeg";
    } catch {
      // fallback: اعتمد على fileType الممرر
      const m = (fileType || "").toLowerCase();
      if (m === "image/png") realMime = "image/png";
      else if (m === "image/webp") realMime = "image/webp";
    }

    if (process.env.NODE_ENV !== "production") {
      console.log("[cropper] realMime:", realMime, "(fileType prop:", fileType, ")");
    }

    const canvas = document.createElement("canvas");
    const outW = Math.max(1, Math.round(sw));
    const outH = Math.max(1, Math.round(sh));
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(imgEl, sx, sy, sw, sh, 0, 0, outW, outH);

    canvas.toBlob(
      (blob) => {
        setProcessing(false);
        if (blob) {
          if (process.env.NODE_ENV !== "production") {
            console.log("[cropper] output blob type:", blob.type, "size:", blob.size);
          }
          setPreviewUrl(URL.createObjectURL(blob));
          onConfirm(blob);
        }
      },
      realMime,
      realMime === "image/jpeg" ? 0.95 : undefined
    );
  };

  const gridCols = [33.33, 66.66];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl lg:mx-4 rounded-2xl bg-white shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-sand px-5 py-3">
          <h3 className="text-lg font-bold text-stone-900">{title}</h3>
          <button onClick={onCancel} aria-label="إغلاق" className="rounded-full p-2 text-stone-400 hover:bg-stone-100 hover:text-stone-700 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stage */}
        <div
          ref={containerRef}
          className="relative px-5 py-4"
        >
          <div
            ref={stageRef}
            className="relative mx-auto overflow-hidden rounded-xl bg-black/95 select-none touch-none"
            style={{
              width: stage.imgW ? `${stage.imgW}px` : "100%",
              height: stage.imgH ? `${stage.imgH}px` : undefined,
              maxWidth: "100%",
              maxHeight: "60vh",
              aspectRatio: stage.imgW && stage.imgH ? `${stage.imgW} / ${stage.imgH}` : "4 / 3",
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerLeave={endDrag}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imgRef}
              src={src}
              alt="بداية القص"
              draggable={false}
              className="relative select-none"
              style={stage.imgW ? { width: stage.imgW, height: stage.imgH } : { opacity: 0 }}
              onLoad={onImgLoad}
            />
            {/* إطار خارجي معتمول (تعتيم ما خارج المربع) */}
            {stage.imgW > 0 && (
              <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${stage.w} ${stage.h}`} preserveAspectRatio="none">
                {/* منطقة تعتيم حول المربع */}
                <defs>
                  <mask id="crop-mask">
                    <rect x="0" y="0" width={stage.w} height={stage.h} fill="white" />
                    <rect x={crop.x} y={crop.y} width={crop.w} height={crop.h} fill="black" />
                  </mask>
                </defs>
                <rect x="0" y="0" width={stage.w} height={stage.h} fill="rgba(0,0,0,0.55)" mask="url(#crop-mask)" />
              </svg>
            )}

            {/* مربع القص */}
            {stage.imgW > 0 && (
              <div
                className="absolute cursor-move touch-none"
                style={{ left: crop.x, top: crop.y, width: crop.w, height: crop.h }}
                onPointerDown={onPointerDown}
              >
                <div className="h-full w-full border-2 border-gold bg-transparent" />
                {/* زوايا التحجيم */}
                <span className="absolute -left-1 -top-1 h-3 w-3 border-2 border-gold bg-white rounded-sm cursor-nwse-resize" />
                <span className="absolute -right-1 -top-1 h-3 w-3 border-2 border-gold bg-white rounded-sm cursor-nesw-resize" />
                <span className="absolute -left-1 -bottom-1 h-3 w-3 border-2 border-gold bg-white rounded-sm cursor-nesw-resize" />
                <span className="absolute -right-1 -bottom-1 h-3 w-3 border-2 border-gold bg-white rounded-sm cursor-nwse-resize" />
                {/* شبكة التقسيم */}
                {gridCols.map((g) => (
                  <div key={'v' + g} className="absolute top-0 bottom-0 w-px bg-white/40" style={{ left: `${g}%` }} />
                ))}
                {gridCols.map((g) => (
                  <div key={'h' + g} className="absolute left-0 right-0 h-px bg-white/40" style={{ top: `${g}%` }} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Preview + Actions */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 px-5 py-4 border-t border-sand">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-stone-500">المعاينة:</span>
            <div className="h-16 w-16 rounded-lg overflow-hidden bg-stone-100 border border-stone-200">
              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl} alt="معاينة بعد القص" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[10px] text-stone-300">—</div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 ms-auto shrink-0">
            <button onClick={onCancel} className="rounded-xl px-5 py-2.5 text-sm font-bold text-stone-600 hover:bg-stone-100 transition">
              إلغاء
            </button>
            <button
              onClick={doCrop}
              disabled={processing}
              className="flex items-center gap-2 rounded-xl bg-gold px-6 py-2.5 text-sm font-bold text-ivory hover:bg-gold-light transition disabled:opacity-60"
            >
              {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              تأكيد القص
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

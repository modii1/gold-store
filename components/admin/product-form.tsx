"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload, X, Image as ImageIcon, PlayCircle, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { saveProductAction } from "@/app/actions/products";
import type { Product, MediaItem } from "@/types";

export function ProductForm({ product }: { product?: Product }) {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [images, setImages] = useState<MediaItem[]>(product?.images || []);
  const [videos, setVideos] = useState<MediaItem[]>(product?.videos || []);
  const [uploading, setUploading] = useState(false);

  const imageInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);

  const uploadFiles = async (files: FileList, kind: "images" | "videos") => {
    setUploading(true);
    setError("");
    const uploaded: MediaItem[] = [];

    for (const file of Array.from(files)) {
      if (kind === "videos" && file.size > 50 * 1024 * 1024) {
        setError("حجم الفيديو يتجاوز 50MB (حد Supabase المجاني)");
        continue;
      }
      const ext = file.name.split(".").pop() || "";
      const path = `${kind}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: upErr } = await supabase.storage.from("products").upload(path, file, { cacheControl: "3600" });
      if (upErr) {
        setError(upErr.message);
        continue;
      }
      const { data: pub } = supabase.storage.from("products").getPublicUrl(path);
      uploaded.push({ url: pub.publicUrl });
    }

    if (kind === "images") setImages((prev) => [...prev, ...uploaded]);
    else setVideos((prev) => [...prev, ...uploaded]);
    setUploading(false);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const formData = new FormData(e.currentTarget);
    formData.set("images", JSON.stringify(images));
    formData.set("videos", JSON.stringify(videos));
    if (product) formData.set("id", product.id);

    const result = await saveProductAction(formData);
    setLoading(false);

    if (result.error) {
      setError(result.error);
      return;
    }
    router.push("/admin/products");
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4 rounded-2xl border border-amber-100 bg-white p-6">
        <h2 className="font-bold text-stone-800">معلومات المنتج</h2>

        <div>
          <label className="block text-sm font-semibold text-stone-700 mb-1">اسم المنتج *</label>
          <input name="name" required defaultValue={product?.name || ""}
            className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-semibold text-stone-700 mb-1">السعر (﷼) *</label>
            <input name="price" type="number" step="0.01" min="0" required defaultValue={product?.price || ""}
              className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-stone-700 mb-1">سعر الخصم (اختياري)</label>
            <input name="sale_price" type="number" step="0.01" min="0" defaultValue={product?.sale_price ?? ""}
              className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-stone-700 mb-1">الكمية / المخزون</label>
            <input name="stock" type="number" min="0" defaultValue={product?.stock ?? 0}
              className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-stone-700 mb-1">SKU</label>
            <input name="sku" defaultValue={product?.sku || ""} dir="ltr"
              className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-stone-700 mb-1">الفئة</label>
            <input name="category" defaultValue={product?.category || ""} placeholder="مثال: أساور" list="cat-options"
              className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20" />
            <datalist id="cat-options">{["أساور", "خواتم", "قلادات", "أطقم", "أقراط", "سبحات", "إكسسوار"].map((c) => <option key={c} value={c} />)}</datalist>
          </div>
          <div>
            <label className="block text-sm font-semibold text-stone-700 mb-1">العلامة / البراند</label>
            <input name="brand" defaultValue={product?.brand || ""} placeholder="مثال: لمعة"
              className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-stone-700 mb-1">الوزن</label>
            <input name="weight" defaultValue={product?.weight || ""} placeholder="مثال: 12 غرام"
              className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-stone-700 mb-1">الوزن بالجرام (للشحن)</label>
            <input name="weight_grams" type="number" min="0" step="0.1" defaultValue={product?.weight_grams ?? ""} placeholder="مثال: 500"
              className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-stone-700 mb-1">العيار / القيراط</label>
            <input name="karat" defaultValue={product?.karat || ""} placeholder="مثال: عيار 18"
              className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-stone-700 mb-1">المادة</label>
            <input name="material" defaultValue={product?.material || ""} placeholder="مثال: ذهب / مطلي"
              className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-stone-700 mb-1">اللون</label>
            <input name="color" defaultValue={product?.color || ""} placeholder="مثال: ذهبي"
              className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold text-stone-700 mb-1">الباركود</label>
          <input name="barcode" defaultValue={product?.barcode || ""} dir="ltr"
            className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20" />
        </div>

        <div>
          <label className="block text-sm font-semibold text-stone-700 mb-1">الوصف</label>
          <textarea name="description" rows={4} defaultValue={product?.description || ""}
            className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20 resize-y" />
        </div>

        <div>
          <label className="block text-sm font-semibold text-stone-700 mb-1">عنوان SEO</label>
          <input name="seo_title" defaultValue={product?.seo_title || ""}
            className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20" />
        </div>

        <div>
          <label className="block text-sm font-semibold text-stone-700 mb-1">وصف SEO</label>
          <textarea name="seo_description" rows={2} defaultValue={product?.seo_description || ""}
            className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20 resize-y" />
        </div>

        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-sm text-stone-600">
            <input name="is_available" type="checkbox" defaultChecked={product ? product.is_available : true} className="accent-gold" />
            متوفر
          </label>
          <label className="flex items-center gap-2 text-sm text-stone-600">
            <input name="featured" type="checkbox" defaultChecked={product?.featured || false} className="accent-gold" />
            مميز
          </label>
          <label className="flex items-center gap-2 text-sm text-stone-600">
            <input name="is_best_seller" type="checkbox" defaultChecked={product?.is_best_seller || false} className="accent-gold" />
            الأكثر مبيعاً
          </label>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button type="submit" disabled={loading || uploading}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-gold py-3 font-bold text-white hover:bg-gold-light transition disabled:opacity-50">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          {product ? "حفظ التعديلات" : "إضافة المنتج"}
        </button>
      </div>

      <div className="space-y-6">
        <div className="rounded-2xl border border-amber-100 bg-white p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-stone-800 flex items-center gap-2">
              <ImageIcon className="w-5 h-5 text-gold" /> الصور
            </h2>
            <button type="button" onClick={() => imageInput.current?.click()} disabled={uploading}
              className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-bold text-gold hover:bg-amber-100 transition disabled:opacity-50">
              <Upload className="w-3.5 h-3.5" /> رفع صور
            </button>
            <input ref={imageInput} type="file" accept="image/*" multiple hidden
              onChange={(e) => e.target.files && uploadFiles(e.target.files, "images")} />
          </div>

          {images.length === 0 ? (
            <p className="text-sm text-stone-400 text-center py-6">لا توجد صور — ارفع صور عالية الجودة</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {images.map((img, i) => (
                <div key={i} className="relative rounded-lg overflow-hidden aspect-square group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt="" className="h-full w-full object-cover" />
                  <button type="button" onClick={() => setImages(images.filter((_, idx) => idx !== i))}
                    className="absolute top-1 left-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-amber-100 bg-white p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-stone-800 flex items-center gap-2">
              <PlayCircle className="w-5 h-5 text-gold" /> الفيديوهات
            </h2>
            <button type="button" onClick={() => videoInput.current?.click()} disabled={uploading}
              className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-bold text-gold hover:bg-amber-100 transition disabled:opacity-50">
              <Upload className="w-3.5 h-3.5" /> رفع فيديو
            </button>
            <input ref={videoInput} type="file" accept="video/*" multiple hidden
              onChange={(e) => e.target.files && uploadFiles(e.target.files, "videos")} />
          </div>
          <p className="text-[11px] text-stone-400 mb-3">الحد الأقصى 50MB لكل فيديو (الباقة المجانية)</p>

          {videos.length === 0 ? (
            <p className="text-sm text-stone-400 text-center py-6">لا توجد فيديوهات — ارفع فيديو يعرض المنتج</p>
          ) : (
            <div className="space-y-2">
              {videos.map((v, i) => (
                <div key={i} className="flex items-center gap-3 rounded-lg bg-stone-50 p-2">
                  <video src={v.url} controls className="h-14 w-20 rounded-md object-cover" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-stone-500 truncate">{v.url.split("/").pop()}</p>
                  </div>
                  <button type="button" onClick={() => setVideos(videos.filter((_, idx) => idx !== i))}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 hover:bg-rose-50 hover:text-rose-600 transition">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {uploading && (
          <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-700">
            <Loader2 className="w-4 h-4 animate-spin" /> جاري رفع الملفات...
          </div>
        )}
      </div>
    </form>
  );
}

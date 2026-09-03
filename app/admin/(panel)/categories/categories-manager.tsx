"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Check, Loader2, Upload, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { saveCategoryAction, deleteCategoryAction } from "@/app/actions/categories-admin";
import { ImageCropperModal } from "@/components/admin/image-cropper";
import type { Category } from "@/types";

type Row = { id?: string; name: string; slug: string; image: string; description: string; sort_order: string; is_active: boolean };

export function CategoriesManager({ categories }: { categories: Category[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [rows, setRows] = useState<Row[]>(
    categories.map((c) => ({
      id: c.id, name: c.name, slug: c.slug, image: c.image || "", description: c.description || "", sort_order: String(c.sort_order ?? 0), is_active: c.is_active,
    }))
  );
  const [loading, setLoading] = useState(false);
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const pickIdx = useRef<number | null>(null);
  // محرر القصّ: الصورة المختارة تُفتح للقصّ قبل الرفع
  const [cropSource, setCropSource] = useState<{ idx: number; url: string; name: string; type: string } | null>(null);

  const addRow = () => setRows((prev) => [...prev, { name: "", slug: "", image: "", description: "", sort_order: String(rows.length + 1), is_active: true }]);

  const updateRow = (idx: number, patch: Partial<Row>) => setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  // رفع النتيجة المقطوعة (blob) — بنفس نظام الرفع الحالي
  const doUpload = async (idx: number, blob: Blob, _baseName: string) => {
    setUploadingIdx(idx);
    const header = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    const isPNG = header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47;
    const isWEBP = header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46;
    const ext = isPNG ? "png" : isWEBP ? "webp" : "jpg";
    const mime = isPNG ? "image/png" : isWEBP ? "image/webp" : "image/jpeg";
    const path = `categories/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const file = new File([blob], `category-${Date.now()}.${ext}`, { type: mime });
    const { error: upErr } = await supabase.storage.from("products").upload(path, file, { cacheControl: "3600" });
    if (upErr) { setError(upErr.message); setUploadingIdx(null); return; }
    const { data } = supabase.storage.from("products").getPublicUrl(path);
    updateRow(idx, { image: data.publicUrl });
    setUploadingIdx(null);
  };

  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const idx = pickIdx.current;
    pickIdx.current = null;
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || idx === null) return;
    // فتح محرر القصّ على الصورة المختارة
    setCropSource({ idx, url: URL.createObjectURL(file), name: file.name, type: file.type });
  };

  const removeImage = (idx: number) => updateRow(idx, { image: "" });

  const saveRow = async (row: Row) => {
    setLoading(true);
    setError("");
    const fd = new FormData();
    if (row.id) fd.set("id", row.id);
    fd.set("name", row.name);
    fd.set("slug", row.slug);
    fd.set("image", row.image);
    fd.set("description", row.description);
    fd.set("sort_order", row.sort_order);
    fd.set("is_active", row.is_active ? "on" : "");
    const res = await saveCategoryAction(fd);
    setLoading(false);
    if (res.error) { setError(res.error); return; }
    router.refresh();
  };

  const delRow = async (row: Row) => {
    if (!row.id) { setRows((prev) => prev.filter((r) => r !== row)); return; }
    if (!confirm("حذف التصنيف؟")) return;
    const fd = new FormData();
    fd.set("id", row.id);
    const res = await deleteCategoryAction(fd);
    if (res.error) { setError(res.error); return; }
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-stone-900">التصنيفات</h1>
        <button onClick={addRow} className="flex items-center gap-2 rounded-xl bg-gold px-4 py-2.5 text-sm font-bold text-white hover:bg-gold-light transition">
          <Plus className="w-4 h-4" /> إضافة تصنيف
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="overflow-x-auto rounded-2xl border border-amber-100 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-100 text-end text-stone-500">
              <th className="p-3 font-semibold">صورة التصنيف</th>
              <th className="p-3 font-semibold">الاسم</th>
              <th className="p-3 font-semibold hidden md:table-cell">Slug</th>
              <th className="p-3 font-semibold hidden md:table-cell">الترتيب</th>
              <th className="p-3 font-semibold">نشط</th>
              <th className="p-3 font-semibold">إجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-50">
            {rows.map((row, i) => (
              <tr key={i} className="align-top">
                <td className="p-3 w-28">
                  <div className="relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border border-amber-100 bg-cream">
                    {row.image ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={row.image} alt="صورة التصنيف" className="h-full w-full object-cover" />
                        <button type="button" onClick={() => removeImage(i)} title="حذف الصورة"
                          className="absolute top-0.5 start-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-red-500 transition">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </>
                    ) : (
                      <button type="button" onClick={() => { pickIdx.current = i; fileInput.current?.click(); }} disabled={uploadingIdx === i}
                        title="رفع صورة التصنيف"
                        className="flex h-full w-full flex-col items-center justify-center gap-1 text-stone-400 hover:text-gold transition">
                        {uploadingIdx === i ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
                      </button>
                    )}
                  </div>
                </td>
                <td className="p-3">
                  <input value={row.name} onChange={(e) => updateRow(i, { name: e.target.value })} placeholder="اسم التصنيف"
                    className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm" />
                </td>
                <td className="p-3 hidden md:table-cell">
                  <input value={row.slug} onChange={(e) => updateRow(i, { slug: e.target.value })} placeholder="slug" dir="ltr"
                    className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm" />
                </td>
                <td className="p-3 w-20 hidden md:table-cell">
                  <input value={row.sort_order} onChange={(e) => updateRow(i, { sort_order: e.target.value })} type="number"
                    className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm" />
                </td>
                <td className="p-3 w-16 text-center">
                  <input type="checkbox" checked={row.is_active} onChange={(e) => updateRow(i, { is_active: e.target.checked })} className="accent-gold" />
                </td>
                <td className="p-3 whitespace-nowrap">
                  <button onClick={() => saveRow(row)} disabled={loading}
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 transition disabled:opacity-50">
                    {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} حفظ
                  </button>
                  <button onClick={() => delRow(row)}
                    className="me-1 inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold text-stone-500 hover:bg-rose-50 hover:text-rose-600 transition">
                    <Trash2 className="w-3.5 h-3.5" /> حذف
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <input ref={fileInput} type="file" accept="image/*" hidden onChange={onFilePicked} />
      {cropSource && (
        <ImageCropperModal
          src={cropSource.url}
          fileType={cropSource.type}
          aspect={1}
          title="قصّ صورة التصنيف"
          onCancel={() => { setCropSource(null); }}
          onConfirm={(blob) => {
            const { idx, name } = cropSource;
            setCropSource(null);
            doUpload(idx, blob, name);
          }}
        />
      )}
    </div>
  );
}

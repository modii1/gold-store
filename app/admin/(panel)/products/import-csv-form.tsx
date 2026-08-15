"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload, AlertTriangle, Trash2 } from "lucide-react";
import { importProductsCsvAction, deleteAllProductsAction } from "@/app/actions/import-admin";
import { pluralizeArabic } from "@/lib/format";

export function ImportCsvForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ created: number; updated: number; errors: string[] } | null>(null);
  const [error, setError] = useState("");
  const [confirmText, setConfirmText] = useState("");

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    const res = await importProductsCsvAction(fd);
    setLoading(false);
    if ("error" in res && res.error) {
      setError(res.error);
      return;
    }
    if ("created" in res) setResult({ created: res.created ?? 0, updated: res.updated ?? 0, errors: res.errors ?? [] });
    router.refresh();
  };

  return (
    <div className="rounded-2xl border border-amber-100 bg-white p-6">
      <h2 className="font-bold text-stone-800 mb-1">استيراد من CSV</h2>
      <p className="mb-4 text-xs text-stone-500">
        الأعمدة: name, price, sale_price, sku, category, brand, weight, karat, material, color, stock, description, images (روابط مفصولة بـ "؛"). يُحدَّث الموجود حسب SKU.
      </p>
      <form onSubmit={submit} className="space-y-3">
        <input type="file" name="file" accept=".csv,text/csv" required
          className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm" />
        <button type="submit" disabled={loading}
          className="flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-2.5 text-sm font-bold text-gold hover:bg-amber-100 transition disabled:opacity-50">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} استيراد
        </button>
      </form>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {result && (
        <div className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">
          تم إضافة {result.created} {pluralizeArabic(result.created, "منتج", "منتجين", "منتجات")} وتحديث {result.updated} {pluralizeArabic(result.updated, "منتج", "منتجين", "منتجات")}
          {result.errors.length > 0 && (
            <ul className="mt-2 list-inside list-disc text-xs text-amber-700 max-h-32 overflow-y-auto">
              {result.errors.slice(0, 30).map((er, i) => <li key={i}>{er}</li>)}
            </ul>
          )}
        </div>
      )}

      <div className="mt-6 border-t border-stone-100 pt-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-rose-600"><AlertTriangle className="w-4 h-4" /> منطقة الخطر</h3>
        <form action={async (fd) => { await deleteAllProductsAction(fd); }} className="flex flex-wrap items-center gap-2">
          <input name="confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
            placeholder='اكتب "حذف الكل" ثم اضغط'
            className="flex-1 min-w-40 rounded-xl border border-stone-200 px-4 py-2.5 text-sm" />
          <button type="submit"
            className="flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-rose-700 transition">
            <Trash2 className="w-4 h-4" /> حذف جميع المنتجات
          </button>
        </form>
      </div>
    </div>
  );
}

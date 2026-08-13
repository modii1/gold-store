"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Check, Loader2 } from "lucide-react";
import { saveCategoryAction, deleteCategoryAction } from "@/app/actions/categories-admin";
import type { Category } from "@/types";

type Row = { id?: string; name: string; slug: string; image: string; description: string; sort_order: string; is_active: boolean };

export function CategoriesManager({ categories }: { categories: Category[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(
    categories.map((c) => ({
      id: c.id, name: c.name, slug: c.slug, image: c.image || "", description: c.description || "", sort_order: String(c.sort_order ?? 0), is_active: c.is_active,
    }))
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const addRow = () => setRows((prev) => [...prev, { name: "", slug: "", image: "", description: "", sort_order: String(rows.length + 1), is_active: true }]);

  const updateRow = (idx: number, patch: Partial<Row>) => setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

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
            <tr className="border-b border-stone-100 text-right text-stone-500">
              <th className="p-3 font-semibold">الاسم</th>
              <th className="p-3 font-semibold">Slug</th>
              <th className="p-3 font-semibold">الترتيب</th>
              <th className="p-3 font-semibold">نشط</th>
              <th className="p-3 font-semibold">إجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-50">
            {rows.map((row, i) => (
              <tr key={i} className="align-top">
                <td className="p-3">
                  <input value={row.name} onChange={(e) => updateRow(i, { name: e.target.value })} placeholder="اسم التصنيف"
                    className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm" />
                </td>
                <td className="p-3">
                  <input value={row.slug} onChange={(e) => updateRow(i, { slug: e.target.value })} placeholder="slug" dir="ltr"
                    className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm" />
                </td>
                <td className="p-3 w-20">
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
                    className="mr-1 inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold text-stone-500 hover:bg-rose-50 hover:text-rose-600 transition">
                    <Trash2 className="w-3.5 h-3.5" /> حذف
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

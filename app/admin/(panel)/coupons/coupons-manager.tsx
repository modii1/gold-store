"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Check, Loader2, Tag } from "lucide-react";
import { saveCouponAction, deleteCouponAction } from "@/app/actions/coupons-admin";
import type { Coupon } from "@/types";

type Row = {
  id?: string;
  code: string;
  type: "percent" | "fixed";
  value: string;
  min_order: string;
  usage_limit: string;
  ends_at: string;
  is_active: boolean;
  used_count?: number;
};

export function CouponsManager({ coupons }: { coupons: Coupon[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(
    coupons.map((c) => ({
      id: c.id, code: c.code, type: c.type, value: String(c.value), min_order: String(c.min_order ?? 0),
      usage_limit: c.usage_limit !== null && c.usage_limit !== undefined ? String(c.usage_limit) : "",
      ends_at: c.ends_at ? c.ends_at.slice(0, 10) : "", is_active: c.is_active, used_count: c.used_count,
    }))
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const addRow = () => setRows((prev) => [...prev, { code: "", type: "percent", value: "", min_order: "0", usage_limit: "", ends_at: "", is_active: true }]);

  const updateRow = (idx: number, patch: Partial<Row>) => setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const saveRow = async (row: Row) => {
    setLoading(true);
    setError("");
    const fd = new FormData();
    if (row.id) fd.set("id", row.id);
    fd.set("code", row.code);
    fd.set("type", row.type);
    fd.set("value", row.value);
    fd.set("min_order", row.min_order);
    fd.set("usage_limit", row.usage_limit);
    fd.set("ends_at", row.ends_at || "");
    fd.set("is_active", row.is_active ? "on" : "");
    const res = await saveCouponAction(fd);
    setLoading(false);
    if (res.error) { setError(res.error); return; }
    router.refresh();
  };

  const delRow = async (row: Row) => {
    if (!row.id) { setRows((prev) => prev.filter((r) => r !== row)); return; }
    if (!confirm("حذف الكود؟")) return;
    const fd = new FormData();
    fd.set("id", row.id);
    const res = await deleteCouponAction(fd);
    if (res.error) { setError(res.error); return; }
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-stone-900">أكواد الخصم</h1>
        <button onClick={addRow} className="flex items-center gap-2 rounded-xl bg-gold px-4 py-2.5 text-sm font-bold text-white hover:bg-gold-light transition">
          <Plus className="w-4 h-4" /> إضافة كود
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Mobile card layout */}
      <div className="md:hidden space-y-3">
        {rows.map((row, i) => (
          <div key={i} className="rounded-2xl border border-amber-100 bg-white p-4 space-y-3">
            <div className="flex items-center justify-between">
              <input value={row.code} onChange={(e) => updateRow(i, { code: e.target.value.toUpperCase() })} placeholder="WELCOME10" dir="ltr"
                className="w-32 rounded-lg border border-stone-200 px-3 py-2 text-sm font-bold" />
              <input type="checkbox" checked={row.is_active} onChange={(e) => updateRow(i, { is_active: e.target.checked })} className="accent-gold h-5 w-5" />
            </div>
            {row.used_count !== undefined && row.id && (
              <p className="text-[11px] text-stone-400">استُخدم {row.used_count} مرة</p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-stone-500 mb-1">النوع</label>
                <select value={row.type} onChange={(e) => updateRow(i, { type: e.target.value as "percent" | "fixed" })}
                  className="w-full rounded-lg border border-stone-200 px-2 py-2 text-sm">
                  <option value="percent">نسبة %</option>
                  <option value="fixed">مبلغ ثابت</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1">القيمة</label>
                <input value={row.value} onChange={(e) => updateRow(i, { value: e.target.value })} type="number" step="0.01"
                  className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1">حد أدنى</label>
                <input value={row.min_order} onChange={(e) => updateRow(i, { min_order: e.target.value })} type="number"
                  className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1">الاستخدام</label>
                <input value={row.usage_limit} onChange={(e) => updateRow(i, { usage_limit: e.target.value })} type="number" placeholder="غير محدود"
                  className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-stone-500 mb-1">الانتهاء</label>
              <input value={row.ends_at} onChange={(e) => updateRow(i, { ends_at: e.target.value })} type="date" dir="ltr"
                className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm" />
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => saveRow(row)} disabled={loading}
                className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 transition disabled:opacity-50">
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} حفظ
              </button>
              <button onClick={() => delRow(row)}
                className="inline-flex items-center justify-center gap-1 rounded-lg px-3 py-2 text-xs font-bold text-stone-500 hover:bg-rose-50 hover:text-rose-600 transition">
                <Trash2 className="w-3.5 h-3.5" /> حذف
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table layout */}
      <div className="hidden md:block overflow-x-auto rounded-2xl border border-amber-100 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-100 text-end text-stone-500">
              <th className="p-3 font-semibold">الكود</th>
              <th className="p-3 font-semibold">النوع</th>
              <th className="p-3 font-semibold">القيمة</th>
              <th className="p-3 font-semibold">حد أدنى</th>
              <th className="p-3 font-semibold">الاستخدام</th>
              <th className="p-3 font-semibold">الانتهاء</th>
              <th className="p-3 font-semibold">نشط</th>
              <th className="p-3 font-semibold">إجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-50">
            {rows.map((row, i) => (
              <tr key={i} className="align-top">
                <td className="p-3">
                  <input value={row.code} onChange={(e) => updateRow(i, { code: e.target.value.toUpperCase() })} placeholder="WELCOME10" dir="ltr"
                    className="w-32 rounded-lg border border-stone-200 px-3 py-2 text-sm" />
                  {row.used_count !== undefined && row.id && (
                    <p className="mt-1 text-[11px] text-stone-400">استُخدم {row.used_count} مرة</p>
                  )}
                </td>
                <td className="p-3">
                  <select value={row.type} onChange={(e) => updateRow(i, { type: e.target.value as "percent" | "fixed" })}
                    className="rounded-lg border border-stone-200 px-2 py-2 text-sm">
                    <option value="percent">نسبة %</option>
                    <option value="fixed">مبلغ ثابت</option>
                  </select>
                </td>
                <td className="p-3">
                  <input value={row.value} onChange={(e) => updateRow(i, { value: e.target.value })} type="number" step="0.01"
                    className="w-24 rounded-lg border border-stone-200 px-3 py-2 text-sm" />
                </td>
                <td className="p-3">
                  <input value={row.min_order} onChange={(e) => updateRow(i, { min_order: e.target.value })} type="number"
                    className="w-24 rounded-lg border border-stone-200 px-3 py-2 text-sm" />
                </td>
                <td className="p-3">
                  <input value={row.usage_limit} onChange={(e) => updateRow(i, { usage_limit: e.target.value })} type="number" placeholder="غير محدود"
                    className="w-24 rounded-lg border border-stone-200 px-3 py-2 text-sm" />
                </td>
                <td className="p-3">
                  <input value={row.ends_at} onChange={(e) => updateRow(i, { ends_at: e.target.value })} type="date" dir="ltr"
                    className="w-32 rounded-lg border border-stone-200 px-3 py-2 text-sm" />
                </td>
                <td className="p-3 text-center">
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

      <p className="flex items-center gap-2 text-xs text-stone-400"><Tag className="w-4 h-4" /> الكود يظهر في صفحة إتمام الطلب — النسبة تُطبق على المجموع الفرعي</p>
    </div>
  );
}

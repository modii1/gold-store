"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Check, Loader2, Truck, Eye } from "lucide-react";
import { saveCarrierAction, deleteCarrierAction } from "@/app/actions/carriers-admin";
import { updateSettingsAction } from "@/app/actions/settings";
import type { Carrier } from "@/types";

type Row = {
  id?: string;
  name: string;
  code: string;
  mode: "flat" | "api";
  cost: string;
  free_above: string;
  estimated_days: string;
  sort_order: string;
  is_active: boolean;
  api_username: string;
  api_password: string;
  api_key: string;
  account_number: string;
  client_code: string;
  endpoint: string;
};

function toRow(c: Carrier): Row {
  const cfg = c.config || {};
  return {
    id: c.id,
    name: c.name,
    code: c.code,
    mode: c.mode,
    cost: String(c.cost ?? 0),
    free_above: c.free_above != null ? String(c.free_above) : "",
    estimated_days: c.estimated_days || "",
    sort_order: String(c.sort_order ?? 0),
    is_active: c.is_active,
    api_username: cfg.username || "",
    api_password: cfg.password || "",
    api_key: cfg.apiKey || "",
    account_number: cfg.accountNumber || "",
    client_code: cfg.clientCode || "",
    endpoint: cfg.endpoint || "",
  };
}

const newRow = (n: number): Row => ({
  name: "", code: "", mode: "flat", cost: "0", free_above: "", estimated_days: "", sort_order: String(n), is_active: true,
  api_username: "", api_password: "", api_key: "", account_number: "", client_code: "", endpoint: "",
});

const cnMode = (active: boolean, on: string, off: string) =>
  "rounded-full px-4 py-2 text-sm font-bold transition disabled:opacity-50 " + (active ? on : off);

export function ShippingManager({ carriers, shippingDisplayMode }: { carriers: Carrier[]; shippingDisplayMode: "all" | "pickup" }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(carriers.map(toRow));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [mode, setMode] = useState<"all" | "pickup">(shippingDisplayMode);
  const [savingMode, setSavingMode] = useState(false);

  const saveMode = async (value: "all" | "pickup") => {
    setSavingMode(true);
    setError("");
    setSaved("");
    const fd = new FormData();
    fd.set("shipping_display_mode", value);
    const res = await updateSettingsAction(fd);
    setSavingMode(false);
    if (res.error) { setError(res.error); return; }
    setMode(value);
    setSaved("تم الحفظ ✓");
    router.refresh();
  };

  const addRow = () => setRows((prev) => [...prev, newRow(prev.length + 1)]);

  const updateRow = (idx: number, patch: Partial<Row>) => setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const saveRow = async (row: Row) => {
    setLoading(true);
    setError("");
    setSaved("");
    const fd = new FormData();
    if (row.id) fd.set("id", row.id);
    fd.set("name", row.name);
    fd.set("code", row.code);
    fd.set("mode", row.mode);
    fd.set("cost", row.cost);
    fd.set("free_above", row.free_above);
    fd.set("estimated_days", row.estimated_days);
    fd.set("sort_order", row.sort_order);
    fd.set("is_active", row.is_active ? "on" : "");
    fd.set("api_username", row.api_username);
    fd.set("api_password", row.api_password);
    fd.set("api_key", row.api_key);
    fd.set("account_number", row.account_number);
    fd.set("client_code", row.client_code);
    fd.set("endpoint", row.endpoint);
    const res = await saveCarrierAction(fd);
    setLoading(false);
    if (res.error) { setError(res.error); return; }
    setSaved("تم الحفظ ✓");
    router.refresh();
  };

  const delRow = async (row: Row) => {
    if (!row.id) { setRows((prev) => prev.filter((r) => r !== row)); return; }
    if (!confirm("حذف شركة الشحن؟")) return;
    const fd = new FormData();
    fd.set("id", row.id);
    const res = await deleteCarrierAction(fd);
    if (res.error) { setError(res.error); return; }
    router.refresh();
  };

  const inputCls = "w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:border-gold focus:outline-none";
  const labelCls = "block text-xs font-semibold text-stone-600 mb-1";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">شركات الشحن</h1>
          <p className="mt-1 text-sm text-stone-500">
            أضف شركات الشحن وبيانات الـ API. في وضع «ثابت» تعمل بتكلفة محددة، وفي وضع «API» تحسب التكلفة وتُنشئ الشحنة تلقائياً.
          </p>
        </div>
        <button onClick={addRow} className="flex items-center gap-2 rounded-xl bg-gold px-4 py-2.5 text-sm font-bold text-white hover:bg-gold-light transition">
          <Plus className="w-4 h-4" /> إضافة شركة
        </button>
      </div>

      <div className="rounded-2xl border border-amber-100 bg-white p-5">
        <h2 className="flex items-center gap-2 font-bold text-stone-900 mb-1"><Eye className="w-5 h-5 text-gold" /> ما يظهر للعميل في الإتمام</h2>
        <p className="text-sm text-stone-500 mb-4">العميل لا يختار هذا — أنتم تحددونه هنا، ويُطبق تلقائياً على صفحة إتمام الطلب.</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => saveMode("all")}
            disabled={savingMode}
            className={cnMode(mode === "all", "bg-gold text-white", "bg-stone-100 text-stone-600 hover:bg-stone-200")}
          >
            الكل
          </button>
          <button
            type="button"
            onClick={() => saveMode("pickup")}
            disabled={savingMode}
            className={cnMode(mode === "pickup", "bg-gold text-white", "bg-stone-100 text-stone-600 hover:bg-stone-200")}
          >
            الاستلام بواسطة شركة الشحن فقط
          </button>
          {savingMode && <Loader2 className="h-4 w-4 animate-spin self-center text-gold" />}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {saved && <p className="text-sm text-emerald-600">{saved}</p>}

      {rows.length === 0 && (
        <div className="rounded-2xl border border-amber-100 bg-white p-10 text-center text-stone-400">
          لا توجد شركات شحن — اضغط «إضافة شركة»
        </div>
      )}

      <div className="space-y-4">
        {rows.map((row, i) => (
          <div key={i} className="rounded-2xl border border-amber-100 bg-white p-5">
            <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-gold shrink-0">
                <Truck className="w-5 h-5" />
              </div>
              <div className="flex-1 sm:min-w-52">
                <input value={row.name} onChange={(e) => updateRow(i, { name: e.target.value })} placeholder="اسم الشركة (مثال: أرامكس)"
                  className={inputCls} />
              </div>
              <div className="w-full sm:w-40">
                <input value={row.code} onChange={(e) => updateRow(i, { code: e.target.value })} placeholder="الرمز: aramex" dir="ltr"
                  className={inputCls} />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 rounded-lg border border-stone-200 px-3 py-2 text-sm">
                  <input type="checkbox" checked={row.mode === "api"} onChange={(e) => updateRow(i, { mode: e.target.checked ? "api" : "flat" })} className="accent-gold" />
                  حساب عبر API
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={row.is_active} onChange={(e) => updateRow(i, { is_active: e.target.checked })} className="accent-gold" />
                  نشط
                </label>
                <div className="flex items-center gap-2">
                  <button onClick={() => saveRow(row)} disabled={loading}
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 transition disabled:opacity-50">
                    {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} حفظ
                  </button>
                  <button onClick={() => delRow(row)}
                    className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-bold text-stone-500 hover:bg-rose-50 hover:text-rose-600 transition">
                    <Trash2 className="w-3.5 h-3.5" /> حذف
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <label>
                <span className={labelCls}>التكلفة الثابتة (﷼)</span>
                <input value={row.cost} onChange={(e) => updateRow(i, { cost: e.target.value })} type="number" min="0" step="0.01"
                  className={inputCls} dir="ltr" />
              </label>
              <label>
                <span className={labelCls}>شحن مجاني عند (﷼)</span>
                <input value={row.free_above} onChange={(e) => updateRow(i, { free_above: e.target.value })} type="number" min="0" placeholder="—"
                  className={inputCls} dir="ltr" />
              </label>
              <label>
                <span className={labelCls}>المدة التقديرية</span>
                <input value={row.estimated_days} onChange={(e) => updateRow(i, { estimated_days: e.target.value })} placeholder="1-3 أيام"
                  className={inputCls} />
              </label>
              <label>
                <span className={labelCls}>الترتيب</span>
                <input value={row.sort_order} onChange={(e) => updateRow(i, { sort_order: e.target.value })} type="number"
                  className={inputCls} dir="ltr" />
              </label>
            </div>

            {row.mode === "api" && (
              <div className="mt-4 rounded-xl border border-violet-100 bg-violet-50/40 p-4">
                <p className="text-xs font-bold text-violet-700 mb-3">بيانات الـ API (تظهر فقط عند تفعيل الحساب التلقائي)</p>
                <div className="grid gap-3 md:grid-cols-3">
                  <label>
                    <span className={labelCls}>اسم المستخدم</span>
                    <input value={row.api_username} onChange={(e) => updateRow(i, { api_username: e.target.value })} dir="ltr" autoComplete="off" className={inputCls} />
                  </label>
                  <label>
                    <span className={labelCls}>كلمة المرور / مفتاح API</span>
                    <input value={row.api_password} onChange={(e) => updateRow(i, { api_password: e.target.value })} type="password" dir="ltr" autoComplete="new-password" className={inputCls} />
                  </label>
                  <label>
                    <span className={labelCls}>رقم الحساب</span>
                    <input value={row.account_number} onChange={(e) => updateRow(i, { account_number: e.target.value })} dir="ltr" autoComplete="off" className={inputCls} />
                  </label>
                  <label>
                    <span className={labelCls}>مفتاح API (إن وجد)</span>
                    <input value={row.api_key} onChange={(e) => updateRow(i, { api_key: e.target.value })} type="password" dir="ltr" autoComplete="new-password" className={inputCls} />
                  </label>
                  <label>
                    <span className={labelCls}>رمز العميل / الكيان (اختياري)</span>
                    <input value={row.client_code} onChange={(e) => updateRow(i, { client_code: e.target.value })} dir="ltr" autoComplete="off" className={inputCls} />
                  </label>
                  <label>
                    <span className={labelCls}>نقطة الربط API (اختياري)</span>
                    <input value={row.endpoint} onChange={(e) => updateRow(i, { endpoint: e.target.value })} dir="ltr" autoComplete="off" placeholder="https://..." className={inputCls} />
                  </label>
                </div>
                <p className="mt-3 text-xs text-stone-500 leading-relaxed">
                  أرامكس: اسم المستخدم + كلمة المرور + رقم الحساب. &nbsp; سمسا: اسم المستخدم + Pass Key في حقل «مفتاح API».
                  عند إدخال البيانات واختيار «حساب عبر API»، تُحسب التكلفة في السلة وتُنشأ الشحنة من صفحة الطلبات.
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

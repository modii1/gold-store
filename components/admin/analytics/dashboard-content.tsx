"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Loader2,
  Users,
  Eye,
  ShoppingCart,
  Package,
  Banknote,
  Receipt,
  TrendingUp,
  RefreshCcw,
  ExternalLink,
  WifiOff,
  BarChart3,
  UserPlus,
  UserCheck,
  AlertTriangle,
  PieChart,
  Trash2,
} from "lucide-react";
import type { AnalyticsDashboard, Range } from "@/lib/analytics/types";
import { Currency } from "@/components/storefront/currency";
import { formatCurrency } from "@/lib/format";
import { TrendChart, BarList, EmptyChart, rangeLabel } from "./charts";
import { Modal } from "@/app/admin/(panel)/orders/order-modal";
import { cn } from "@/lib/utils";

const RANGES: { key: Range; label: string }[] = [
  { key: "today", label: "اليوم" },
  { key: "7d", label: "7 أيام" },
  { key: "30d", label: "30 يوم" },
];

type MetricCard = {
  key: keyof typeof METRIC_META;
  label: string;
  value: string | number;
  icon: React.ReactNode;
  compare: number | null;
  currency?: boolean;
  suffix?: string;
};

export function DashboardContent() {
  const [range, setRange] = useState<Range>("7d");
  const [data, setData] = useState<AnalyticsDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  const load = useCallback(async (r: Range) => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/analytics/dashboard?range=${r}`, { cache: "no-store" });
      if (!res.ok) throw new Error("failed");
      const json = (await res.json()) as AnalyticsDashboard;
      setData(json);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(range);
  }, [range, load]);

  const kpis = data?.kpis;

  const cards: MetricCard[] = kpis
    ? [
        { key: "visitorsNow", label: "الزوار الآن", value: kpis.visitorsNow, icon: <Users className="h-4 w-4" />, compare: null },
        { key: "visitorsToday", label: "زوار اليوم", value: kpis.visitorsToday, icon: <Users className="h-4 w-4" />, compare: data.comparison.visitorsToday },
        { key: "productViews", label: "مشاهدات المنتجات", value: kpis.productViews, icon: <Eye className="h-4 w-4" />, compare: null },
        { key: "uniqueProductViews", label: "مشاهدة فريدة", value: kpis.uniqueProductViews, icon: <UserCheck className="h-4 w-4" />, compare: null },
        { key: "addToCarts", label: "إضافات للسلة", value: kpis.addToCarts, icon: <ShoppingCart className="h-4 w-4" />, compare: null },
        { key: "orders", label: "الطلبات", value: kpis.orders, icon: <Package className="h-4 w-4" />, compare: data.comparison.orders },
        { key: "sales", label: "المبيعات", value: null as unknown as number, icon: <Banknote className="h-4 w-4" />, compare: data.comparison.sales, currency: true },
        { key: "aov", label: "متوسط قيمة الطلب", value: null as unknown as number, icon: <Receipt className="h-4 w-4" />, compare: data.comparison.aov, currency: true },
        { key: "conversion", label: "معدل التحويل", value: kpis.conversion, icon: <TrendingUp className="h-4 w-4" />, compare: data.comparison.conversion, suffix: "%" },
      ]
    : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">لوحة المؤشرات</h1>
          <p className="mt-1 text-sm text-stone-500">نظرة شاملة على أداء المتجر — {rangeLabel(range)}</p>
        </div>
        <div className="flex items-center gap-2">
          {!data?.eventsEnabled && !loading && (
            <span className="hidden items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-semibold text-amber-700 md:flex">
              <WifiOff className="h-3.5 w-3.5" /> تتبع الأحداث غير مفعّل (شغّل migration-016)
            </span>
          )}
          <div className="flex items-center gap-1 rounded-xl border border-stone-200 bg-white p-1">
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                disabled={loading}
                className={cn("rounded-lg px-3 py-1.5 text-xs font-bold transition", range === r.key ? "bg-gold text-white shadow-sm" : "text-stone-500 hover:text-stone-800")}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button onClick={() => void load(range)} title="تحديث" className="flex h-9 w-9 items-center justify-center rounded-xl border border-stone-200 bg-white text-stone-500 transition hover:bg-stone-50">
            <RefreshCcw className={cn("h-4 w-4", loading && "animate-spin")} />
          </button>
          <button
            onClick={() => setResetOpen(true)}
            title="إفراغ الإحصائيات"
            className="flex h-9 items-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3 text-xs font-bold text-rose-600 transition hover:bg-rose-50"
          >
            <Trash2 className="h-4 w-4" /> إفراغ
          </button>
        </div>
      </div>

      <ResetAnalyticsModal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        onDone={() => void load(range)}
      />

      {/* Loading / Error */}
      {loading && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-amber-100 bg-white py-20 text-stone-400">
          <Loader2 className="h-7 w-7 animate-spin text-gold" />
          <p className="mt-3 text-sm">جار تحميل البيانات...</p>
        </div>
      )}

      {error && !loading && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-red-100 bg-white py-20 text-stone-500">
          <AlertTriangle className="h-8 w-8 text-red-400" />
          <p className="mt-3 text-sm font-semibold">تعذر تحميل البيانات</p>
          <button onClick={() => void load(range)} className="mt-4 rounded-full bg-gold px-5 py-2 text-xs font-bold text-white hover:bg-gold-dark">
            إعادة المحاولة
          </button>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            {cards.map((c) => (
              <KpiCard key={c.key} card={c} />
            ))}
          </div>

          {/* Time series + funnel */}
          <div className="grid gap-4 lg:grid-cols-3">
            <section className="rounded-2xl border border-amber-100 bg-white p-5 lg:col-span-2">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-bold text-stone-800">
                  <BarChart3 className="h-4 w-4 text-gold" /> المبيعات والطلبات
                </h2>
                <span className="text-xs text-stone-400">{rangeLabel(range)}</span>
              </div>
              <TrendChart
                data={data.series.map((s) => ({ label: s.label, value: s.sales }))}
                format={(n) => formatCurrency(n)}
              />
            </section>

            <section className="rounded-2xl border border-amber-100 bg-white p-5">
              <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-stone-800">
                <PieChart className="h-4 w-4 text-gold" /> قمع التحويل
              </h2>
              <BarList
                rows={[
                  { label: "الزوار", value: data.kpis.visitorsToday },
                  { label: "مشاهدة منتج", value: data.funnel.productViews },
                  { label: "إضافة للسلة", value: data.funnel.addToCarts },
                  { label: "بدء الطلب", value: data.funnel.checkoutStarts },
                  { label: "شراء", value: data.funnel.purchases },
                ]}
                format={(n) => formatCurrency(n)}
              />
            </section>
          </div>

          {/* Devices + sources + abandoned + returning */}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <section className="rounded-2xl border border-amber-100 bg-white p-5">
              <h2 className="mb-4 text-sm font-bold text-stone-800">توزيع الأجهزة</h2>
              <BarList rows={data.devices.map((d) => ({ label: deviceLabel(d.device), value: d.count }))} format={(n) => formatCurrency(n)} />
            </section>

            <section className="rounded-2xl border border-amber-100 bg-white p-5">
              <h2 className="mb-4 text-sm font-bold text-stone-800">مصادر الزيارات</h2>
              <BarList rows={data.sources.map((s) => ({ label: s.label, value: s.count }))} format={(n) => formatCurrency(n)} />
            </section>

            <section className="rounded-2xl border border-amber-100 bg-white p-5">
              <h2 className="mb-4 text-sm font-bold text-stone-800">العملاء</h2>
              <div className="space-y-3">
                <StatRow icon={<UserPlus className="h-4 w-4 text-emerald-600" />} label="عملاء جدد" value={data.newVsReturning.new} />
                <StatRow icon={<Users className="h-4 w-4 text-amber-600" />} label="عملاء عائدون" value={data.newVsReturning.returning} />
                <div className="mt-4 rounded-xl bg-cream p-3 text-xs text-stone-500">
                  <p className="mb-1.5 font-semibold text-stone-600">السلات المتروكة</p>
                  <p className="text-lg font-bold text-red-500">{formatCurrency(data.funnel.abandonedCarts)}</p>
                  <p className="mt-0.5 text-[11px] text-stone-400">أضافوا للسلة دون إكمال الطلب</p>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-red-100 bg-white p-5">
              <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-stone-800">
                <AlertTriangle className="h-4 w-4 text-red-400" /> مشاهدات عالية بلا شراء
              </h2>
              {data.highViewLowPurchase.length === 0 ? (
                <EmptyChart />
              ) : (
                <ul className="space-y-3">
                  {data.highViewLowPurchase.slice(0, 6).map((p) => (
                    <li key={p.id} className="flex items-center gap-2">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-[11px] font-bold text-stone-500">
                        {p.uniqueViews}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-stone-700">{p.name}</span>
                      <span className="text-[11px] text-stone-400">{formatCurrency(p.uniqueViews)} مشاهدة</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {/* Top products */}
          <section className="rounded-2xl border border-amber-100 bg-white p-5">
            <h2 className="mb-4 text-sm font-bold text-stone-800">أفضل المنتجات</h2>
            <TopProductsTabs data={data} />
          </section>
        </>
      )}
    </div>
  );
}

const METRIC_META: Record<string, { color: string; bg: string }> = {
  visitorsNow: { color: "text-stone-900", bg: "bg-stone-50" },
  visitorsToday: { color: "text-gold-dark", bg: "bg-amber-50" },
  productViews: { color: "text-blue-700", bg: "bg-blue-50" },
  uniqueProductViews: { color: "text-sky-700", bg: "bg-sky-50" },
  addToCarts: { color: "text-violet-700", bg: "bg-violet-50" },
  orders: { color: "text-teal-700", bg: "bg-teal-50" },
  sales: { color: "text-emerald-700", bg: "bg-emerald-50" },
  aov: { color: "text-rose-700", bg: "bg-rose-50" },
  conversion: { color: "text-indigo-700", bg: "bg-indigo-50" },
};

function KpiCard({ card }: { card: MetricCard }) {
  const meta = METRIC_META[card.key];
  return (
    <article className="rounded-2xl border border-amber-100 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold text-stone-500">{card.label}</p>
        <span className={cn("flex h-7 w-7 items-center justify-center rounded-lg", meta.bg, meta.color)}>{card.icon}</span>
      </div>
      <p className={cn("mt-2 truncate text-xl font-bold xl:text-2xl", meta.color)} dir="ltr">
        {card.currency ? <Currency value={card.value as number} /> : card.suffix ? `${formatCurrency(card.value as number)}${card.suffix}` : formatCurrency(card.value as number)}
      </p>
      {card.compare !== null && card.compare !== undefined && (
        <div className="mt-1 flex items-center gap-1 text-[10px]">
          <span className={cn("font-bold", card.compare >= 0 ? "text-emerald-600" : "text-red-500")} dir="ltr">
            {card.compare >= 0 ? "▲" : "▼"} {Math.abs(card.compare).toFixed(1)}%
          </span>
          <span className="text-stone-400">مقارنة بالفترة السابقة</span>
        </div>
      )}
    </article>
  );
}

function StatRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-sand bg-white px-3 py-2.5">
      <span className="flex items-center gap-2 text-xs font-semibold text-stone-600">{icon}{label}</span>
      <span className="text-base font-bold text-stone-800">{formatCurrency(value)}</span>
    </div>
  );
}

function deviceLabel(d: string) {
  if (d === "mobile") return "جوال";
  if (d === "tablet") return "Tablet";
  return "كمبيوتر";
}

type TopTabs = "views" | "sales" | "orders" | "conversion";

function TopProductsTabs({ data }: { data: AnalyticsDashboard }) {
  const [tab, setTab] = useState<TopTabs>("views");
  const tabs: { key: TopTabs; label: string }[] = [
    { key: "views", label: "الأكثر مشاهدة" },
    { key: "sales", label: "الأعلى مبيعاً" },
    { key: "orders", label: "الأكثر طلباً" },
    { key: "conversion", label: "الأعلى تحويلاً" },
  ];
  const list = data.topProducts[tab === "views" ? "byViews" : tab === "sales" ? "bySales" : tab === "orders" ? "byOrders" : "byConversion"];

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn("rounded-full px-3.5 py-1.5 text-xs font-bold transition", tab === t.key ? "bg-gold text-white" : "bg-stone-50 text-stone-500 hover:bg-stone-100")}
          >
            {t.label}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <EmptyChart />
      ) : (
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[640px] text-right">
            <thead>
              <tr className="border-b border-sand text-[11px] font-bold text-stone-400">
                <th className="px-2 py-2">المنتج</th>
                <th className="px-2 py-2">مشاهدات</th>
                <th className="px-2 py-2">سلة</th>
                <th className="px-2 py-2">طلبات</th>
                <th className="px-2 py-2">المبيعات</th>
                <th className="px-2 py-2">تحويل</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {list.slice(0, 10).map((p) => (
                <tr key={p.id} className="border-b border-stone-100 text-xs last:border-0 hover:bg-cream/40">
                  <td className="px-2 py-2.5">
                    <div className="flex items-center gap-2">
                      {p.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.image} alt="" className="h-9 w-9 rounded-lg object-cover" loading="lazy" />
                      ) : (
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-stone-100 text-stone-300">–</span>
                      )}
                      <span className="max-w-[160px] truncate font-semibold text-stone-700">{p.name}</span>
                    </div>
                  </td>
                  <td className="px-2 py-2.5 text-stone-600">{formatCurrency(p.uniqueViews)}</td>
                  <td className="px-2 py-2.5 text-stone-600">{formatCurrency(p.carts)}</td>
                  <td className="px-2 py-2.5 text-stone-600">{formatCurrency(p.orders)}</td>
                  <td className="px-2 py-2.5 font-bold text-emerald-700" dir="ltr">{<Currency value={p.sales} />}</td>
                  <td className="px-2 py-2.5">{p.conversion > 0 ? `${p.conversion}%` : "—"}</td>
                  <td className="px-2 py-2.5">
                    <Link href={`/admin/products/edit/${p.id}`} title="فتح المنتج" className="rounded-lg border border-stone-200 p-1.5 text-stone-400 transition hover:bg-stone-50 hover:text-gold">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const RESET_TYPES: { key: string; label: string; icon: React.ReactNode }[] = [
  { key: "page_view", label: "مشاهدات الصفحات", icon: <Eye className="h-4 w-4" /> },
  { key: "product_view", label: "مشاهدات المنتجات", icon: <Eye className="h-4 w-4" /> },
  { key: "add_to_cart", label: "إضافات للسلة", icon: <ShoppingCart className="h-4 w-4" /> },
  { key: "remove_from_cart", label: "إزالات من السلة", icon: <ShoppingCart className="h-4 w-4" /> },
  { key: "checkout_start", label: "بدء الطلب", icon: <Receipt className="h-4 w-4" /> },
  { key: "purchase", label: "الشراء", icon: <Banknote className="h-4 w-4" /> },
];

function ResetAnalyticsModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [selected, setSelected] = useState<string[]>(RESET_TYPES.map((t) => t.key));
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const toggle = (key: string) =>
    setSelected((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));
  const toggleAll = () =>
    setSelected((s) => (s.length === RESET_TYPES.length ? [] : RESET_TYPES.map((t) => t.key)));

  const allSelected = selected.length === RESET_TYPES.length;
  const canSubmit = selected.length > 0 && confirm.trim() === "إفراغ";

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/analytics/reset", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventTypes: selected }),
      });
      if (!res.ok) throw new Error("فشل الإفراغ");
      const data = await res.json();
      setResult(`تم إفراغ ${data.count} حدث بنجاح`);
      onDone();
    } catch {
      setResult("حدث خطأ أثناء الإفراغ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title="إفراغ الإحصائيات" danger onClose={onClose} width="max-w-lg">
      <p className="mb-4 text-sm text-stone-500">
        اختر الأحداث التي تريد إفراغها. الطلبات والمبيعات تبقى كما هي (تُحسب من جدول الطلبات).
      </p>

      <button onClick={toggleAll} className="mb-3 flex items-center gap-2 text-xs font-bold text-gold-dark">
        <span className={cn("flex h-4 w-4 items-center justify-center rounded border text-[10px]", allSelected ? "border-gold bg-gold text-white" : "border-stone-300")}>
          {allSelected && "✓"}
        </span>
        {allSelected ? "إلغاء تحديد الكل" : "تحديد الكل"}
      </button>

      <div className="space-y-2">
        {RESET_TYPES.map((t) => {
          const on = selected.includes(t.key);
          return (
            <button key={t.key} type="button" onClick={() => toggle(t.key)} className="flex w-full items-center gap-3 rounded-xl border border-sand bg-white px-3 py-2.5 text-sm transition hover:bg-cream/50">
              <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px]", on ? "border-gold bg-gold text-white" : "border-stone-300")}>
                {on && "✓"}
              </span>
              <span className={cn("text-stone-600", t.icon && "flex items-center gap-2")}>{t.icon}{t.label}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-4">
        <label className="text-xs font-bold text-stone-600">اكتب «إفراغ» للتأكيد</label>
        <input
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="إفراغ"
          className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-sm"
        />
      </div>

      {result && <p className={cn("mt-3 text-xs font-bold", result.includes("خطأ") ? "text-red-500" : "text-emerald-600")}>{result}</p>}

      <div className="mt-5 flex items-center justify-end gap-2">
        <button onClick={onClose} className="rounded-full border border-stone-200 px-4 py-2 text-xs font-bold text-stone-600 hover:bg-stone-50">
          إلغاء
        </button>
        <button
          onClick={submit}
          disabled={!canSubmit || busy}
          className={cn(
            "flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold text-white transition",
            canSubmit && !busy ? "bg-rose-600 hover:bg-rose-700" : "cursor-not-allowed bg-stone-300"
          )}
        >
          <Trash2 className="h-3.5 w-3.5" /> {busy ? "جارٍ الإفراغ..." : "إفراغ"}
        </button>
      </div>
    </Modal>
  );
}

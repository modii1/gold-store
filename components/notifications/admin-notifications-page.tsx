"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Search,
  Loader2,
  CheckCheck,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  PackageSearch,
  RefreshCcw,
  RotateCcw,
  Settings2,
} from "lucide-react";
import { timeAgo } from "./notification-bell";
import { severityMeta, CATEGORY_LABELS, renderMessageWithLinks } from "./meta";

type Item = {
  id: string;
  title: string;
  message: string;
  severity: string;
  category: string;
  type: string;
  order_id: string | null;
  order_number: number | null;
  shipment_id: string | null;
  action_url: string | null;
  is_read: boolean;
  created_at: string;
};

type Stats = {
  total: number;
  success: number;
  failed: number;
  successRate: number;
  bySeverity: Record<string, number>;
  byChannel: Record<string, number>;
};

const PERIODS = [
  { label: "اليوم", days: 1 },
  { label: "7 أيام", days: 7 },
  { label: "30 يوم", days: 30 },
];

export function AdminNotificationsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [severity, setSeverity] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [orderNumber, setOrderNumber] = useState("");
  const [offset, setOffset] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [period, setPeriod] = useState(7);
  const [statsLoading, setStatsLoading] = useState(false);
  const limit = 20;

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (q.trim()) params.set("q", q.trim());
      if (category) params.set("category", category);
      if (severity) params.set("severity", severity);
      if (unreadOnly) params.set("unread", "true");
      if (orderNumber.trim()) params.set("order_number", orderNumber.trim());
      const res = await fetch(`/api/notifications?${params}`, { cache: "no-store" });
      const json = await res.json();
      setItems(json.notifications ?? []);
      setTotal(json.total ?? 0);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [q, category, severity, unreadOnly, orderNumber, offset]);

  const loadStats = useCallback(async () => {
    try {
      setStatsLoading(true);
      const res = await fetch(`/api/notifications/stats?days=${period}`, { cache: "no-store" });
      setStats(await res.json());
    } catch {
      // ignore
    } finally {
      setStatsLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  useEffect(() => {
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  const markAllRead = async () => {
    await fetch("/api/notifications/read-all", { method: "POST", cache: "no-store" });
    setItems((prev) => prev.map((i) => ({ ...i, is_read: true })));
    void loadStats();
  };

  const markRead = async (id: string) => {
    await fetch(`/api/notifications/${id}/read`, { method: "POST", cache: "no-store" });
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, is_read: true } : i)));
  };

  const remove = async (id: string) => {
    await fetch(`/api/notifications/${id}`, { method: "DELETE", cache: "no-store" });
    setItems((prev) => prev.filter((i) => i.id !== id));
    setTotal((t) => Math.max(0, t - 1));
  };

  const activeFilters = q.trim() || category || severity || unreadOnly || orderNumber.trim();
  const unreadCount = items.filter((i) => !i.is_read).length;
  const criticalCount = items.filter((i) => i.severity === "critical" && !i.is_read).length;

  return (
    <div className="space-y-6">
      {/* Analytics */}
      <section className="rounded-2xl border border-amber-100 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-stone-900">مركز الإشعارات</h1>
            <p className="mt-1 text-sm text-stone-500">متابعة الإشعارات والتنبيهات وحالة التسليم</p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/admin/settings/notifications"
              className="flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-4 py-2 text-xs font-bold text-stone-700 transition hover:bg-stone-50"
            >
              <Settings2 className="h-3.5 w-3.5 text-gold" /> إعدادات الإشعارات
            </Link>
            <div className="flex items-center gap-1 rounded-xl border border-stone-200 bg-stone-50 p-1">
              {PERIODS.map((p) => (
                <button
                  key={p.days}
                  onClick={() => setPeriod(p.days)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${period === p.days ? "bg-white text-gold shadow-sm" : "text-stone-500 hover:text-stone-800"}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="إجمالي الإشعارات" value={stats?.total} color="text-stone-900" bg="bg-stone-50" loading={statsLoading} />
          <StatCard label="تم التسليم" value={stats?.success} color="text-emerald-700" bg="bg-emerald-50" loading={statsLoading} />
          <StatCard label="فشل" value={stats?.failed} color="text-red-600" bg="bg-red-50" loading={statsLoading} />
          <StatCard label="معدل النجاح" value={stats ? `${stats.successRate}%` : undefined} color="text-gold" bg="bg-amber-50" loading={statsLoading} />
        </div>

        {(stats?.byChannel.email || stats?.byChannel.sms || stats?.byChannel.push) && (
          <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-stone-500">
            <span className="font-semibold text-stone-600">حسب القناة:</span>
            <span>داخل التطبيق: {stats?.byChannel.in_app ?? 0}</span>
            <span>البريد: {stats?.byChannel.email ?? 0}</span>
            <span>SMS: {stats?.byChannel.sms ?? 0}</span>
            <span>Push: {stats?.byChannel.push ?? 0}</span>
          </div>
        )}
      </section>

      {/* Filters */}
      <section className="rounded-2xl border border-amber-100 bg-white p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <label className="mb-1 block text-xs font-semibold text-stone-500">بحث</label>
            <div className="relative">
              <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
              <input
                value={q}
                onChange={(e) => { setQ(e.target.value); setOffset(0); }}
                placeholder="ابحث في العناوين والرسائل..."
                className="w-full rounded-xl border border-stone-200 py-2 pl-3 pr-9 text-sm outline-none focus:border-gold"
              />
            </div>
          </div>
          <FilterSelect label="التصنيف" value={category} onChange={(v) => { setCategory(v); setOffset(0); }}>
            <option value="">الكل</option>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </FilterSelect>
          <FilterSelect label="المستوى" value={severity} onChange={(v) => { setSeverity(v); setOffset(0); }}>
            <option value="">الكل</option>
            <option value="critical">حرج</option>
            <option value="warning">تحذير</option>
            <option value="info">معلومة</option>
            <option value="success">نجاح</option>
          </FilterSelect>
          <div>
            <label className="mb-1 block text-xs font-semibold text-stone-500">رقم الطلب</label>
            <input
              value={orderNumber}
              onChange={(e) => { setOrderNumber(e.target.value); setOffset(0); }}
              placeholder="مثال 12345"
              inputMode="numeric"
              className="w-32 rounded-xl border border-stone-200 px-3 py-2 text-sm outline-none focus:border-gold"
            />
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm font-semibold text-stone-600">
            <input type="checkbox" checked={unreadOnly} onChange={(e) => { setUnreadOnly(e.target.checked); setOffset(0); }} className="h-4 w-4 accent-gold" />
            غير مقروء فقط
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-stone-100 pt-3">
          <p className="text-xs text-stone-500">
            {activeFilters ? `نتائج البحث: ${total}` : `إجمالي الإشعارات: ${total}`}
            {criticalCount > 0 && <span className="mr-2 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-600">{criticalCount} حرج غير مقروء</span>}
            {unreadCount > 0 && <span className="mr-2 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">{unreadCount} غير مقروء</span>}
          </p>
          <button
            onClick={markAllRead}
            disabled={unreadCount === 0}
            className="flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 disabled:opacity-40"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            تعليم الكل كمقروء
          </button>
        </div>
      </section>

      {/* List */}
      <section className="rounded-2xl border border-amber-100 bg-white p-5">
        {loading && items.length === 0 && (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-stone-300" />
          </div>
        )}
        {error && !loading && (
          <div className="py-16 text-center">
            <p className="text-sm text-stone-500">تعذر تحميل الإشعارات. تأكد من تفعيل جدول الإشعارات (migration-013) ثم أعد المحاولة.</p>
            <button onClick={() => void load()} className="mt-3 rounded-xl bg-gold px-4 py-2 text-xs font-bold text-white hover:bg-gold-dark">إعادة المحاولة</button>
          </div>
        )}
        {!loading && !error && items.length === 0 && (
          <div className="py-16 text-center text-sm text-stone-400">لا توجد إشعارات مطابقة</div>
        )}

        {items.length > 0 && (
          <ul className="divide-y divide-stone-100">
            {items.map((item) => {
              const sev = severityMeta(item.severity);
              const isShipmentFail = item.type === "shipment.failed";
              return (
                <li key={item.id} className={`flex flex-col gap-3 py-3 sm:flex-row sm:items-start sm:gap-3 ${item.is_read ? "opacity-70" : ""}`}>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 break-words text-sm font-semibold text-stone-800">
                      {item.title}
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold ${sev.badge}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${sev.dot}`} />
                        {sev.label}
                      </span>
                      {item.category && <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold text-stone-500">{CATEGORY_LABELS[item.category] || item.category}</span>}
                    </p>
                    {item.message && <p className="mt-1 text-xs leading-relaxed text-stone-500 [overflow-wrap:anywhere]">{renderMessageWithLinks(item.message, "font-bold text-amber-700 underline decoration-amber-300 underline-offset-2 hover:text-amber-800")}</p>}
                    <p className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-stone-400">
                      <span dir="ltr">{timeAgo(item.created_at)}</span>
                      {isShipmentFail && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-600">يتطلب تدخلاً</span>}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 sm:hidden">
                      {item.order_id && (
                        <Link href={`/admin/orders/${item.order_id}`} className="flex items-center gap-1 whitespace-nowrap rounded-lg border border-stone-200 px-2.5 py-1.5 text-[11px] font-semibold text-stone-600 transition hover:bg-stone-50">
                          فتح الطلب <ExternalLink className="h-3 w-3" />
                        </Link>
                      )}
                      {item.shipment_id && (
                        <Link href="/admin/shipments" className="flex items-center gap-1 whitespace-nowrap rounded-lg border border-stone-200 px-2.5 py-1.5 text-[11px] font-semibold text-stone-600 transition hover:bg-stone-50">
                          <PackageSearch className="h-3 w-3" /> الشحنة
                        </Link>
                      )}
                      {isShipmentFail && item.order_id && (
                        <Link href={`/admin/orders/${item.order_id}`} className="flex items-center gap-1 whitespace-nowrap rounded-lg bg-amber-600 px-2.5 py-1.5 text-[11px] font-bold text-white transition hover:bg-amber-700">
                          <RotateCcw className="h-3 w-3" /> إعادة المحاولة
                        </Link>
                      )}
                      {!item.is_read && (
                        <button onClick={() => void markRead(item.id)} title="تعليم كمقروء" className="rounded-lg border border-stone-200 p-1.5 text-stone-400 transition hover:bg-stone-50 hover:text-stone-600">
                          <CheckCheck className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button onClick={() => void remove(item.id)} title="حذف" className="rounded-lg border border-stone-200 p-1.5 text-stone-400 transition hover:bg-red-50 hover:text-red-600">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="hidden shrink-0 flex-wrap items-center gap-1.5 sm:flex">
                    {item.order_id && (
                      <Link href={`/admin/orders/${item.order_id}`} className="flex items-center gap-1 whitespace-nowrap rounded-lg border border-stone-200 px-2.5 py-1.5 text-[11px] font-semibold text-stone-600 transition hover:bg-stone-50">
                        فتح الطلب <ExternalLink className="h-3 w-3" />
                      </Link>
                    )}
                    {item.shipment_id && (
                      <Link href="/admin/shipments" className="flex items-center gap-1 whitespace-nowrap rounded-lg border border-stone-200 px-2.5 py-1.5 text-[11px] font-semibold text-stone-600 transition hover:bg-stone-50">
                        <PackageSearch className="h-3 w-3" /> الشحنة
                      </Link>
                    )}
                    {isShipmentFail && item.order_id && (
                      <Link href={`/admin/orders/${item.order_id}`} className="flex items-center gap-1 whitespace-nowrap rounded-lg bg-amber-600 px-2.5 py-1.5 text-[11px] font-bold text-white transition hover:bg-amber-700">
                        <RotateCcw className="h-3 w-3" /> إعادة المحاولة
                      </Link>
                    )}
                    {!item.is_read && (
                      <button onClick={() => void markRead(item.id)} title="تعليم كمقروء" className="rounded-lg border border-stone-200 p-1.5 text-stone-400 transition hover:bg-stone-50 hover:text-stone-600">
                        <CheckCheck className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button onClick={() => void remove(item.id)} title="حذف" className="rounded-lg border border-stone-200 p-1.5 text-stone-400 transition hover:bg-red-50 hover:text-red-600">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* Pagination */}
        {total > limit && (
          <div className="mt-4 flex items-center justify-between border-t border-stone-100 pt-4">
            <p className="text-xs text-stone-500">
              عرض {offset + 1}–{Math.min(offset + limit, total)} من {total}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setOffset((o) => Math.max(0, o - limit))}
                disabled={offset === 0}
                className="flex items-center gap-1 rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-semibold text-stone-600 transition hover:bg-stone-50 disabled:opacity-40"
              >
                <ChevronRight className="h-3.5 w-3.5" /> السابق
              </button>
              <button
                onClick={() => setOffset((o) => o + limit)}
                disabled={offset + limit >= total}
                className="flex items-center gap-1 rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-semibold text-stone-600 transition hover:bg-stone-50 disabled:opacity-40"
              >
                التالي <ChevronLeft className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({ label, value, color, bg, loading }: { label: string; value?: number | string; color: string; bg: string; loading: boolean }) {
  return (
    <article className={`rounded-xl border border-amber-100 ${bg} p-4`}>
      <p className="text-xs font-semibold text-stone-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>
        {loading && value === undefined ? <RefreshCcw className="h-5 w-5 animate-spin text-stone-300" /> : value ?? "—"}
      </p>
    </article>
  );
}

function FilterSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-stone-500">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-xl border border-stone-200 px-3 py-2 text-sm outline-none focus:border-gold">
        {children}
      </select>
    </div>
  );
}

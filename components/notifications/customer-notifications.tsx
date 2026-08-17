"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Trash2, CheckCheck, ExternalLink, Save } from "lucide-react";
import { timeAgo } from "./notification-bell";
import { severityMeta, CATEGORY_LABELS, renderMessageWithLinks } from "./meta";

type Item = {
  id: string;
  title: string;
  message: string;
  severity: string;
  category: string;
  order_id: string | null;
  order_number: number | null;
  action_url: string | null;
  is_read: boolean;
  created_at: string;
};

type Prefs = Record<string, { in_app: boolean; email: boolean; sms: boolean; push: boolean }>;

const CHANNELS = [
  { key: "email", label: "البريد الإلكتروني" },
  { key: "sms", label: "SMS" },
  { key: "push", label: "إشعارات المتصفح" },
] as const;

const PREF_CATEGORIES: { key: string; label: string; desc: string }[] = [
  { key: "orders", label: "إشعارات الطلبات", desc: "تأكيد الطلب، الإلغاء، تأكيد الدفع" },
  { key: "shipping", label: "تحديثات الشحن", desc: "جاري الشحن، في الطريق، التسليم" },
  { key: "payment", label: "إشعارات الدفع", desc: "نجاح أو فشل الدفع" },
  { key: "returns", label: "المرتجعات", desc: "حالة طلبات الاسترجاع" },
  { key: "marketing", label: "العروض التسويقية", desc: "العروض والخصومات — اختياري بالكامل" },
];

export function CustomerNotifications() {
  const [tab, setTab] = useState("all");
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ limit: "50" });
      if (tab === "unread") params.set("unread", "true");
      if (tab === "orders" || tab === "shipping" || tab === "payment") params.set("category", tab);
      const res = await fetch(`/api/notifications?${params}`, { cache: "no-store" });
      const json = await res.json();
      setItems(json.notifications ?? []);
      setTotal(json.total ?? 0);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [tab]);

  const loadPrefs = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications/preferences", { cache: "no-store" });
      const json = await res.json();
      setPrefs(json.preferences ?? null);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void loadPrefs();
  }, [loadPrefs]);

  const markRead = async (id: string) => {
    await fetch(`/api/notifications/${id}/read`, { method: "POST", cache: "no-store" });
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, is_read: true } : i)));
  };

  const markAllRead = async () => {
    await fetch("/api/notifications/read-all", { method: "POST", cache: "no-store" });
    setItems((prev) => prev.map((i) => ({ ...i, is_read: true })));
  };

  const remove = async (id: string) => {
    await fetch(`/api/notifications/${id}`, { method: "DELETE", cache: "no-store" });
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const savePrefs = async () => {
    setSaving(true);
    setSaved(false);
    await fetch("/api/notifications/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(prefs),
      cache: "no-store",
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const tabs = [
    { key: "all", label: "الكل" },
    { key: "unread", label: "غير المقروءة" },
    { key: "orders", label: "الطلبات" },
    { key: "shipping", label: "الشحن" },
    { key: "payment", label: "الدفع" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">الإشعارات</h1>
          <p className="mt-1 text-sm text-stone-500">متابعة حالة طلباتك وشحناتك</p>
        </div>
        <button
          onClick={markAllRead}
          disabled={!items.some((i) => !i.is_read)}
          className="flex items-center gap-1.5 rounded-full border border-sand bg-white px-4 py-2 text-xs font-bold text-stone-700 transition hover:bg-cream disabled:opacity-40"
        >
          <CheckCheck className="h-3.5 w-3.5 text-gold" /> تعليم الكل كمقروء
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto rounded-full border border-sand bg-white p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`whitespace-nowrap rounded-full px-4 py-2 text-xs font-bold transition ${tab === t.key ? "bg-ink text-ivory" : "text-stone-600 hover:bg-cream"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="rounded-3xl border border-sand bg-white p-4 md:p-6">
        {loading && <div className="flex justify-center py-14"><Loader2 className="h-6 w-6 animate-spin text-stone-300" /></div>}
        {!loading && items.length === 0 && <p className="py-14 text-center text-sm text-stone-400">لا توجد إشعارات</p>}

        <ul className="divide-y divide-sand">
          {items.map((item) => {
            const sev = severityMeta(item.severity);
            return (
              <li key={item.id} className={`group flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:gap-3 ${item.is_read ? "opacity-60" : ""}`}>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 break-words text-sm font-bold text-ink">
                    {item.title}
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold ${sev.badge}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${sev.dot}`} />
                      {sev.label}
                    </span>
                  </p>
                  {item.message && <p className="mt-1 text-xs leading-relaxed text-stone-500 [overflow-wrap:anywhere]">{renderMessageWithLinks(item.message, "font-bold text-amber-700 underline decoration-amber-300 underline-offset-2 hover:text-amber-800")}</p>}
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-stone-400">
                    <span dir="ltr">{timeAgo(item.created_at)}</span>
                    <span className="rounded-full bg-cream px-2 py-0.5 font-semibold text-stone-500">{CATEGORY_LABELS[item.category] || item.category}</span>
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 sm:hidden">
                    {item.order_id && (
                      <Link href="/account#orders" className="flex items-center gap-1 whitespace-nowrap rounded-lg border border-sand px-2 py-1.5 text-[11px] font-semibold text-stone-600 transition hover:bg-cream">
                        فتح <ExternalLink className="h-3 w-3" />
                      </Link>
                    )}
                    {!item.is_read && (
                      <button onClick={() => void markRead(item.id)} title="تعليم كمقروء" className="rounded-lg border border-sand p-1.5 text-stone-400 transition hover:bg-cream hover:text-stone-600">
                        <CheckCheck className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button onClick={() => void remove(item.id)} title="حذف" className="rounded-lg border border-sand p-1.5 text-stone-400 transition hover:bg-rose-50 hover:text-rose-600">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="hidden shrink-0 flex-wrap items-center justify-end gap-1 sm:flex">
                  {item.order_id && (
                    <Link href="/account#orders" className="flex items-center gap-1 whitespace-nowrap rounded-lg border border-sand px-2 py-1.5 text-[11px] font-semibold text-stone-600 transition hover:bg-cream">
                      فتح <ExternalLink className="h-3 w-3" />
                    </Link>
                  )}
                  {!item.is_read && (
                    <button onClick={() => void markRead(item.id)} title="تعليم كمقروء" className="rounded-lg border border-sand p-1.5 text-stone-400 transition hover:bg-cream hover:text-stone-600">
                      <CheckCheck className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button onClick={() => void remove(item.id)} title="حذف" className="rounded-lg border border-sand p-1.5 text-stone-400 transition hover:bg-rose-50 hover:text-rose-600">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        {total > 50 && <p className="mt-3 text-center text-xs text-stone-400">يتم عرض آخر 50 إشعارًا</p>}
      </div>

      {/* Preferences */}
      <div className="rounded-3xl border border-sand bg-white p-4 md:p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-ink">تفضيلات الإشعارات</h2>
            <p className="mt-0.5 text-xs text-stone-500">إشعارات الطلبات والدفع والمشاكل إلزامية ولا تتأثر بهذه الإعدادات.</p>
          </div>
          <button
            onClick={savePrefs}
            disabled={saving || !prefs}
            className="flex items-center gap-1.5 rounded-full bg-gold px-5 py-2.5 text-xs font-bold text-white transition hover:bg-gold-dark disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" /> {saved ? "تم الحفظ ✓" : "حفظ التفضيلات"}
          </button>
        </div>

        {!prefs && <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-stone-300" /></div>}
        {prefs && (
          <div className="mt-4">
            <div className="hidden grid-cols-[1fr_repeat(3,1fr)] gap-2 border-b border-sand pb-2 text-center text-[11px] font-bold text-stone-500 md:grid">
              <span className="text-start">التصنيف</span>
              {CHANNELS.map((c) => <span key={c.key}>{c.label}</span>)}
            </div>
            {PREF_CATEGORIES.map((cat) => (
              <div key={cat.key} className="border-b border-sand py-3 last:border-b-0">
                <div className="md:hidden">
                  <p className="text-sm font-bold text-ink">{cat.label}</p>
                  <p className="text-[11px] text-stone-500">{cat.desc}</p>
                  <div className="mt-2 space-y-1.5">
                    {CHANNELS.map((c) => (
                      <label key={c.key} className="flex items-center justify-between rounded-xl bg-cream px-3 py-2.5 text-xs font-semibold text-stone-700">
                        <span>{c.label}</span>
                        <input
                          type="checkbox"
                          checked={Boolean(prefs[cat.key]?.[c.key])}
                          onChange={(e) =>
                            setPrefs((p) => (p ? { ...p, [cat.key]: { ...p[cat.key], [c.key]: e.target.checked } } : p))
                          }
                          className="h-4 w-4 accent-gold"
                        />
                      </label>
                    ))}
                  </div>
                </div>
                <div className="hidden items-center gap-2 md:grid md:grid-cols-[1fr_repeat(3,1fr)]">
                  <div>
                    <p className="text-sm font-bold text-ink">{cat.label}</p>
                    <p className="text-[11px] text-stone-500">{cat.desc}</p>
                  </div>
                  {CHANNELS.map((c) => (
                    <label key={c.key} className="flex items-center justify-center">
                      <input
                        type="checkbox"
                        checked={Boolean(prefs[cat.key]?.[c.key])}
                        onChange={(e) =>
                          setPrefs((p) => (p ? { ...p, [cat.key]: { ...p[cat.key], [c.key]: e.target.checked } } : p))
                        }
                        className="h-4 w-4 accent-gold"
                      />
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

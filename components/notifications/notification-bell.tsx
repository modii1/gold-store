"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { Bell, CheckCheck, ExternalLink, Loader2 } from "lucide-react";
import { severityMeta } from "./meta";

type BellItem = {
  id: string;
  title: string;
  message: string;
  severity: string;
  category: string;
  order_id: string | null;
  order_number: number | null;
  shipment_id: string | null;
  action_url: string | null;
  is_read: boolean;
  created_at: string;
};

export function NotificationBell({ scope = "admin" }: { scope?: "admin" | "customer" }) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<BellItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const base = scope === "admin" ? "/api/notifications" : "/api/notifications";
      const [countRes, listRes] = await Promise.all([
        fetch(`${base}/unread-count`, { cache: "no-store" }),
        fetch(`${base}?limit=6`, { cache: "no-store" }),
      ]);
      const countJson = await countRes.json();
      const listJson = await listRes.json();
      setUnread(countJson.count ?? 0);
      setItems(listJson.notifications ?? []);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const markAllRead = async () => {
    await fetch("/api/notifications/read-all", { method: "POST", cache: "no-store" });
    setUnread(0);
    setItems((prev) => prev.map((i) => ({ ...i, is_read: true })));
  };

  const markRead = async (id: string) => {
    await fetch(`/api/notifications/${id}/read`, { method: "POST", cache: "no-store" });
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, is_read: true } : i)));
    setUnread((u) => Math.max(0, u - 1));
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="الإشعارات"
        className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-amber-100 bg-white text-stone-600 shadow-sm transition hover:bg-amber-50"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -top-1 -left-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-12 z-50 w-[min(92vw,380px)] overflow-hidden rounded-2xl border border-amber-100 bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
            <div>
              <p className="text-sm font-bold text-stone-900">الإشعارات</p>
              {unread > 0 && <p className="text-[11px] text-red-500">{unread} غير مقروء</p>}
            </div>
            {unread > 0 && (
              <button onClick={markAllRead} className="flex items-center gap-1 text-[11px] font-semibold text-gold hover:underline">
                <CheckCheck className="h-3.5 w-3.5" />
                تعليم الكل كمقروء
              </button>
            )}
          </div>

          <div className="max-h-[360px] overflow-y-auto">
            {loading && items.length === 0 && (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-stone-300" />
              </div>
            )}
            {error && <p className="py-8 text-center text-xs text-stone-400">تعذر تحميل الإشعارات</p>}
            {!loading && !error && items.length === 0 && (
              <p className="py-8 text-center text-xs text-stone-400">لا توجد إشعارات</p>
            )}
            {items.map((item) => {
              const sev = severityMeta(item.severity);
              return (
                <button
                  key={item.id}
                  onClick={() => void markRead(item.id)}
                  className="flex w-full items-start gap-3 border-b border-stone-50 px-4 py-3 text-right transition hover:bg-stone-50"
                >
                  <span className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${sev.dot}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-stone-800">{item.title}</span>
                    <span className="mt-0.5 block line-clamp-2 text-[11px] text-stone-500">{item.message}</span>
                    <span className="mt-1 block text-[10px] text-stone-400" dir="ltr">
                      {timeAgo(item.created_at)}
                    </span>
                  </span>
                  {!item.is_read && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-gold" />}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between border-t border-stone-100 px-4 py-2.5">
            <Link
              href={scope === "admin" ? "/admin/notifications" : "/account/notifications"}
              onClick={() => setOpen(false)}
              className="flex items-center gap-1 text-[12px] font-semibold text-gold hover:underline"
            >
              عرض جميع الإشعارات <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export function timeAgo(value: string): string {
  const diff = Date.now() - new Date(value).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "الآن";
  if (m < 60) return `منذ ${m} دقيقة`;
  const h = Math.floor(m / 60);
  if (h < 24) return `منذ ${h} ساعة`;
  const d = Math.floor(h / 24);
  if (d === 1) return "منذ يوم";
  return `منذ ${d} يوم`;
}

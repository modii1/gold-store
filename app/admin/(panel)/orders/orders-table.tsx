"use client";

import { useState } from "react";
import {
  Eye, Loader2, ChevronLeft, ChevronRight, AlertCircle, Tag, RefreshCw, Check, ExternalLink,
} from "lucide-react";
import type { Order, OrdersQueryParams, OrderSortKey } from "@/types";
import { Currency } from "@/components/storefront/currency";
import { formatDate, pluralizeArabic } from "@/lib/format";
import { LIMIT_OPTIONS } from "@/lib/orders/query";
import {
  ORDER_STATUS_META, ALL_ORDER_STATUSES,
} from "@/lib/orders/order-meta";
import { cn } from "@/lib/utils";

type Props = {
  orders: Order[];
  total: number;
  pages: number;
  page: number;
  limit: number;
  params: OrdersQueryParams;
  selected: string[];
  busyId: string | null;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onSort: (key: OrderSortKey) => void;
  onPage: (n: number) => void;
  onLimit: (l: number) => void;
  onOpen: (o: Order) => void;
  onStatus: (o: Order, target: string, label: string) => void;
  onShip: (o: Order) => void;
  onApproveTransfer: (o: Order) => void;
  onRejectTransfer: (o: Order) => void;
  onDelete: (o: Order) => void;
  onPrint: (o: Order) => void;
  onCopy: (o: Order) => void;
};

function itemsSummary(o: Order) {
  const items = o.items || [];
  if (!items.length) return "بدون منتجات";
  const head = items.slice(0, 2).map((it) => `${it.name} ×${it.qty}`).join("، ");
  if (items.length > 2) return `${head} +${items.length - 2}`;
  return head;
}

function StatusMenu({ o, busy, onStatus }: { o: Order; busy: boolean; onStatus: (o: Order, target: string, label: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        className="flex items-center gap-1 rounded-lg bg-gold/10 px-2.5 py-1.5 text-xs font-bold text-gold-dark hover:bg-gold/20 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        تغيير حالة الطلب
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-xl border border-stone-200 bg-white py-1 shadow-lg">
            {ALL_ORDER_STATUSES.map((s) => (
              <button
                key={s.value}
                onClick={() => {
                  setOpen(false);
                  if (s.value !== o.status) onStatus(o, s.value, s.label);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-xs font-bold text-stone-600 hover:bg-stone-50"
              >
                <span className={`h-2 w-2 rounded-full ${ORDER_STATUS_META[s.value].cls.split(" ").find((c) => c.startsWith("bg-")) || "bg-stone-300"}`} />
                {s.label}
                {s.value === o.status && <Check className="mr-auto h-3.5 w-3.5 text-emerald-600" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function OrdersTable(props: Props) {
  const { orders, total, pages, page, limit, selected, busyId } = props;

  const allSelected = orders.length > 0 && orders.every((o) => selected.includes(o.id));

  if (!orders.length) {
    return (
      <div className="rounded-2xl border border-amber-100 bg-white p-14 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-cream">
          <AlertCircle className="h-6 w-6 text-gold/50" />
        </div>
        <p className="font-bold text-stone-700">لا توجد طلبات مطابقة</p>
        <p className="mt-1 text-sm text-stone-400">جرّب تغيير الفلاتر أو البحث بكلمة أخرى</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs font-bold text-stone-600">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => props.onToggleAll()}
              aria-label="تحديد الكل في الصفحة"
              className="h-4 w-4 accent-gold"
            />
            تحديد الكل
          </label>
          <p className="text-sm text-stone-500">
            عرض <b>{orders.length === 0 ? 0 : (page - 1) * limit + 1}</b>–<b>{Math.min((page - 1) * limit + orders.length, total)}</b> من{" "}
            <b>{total}</b> {pluralizeArabic(total, "طلب", "طلبين", "طلب")}
          </p>
        </div>
        <select
          value={limit}
          onChange={(e) => props.onLimit(Number(e.target.value))}
          aria-label="عدد الطلبات بالصفحة"
          className="rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs focus:border-gold focus:outline-none"
        >
          {LIMIT_OPTIONS.map((l) => (
            <option key={l} value={l}>{l} لكل صفحة</option>
          ))}
        </select>
      </div>

      {/* ============ Cards ============ */}
      <div className="space-y-3">
        {orders.map((o) => {
          const st = ORDER_STATUS_META[o.status] || ORDER_STATUS_META.pending;
          return (
            <article key={o.id} className="rounded-2xl border border-amber-100 bg-white p-4">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selected.includes(o.id)}
                  onChange={() => props.onToggle(o.id)}
                  aria-label={`تحديد طلب #${o.order_number}`}
                  className="mt-1 h-4 w-4 accent-gold"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => props.onOpen(o)} className="font-bold text-stone-900 hover:text-gold">
                      #{o.order_number}
                    </button>
                    <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-bold", st.cls)}>{st.label}</span>
                  </div>
                  <p className="mt-0.5 text-right text-xs text-stone-400" dir="ltr">{formatDate(o.created_at)}</p>
                </div>
                <Currency value={o.total} className="text-lg font-extrabold text-gold" />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <p className="text-sm font-semibold text-stone-700">{o.customer_name}</p>
                <span className="text-xs text-stone-400" dir="ltr">{o.customer_phone}</span>
                {o.customer_city && <span className="text-xs text-stone-400">— {o.customer_city}</span>}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {o.coupon_code && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-gold/10 px-2 py-0.5 text-[11px] font-bold text-gold-dark">
                    <Tag className="h-3 w-3" /> {o.coupon_code}
                  </span>
                )}
              </div>

              <p className="mt-2 truncate text-xs text-stone-500">{itemsSummary(o)}</p>

              {o.tracking_number && (
                <p className="mt-1 text-[11px] font-semibold text-blue-600">
                  {o.tracking_url ? (
                    <a href={o.tracking_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">
                      تتبع: {o.tracking_number} <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    `تتبع: ${o.tracking_number}`
                  )}
                </p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-3">
                <button
                  onClick={() => props.onOpen(o)}
                  className="flex items-center gap-1 rounded-lg bg-stone-100 px-2.5 py-1.5 text-xs font-bold text-stone-700 hover:bg-stone-200"
                >
                  <Eye className="h-3.5 w-3.5" /> تفاصيل
                </button>
                <StatusMenu o={o} busy={busyId === o.id} onStatus={props.onStatus} />
              </div>
            </article>
          );
        })}
      </div>

      {/* ============ Pagination ============ */}
      {pages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-stone-400">
            الصفحة {page} من {pages}
          </p>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => props.onPage(page - 1)}
              disabled={page <= 1}
              aria-label="الصفحة السابقة"
              className="flex items-center gap-1 rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-bold text-stone-600 hover:bg-stone-100 disabled:opacity-40"
            >
              <ChevronRight className="h-3.5 w-3.5" /> السابق
            </button>
            {Array.from({ length: pages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === pages || Math.abs(p - page) <= 1)
              .reduce<number[]>((acc, p) => {
                if (acc.length && p - acc[acc.length - 1] > 1) acc.push(-1);
                acc.push(p);
                return acc;
              }, [])
              .map((p, i) =>
                p === -1 ? (
                  <span key={`e-${i}`} className="px-1 text-stone-400">…</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => props.onPage(p)}
                    aria-current={p === page ? "page" : undefined}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
                      p === page ? "bg-gold text-white" : "border border-stone-200 text-stone-600 hover:bg-stone-100"
                    }`}
                  >
                    {p}
                  </button>
                )
              )}
            <button
              onClick={() => props.onPage(page + 1)}
              disabled={page >= pages}
              aria-label="الصفحة التالية"
              className="flex items-center gap-1 rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-bold text-stone-600 hover:bg-stone-100 disabled:opacity-40"
            >
              التالي <ChevronLeft className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

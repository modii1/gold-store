"use client";

import Link from "next/link";
import {
  Eye, Loader2, Truck, CheckCircle2, PackageCheck, Banknote, Clock, Trash2, Printer, Copy,
  ExternalLink, ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight, AlertCircle, Tag,
} from "lucide-react";
import type { Order, OrdersQueryParams, OrderSortKey } from "@/types";
import { Currency } from "@/components/storefront/currency";
import { formatDate, pluralizeArabic } from "@/lib/format";
import { LIMIT_OPTIONS } from "@/lib/orders/query";
import {
  ORDER_STATUS_META, PAYMENT_STATUS_META, SHIPPING_STATUS_META,
  derivePaymentStatus, deriveShippingStatus, isTransfer, workflowAction,
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

function badge(meta: { label: string; cls: string }) {
  return <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-bold ${meta.cls}`}>{meta.label}</span>;
}

function itemsSummary(o: Order) {
  const items = o.items || [];
  if (!items.length) return "بدون منتجات";
  const head = items.slice(0, 2).map((it) => `${it.name} ×${it.qty}`).join("، ");
  if (items.length > 2) return `${head} +${items.length - 2}`;
  return head;
}

export function OrdersTable(props: Props) {
  const { orders, total, pages, page, limit, params, selected, busyId } = props;

  const allSelected = orders.length > 0 && orders.every((o) => selected.includes(o.id));

  const SortTh = ({ label, k, className = "" }: { label: string; k: OrderSortKey; className?: string }) => {
    const active = params.sort === k;
    const Icon = active ? (params.dir === "asc" ? ChevronUp : ChevronDown) : ChevronsUpDown;
    return (
      <th className={`px-4 py-3.5 ${className}`}>
        <button
          onClick={() => props.onSort(k)}
          aria-label={`ترتيب حسب ${label}`}
          className="inline-flex items-center gap-1 font-bold text-stone-600 hover:text-gold-dark"
        >
          {label}
          <Icon className="h-3.5 w-3.5" />
        </button>
      </th>
    );
  };

  const TransferActions = ({ o }: { o: Order }) => {
    if (!isTransfer(o)) return null;
    if (o.status !== "pending" && o.status !== "confirmed") return null;
    if (!o.transfer_receipt_url) {
      return (
        <span className="flex items-center gap-1 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-bold text-amber-700">
          <Clock className="h-3.5 w-3.5" /> بانتظار إثبات التحويل
        </span>
      );
    }
    return (
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => props.onApproveTransfer(o)}
          disabled={busyId === o.id}
          className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          <CheckCircle2 className="h-3.5 w-3.5" /> اعتماد التحويل
        </button>
        <button
          onClick={() => props.onRejectTransfer(o)}
          disabled={busyId === o.id}
          className="flex items-center gap-1 rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-100 disabled:opacity-50"
        >
          رفض
        </button>
      </div>
    );
  };

  const QuickAction = ({ o }: { o: Order }) => {
    const w = workflowAction(o);
    if (!w) return null;
    if (w.type === "blocked") {
      return (
        <span className="flex items-center gap-1 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-bold text-amber-700">
          <Clock className="h-3.5 w-3.5" /> {w.label}
        </span>
      );
    }
    if (w.type === "ship") {
      return (
        <button
          onClick={() => props.onShip(o)}
          disabled={busyId === o.id}
          className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {busyId === o.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Truck className="h-3.5 w-3.5" />}
          {w.label}
        </button>
      );
    }
    return (
      <button
        onClick={() => props.onStatus(o, w.target as string, w.label)}
        disabled={busyId === o.id}
        className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {busyId === o.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : wIconFor(w.label)}
        {w.label}
      </button>
    );
  };

  function wIconFor(label: string) {
    if (label.includes("تسليم")) return <PackageCheck className="h-3.5 w-3.5" />;
    if (label.includes("دفع")) return <Banknote className="h-3.5 w-3.5" />;
    return <CheckCircle2 className="h-3.5 w-3.5" />;
  }

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
        <p className="text-sm text-stone-500">
          عرض <b>{total === 0 ? 0 : (page - 1) * limit + 1}</b>–<b>{Math.min(page * limit, total)}</b> من{" "}
          <b>{total}</b> {pluralizeArabic(total, "طلب", "طلبين", "طلب")}
        </p>
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

      {/* ============ Mobile cards ============ */}
      <div className="space-y-3 md:hidden">
        {orders.map((o) => {
          const st = ORDER_STATUS_META[o.status] || ORDER_STATUS_META.pending;
          const pst = PAYMENT_STATUS_META[derivePaymentStatus(o)];
          const sst = SHIPPING_STATUS_META[deriveShippingStatus(o)];
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
                  <p className="mt-0.5 text-xs text-stone-400" dir="ltr">{formatDate(o.created_at)}</p>
                </div>
                <Currency value={o.total} className="text-lg font-extrabold text-gold" />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <p className="text-sm font-semibold text-stone-700">{o.customer_name}</p>
                <span className="text-xs text-stone-400" dir="ltr">{o.customer_phone}</span>
                {o.customer_city && <span className="text-xs text-stone-400">— {o.customer_city}</span>}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {badge(pst)}
                {badge(sst)}
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
                <TransferActions o={o} />
                <QuickAction o={o} />
                <button onClick={() => props.onPrint(o)} aria-label="طباعة الفاتورة"
                  className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold text-stone-500 hover:bg-stone-100">
                  <Printer className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => props.onCopy(o)} aria-label="نسخ رقم الطلب"
                  className="rounded-lg px-2 py-1.5 text-stone-400 hover:bg-stone-100">
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => props.onDelete(o)} aria-label="حذف الطلب"
                  className="mr-auto rounded-lg px-2 py-1.5 text-stone-400 hover:bg-rose-50 hover:text-rose-600">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {/* ============ Desktop table ============ */}
      <div className="hidden overflow-hidden rounded-2xl border border-amber-100 bg-white md:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead>
              <tr className="border-b border-stone-100 bg-stone-50 text-right text-xs text-stone-500">
                <th className="px-4 py-3.5">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => props.onToggleAll()}
                    aria-label="تحديد الكل"
                    className="h-4 w-4 accent-gold"
                  />
                </th>
                <SortTh label="الطلب" k="order_number" />
                <th className="px-4 py-3.5 font-bold text-stone-600">العميل</th>
                <th className="px-4 py-3.5 font-bold text-stone-600">المنتجات</th>
                <th className="px-4 py-3.5 font-bold text-stone-600">المدينة</th>
                <SortTh label="الإجمالي" k="total" />
                <th className="px-4 py-3.5 font-bold text-stone-600">الدفع</th>
                <SortTh label="الحالة" k="status" />
                <th className="px-4 py-3.5 font-bold text-stone-600">الشحن</th>
                <SortTh label="التاريخ" k="created_at" />
                <th className="px-4 py-3.5 font-bold text-stone-600">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {orders.map((o) => {
                const st = ORDER_STATUS_META[o.status] || ORDER_STATUS_META.pending;
                const pst = PAYMENT_STATUS_META[derivePaymentStatus(o)];
                const sst = SHIPPING_STATUS_META[deriveShippingStatus(o)];
                return (
                  <tr key={o.id} className="align-top hover:bg-stone-50/70">
                    <td className="px-4 py-4">
                      <input
                        type="checkbox"
                        checked={selected.includes(o.id)}
                        onChange={() => props.onToggle(o.id)}
                        aria-label={`تحديد طلب #${o.order_number}`}
                        className="h-4 w-4 accent-gold"
                      />
                    </td>
                    <td className="px-4 py-4">
                      <button onClick={() => props.onOpen(o)} className="font-bold text-stone-900 hover:text-gold">
                        #{o.order_number}
                      </button>
                      {o.coupon_code && (
                        <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-gold/10 px-2 py-0.5 text-[11px] font-bold text-gold-dark">
                          <Tag className="h-3 w-3" /> {o.coupon_code}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <p className="font-semibold text-stone-800">{o.customer_name}</p>
                      <p className="mt-0.5 text-xs text-stone-500" dir="ltr">{o.customer_phone}</p>
                      {o.email && <p className="mt-0.5 max-w-[170px] truncate text-xs text-stone-400" dir="ltr">{o.email}</p>}
                    </td>
                    <td className="px-4 py-4">
                      <p className="max-w-[220px] truncate text-xs text-stone-600" title={itemsSummary(o)}>
                        {itemsSummary(o)}
                      </p>
                      <p className="mt-0.5 text-[11px] text-stone-400">
                        {(o.items || []).reduce((s, it) => s + (it.qty || 0), 0)} قطعة
                      </p>
                    </td>
                    <td className="px-4 py-4">
                      <p className="text-xs text-stone-600">{o.customer_city || "—"}</p>
                      {o.region && <p className="mt-0.5 text-[11px] text-stone-400">{o.region}</p>}
                    </td>
                    <td className="px-4 py-4">
                      <Currency value={o.total} className="text-base font-extrabold text-gold" />
                    </td>
                    <td className="px-4 py-4">
                      <p className="text-xs text-stone-700">{o.payment_method || "—"}</p>
                      <span className="mt-1 inline-block">{badge(pst)}</span>
                      {o.transfer_receipt_url && (
                        <a href={o.transfer_receipt_url} target="_blank" rel="noopener noreferrer"
                          className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 hover:underline">
                          <ExternalLink className="h-3 w-3" /> إثبات التحويل
                        </a>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <span className={cn("inline-block whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-bold", st.cls)}>
                        {st.label}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      {o.shipping_method && <p className="text-xs text-stone-600">{o.shipping_method}</p>}
                      {o.tracking_number ? (
                        <p className="mt-1 text-[11px] font-semibold text-blue-600">
                          {o.tracking_url ? (
                            <a href={o.tracking_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">
                              تتبع: {o.tracking_number} <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : (
                            `تتبع: ${o.tracking_number}`
                          )}
                        </p>
                      ) : (
                        <p className="mt-1 text-[11px] text-stone-400">بدون تتبع</p>
                      )}
                      <span className="mt-1 inline-block">{badge(sst)}</span>
                    </td>
                    <td className="px-4 py-4">
                      <p className="whitespace-nowrap text-xs text-stone-600" dir="ltr">{formatDate(o.created_at)}</p>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          onClick={() => props.onOpen(o)}
                          className="flex items-center gap-1 rounded-lg border border-stone-200 px-2.5 py-1.5 text-xs font-bold text-stone-700 hover:bg-stone-100"
                        >
                          <Eye className="h-3.5 w-3.5" /> تفاصيل
                        </button>
                        <TransferActions o={o} />
                        <QuickAction o={o} />
                        <button onClick={() => props.onPrint(o)} aria-label="طباعة الفاتورة"
                          className="rounded-lg border border-stone-200 p-1.5 text-stone-500 hover:bg-stone-100">
                          <Printer className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => props.onCopy(o)} aria-label="نسخ رقم الطلب"
                          className="rounded-lg border border-stone-200 p-1.5 text-stone-400 hover:bg-stone-100">
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => props.onDelete(o)} aria-label="حذف الطلب"
                          className="rounded-lg border border-stone-200 p-1.5 text-stone-400 hover:bg-rose-50 hover:text-rose-600">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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

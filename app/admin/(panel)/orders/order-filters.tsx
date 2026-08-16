"use client";

import { useEffect, useRef, useState } from "react";
import { Search, Filter, X, Calendar } from "lucide-react";
import type { Carrier, OrdersQueryParams, OrderStatus } from "@/types";
import { ALL_ORDER_STATUSES } from "@/lib/orders/order-meta";
import { formatDateOnly } from "@/lib/format";

const statusOptions = [{ value: "all", label: "جميع الحالات" }, ...ALL_ORDER_STATUSES];

const paymentOptions = [
  { value: "all", label: "حالة الدفع: الكل" },
  { value: "paid", label: "مدفوع" },
  { value: "unpaid", label: "غير مدفوع" },
  { value: "awaiting", label: "بانتظار إثبات/اعتماد التحويل" },
  { value: "refunded", label: "مسترد" },
  { value: "cancelled", label: "ملغي" },
];

const paymentMethodOptions = [
  { value: "all", label: "طريقة الدفع: الكل" },
  { value: "transfer", label: "تحويل بنكي" },
  { value: "cod", label: "الدفع عند الاستلام" },
];

const quickFilters = [
  { label: "اليوم", days: 0 },
  { label: "أمس", days: 1, fromYesterday: true },
  { label: "آخر 7 أيام", days: 7 },
  { label: "آخر 30 يوم", days: 30 },
  { label: "هذا الشهر", month: true },
];

type Props = {
  params: OrdersQueryParams;
  carriers: Carrier[];
  onChange: (patch: Partial<OrdersQueryParams>) => void;
  onClear: () => void;
};

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function DateField({
  value,
  label,
  onChange,
}: {
  value: string;
  label: string;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <div className="relative">
      <div
        dir="ltr"
        className="pointer-events-none flex h-full w-full items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm"
      >
        <Calendar className="h-4 w-4 shrink-0 text-stone-400" />
        <span className={value ? "font-semibold text-stone-700" : "text-stone-400"}>{value ? formatDateOnly(value) : label}</span>
      </div>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value || undefined)}
        aria-label={label}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </div>
  );
}

export function OrderFilters({ params, carriers, onChange, onClear }: Props) {
  const [query, setQuery] = useState(params.q || "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setQuery(params.q || "");
  }, [params.q]);

  const handleQuery = (value: string) => {
    setQuery(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      onChange({ q: value.trim() || undefined });
    }, 400);
  };

  const applyQuick = (q: (typeof quickFilters)[number]) => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let from: string | undefined;
    let to: string | undefined = isoDate(now);

    if (q.month) {
      from = isoDate(new Date(now.getFullYear(), now.getMonth(), 1));
    } else if (q.fromYesterday) {
      from = isoDate(new Date(todayStart.getTime() - 24 * 60 * 60 * 1000));
    } else if (q.days === 0) {
      from = isoDate(todayStart);
    } else {
      const days = q.days ?? 0;
      from = isoDate(new Date(todayStart.getTime() - (days - 1) * 24 * 60 * 60 * 1000));
    }
    onChange({ from, to });
  };

  const hasFilters = Boolean(
    params.q ||
      (params.status && params.status !== "all") ||
      (params.payment && params.payment !== "all") ||
      (params.payment_method && params.payment_method !== "all") ||
      (params.carrier && params.carrier !== "all") ||
      params.from ||
      params.to
  );

  const selectCls =
    "rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm focus:border-gold focus:outline-none";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => handleQuery(e.target.value)}
            placeholder="بحث فوري: اسم، هاتف، رقم الطلب، رقم الشحنة..."
            aria-label="البحث في الطلبات"
            className="w-full rounded-xl border border-stone-200 py-2.5 pl-4 pr-10 text-sm focus:border-gold focus:outline-none"
          />
        </div>

        <select
          value={params.status || "all"}
          onChange={(e) => onChange({ status: e.target.value as OrderStatus | "all" })}
          aria-label="حالة الطلب"
          className={selectCls}
        >
          {statusOptions.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>

        <select
          value={params.payment || "all"}
          onChange={(e) => onChange({ payment: e.target.value })}
          aria-label="حالة الدفع"
          className={selectCls}
        >
          {paymentOptions.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>

        <select
          value={params.payment_method || "all"}
          onChange={(e) => onChange({ payment_method: e.target.value })}
          aria-label="طريقة الدفع"
          className={selectCls}
        >
          {paymentMethodOptions.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>

        <select
          value={params.carrier || "all"}
          onChange={(e) => onChange({ carrier: e.target.value })}
          aria-label="شركة الشحن"
          className={selectCls}
        >
          <option value="all">شركة الشحن: الكل</option>
          <option value="oto">OTO</option>
          <option value="none">بدون شحنة</option>
          {carriers.map((c) => (
            <option key={c.id} value={c.code}>{c.name}</option>
          ))}
        </select>

        <DateField
          value={params.from || ""}
          label="من تاريخ"
          onChange={(v) => onChange({ from: v })}
        />
        <DateField
          value={params.to || ""}
          label="إلى تاريخ"
          onChange={(v) => onChange({ to: v })}
        />

        {hasFilters && (
          <button
            onClick={onClear}
            className="flex items-center gap-1 rounded-xl border border-stone-200 px-3 py-2.5 text-sm text-stone-500 hover:bg-stone-50"
          >
            <X className="h-4 w-4" /> مسح الفلاتر
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1 text-xs font-bold text-stone-400">
          <Filter className="h-3.5 w-3.5" /> سريع:
        </span>
        {quickFilters.map((q) => (
          <button
            key={q.label}
            onClick={() => applyQuick(q)}
            className="rounded-full border border-stone-200 bg-white px-3 py-1 text-xs font-bold text-stone-600 hover:border-gold hover:text-gold-dark"
          >
            {q.label}
          </button>
        ))}
      </div>
    </div>
  );
}

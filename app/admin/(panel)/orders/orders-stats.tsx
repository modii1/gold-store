"use client";

import { ClipboardList, Coins, Wallet, AlertCircle, RotateCcw } from "lucide-react";
import type { OrderStats } from "@/types";
import { formatCurrency } from "@/lib/format";

type Props = {
  stats: OrderStats;
  onApply: (patch: { status?: string; payment?: string }) => void;
};

export function OrdersStats({ stats, onApply }: Props) {
  const cards = [
    {
      label: "إجمالي الطلبات",
      value: formatCurrency(stats.total),
      hint: "جميع طلبات المتجر",
      icon: ClipboardList,
      iconCls: "bg-gold/10 text-gold-dark",
      onClick: () => onApply({ status: "all", payment: "all" }),
    },
    {
      label: "مبيعات اليوم",
      value: formatCurrency(stats.today_sales),
      hint: `${stats.today_orders} ${stats.today_orders === 1 ? "طلب" : stats.today_orders === 2 ? "طلبان" : "طلبات"} مدفوعة اليوم`,
      icon: Wallet,
      iconCls: "bg-emerald-50 text-emerald-600",
      onClick: () => onApply({ payment: "paid" }),
    },
    {
      label: "إجمالي المبيعات",
      value: formatCurrency(stats.total_sales),
      hint: "الطلبات المدفوعة والمسلّمة",
      icon: Coins,
      iconCls: "bg-sky-50 text-sky-600",
      onClick: () => onApply({ payment: "paid" }),
    },
    {
      label: "بانتظار إجراء",
      value: formatCurrency(stats.needs_action),
      hint: "طلبات تحتاج تدخل الإدارة",
      icon: AlertCircle,
      iconCls: "bg-amber-50 text-amber-600",
      onClick: () => onApply({ status: "pending" }),
    },
    {
      label: "مرتجع / ملغي",
      value: formatCurrency(stats.returns_cancelled),
      hint: "طلبات أنهيت بالإرجاع أو الإلغاء",
      icon: RotateCcw,
      iconCls: "bg-rose-50 text-rose-500",
      onClick: () => onApply({ status: "returned" }),
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <button
            key={c.label}
            onClick={c.onClick}
            className="group rounded-2xl border border-amber-100 bg-white p-4 text-right transition hover:-translate-y-0.5 hover:border-gold/40 hover:shadow-md"
          >
            <div className={`mb-3 inline-flex rounded-xl p-2.5 ${c.iconCls}`}>
              <Icon className="h-5 w-5" />
            </div>
            <p className="text-2xl font-extrabold text-stone-900" dir="ltr">
              {c.value}
            </p>
            <p className="mt-0.5 text-sm font-bold text-stone-700">{c.label}</p>
            <p className="mt-0.5 text-[11px] text-stone-400">{c.hint}</p>
          </button>
        );
      })}
    </div>
  );
}

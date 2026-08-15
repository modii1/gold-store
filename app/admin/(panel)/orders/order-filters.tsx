"use client";

import { useState, useTransition } from "react";
import { Search, Filter, X } from "lucide-react";

const statusOptions = [
  { value: "all", label: "جميع الحالات" },
  { value: "pending", label: "قيد المراجعة" },
  { value: "confirmed", label: "مؤكد" },
  { value: "processing", label: "قيد التجهيز" },
  { value: "shipped", label: "تم الشحن" },
  { value: "delivered", label: "تم التسليم" },
  { value: "paid", label: "مدفوع" },
  { value: "cancelled", label: "ملغي" },
  { value: "returned", label: "مرتجع" },
];

type Props = {
  onSearch: (query: string, status: string) => void;
  isPending: boolean;
};

export function OrderFilters({ onSearch, isPending }: Props) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(query, status);
  };

  const handleClear = () => {
    setQuery("");
    setStatus("all");
    onSearch("", "all");
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-3">
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="بحث بالاسم، الهاتف، رقم الطلب..."
          className="w-full rounded-xl border border-stone-200 pr-10 pl-4 py-2.5 text-sm focus:border-gold focus:outline-none"
        />
      </div>
      <select
        value={status}
        onChange={(e) => { setStatus(e.target.value); onSearch(query, e.target.value); }}
        className="rounded-xl border border-stone-200 px-3 py-2.5 text-sm focus:border-gold focus:outline-none"
      >
        {statusOptions.map((s) => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>
      {(query || status !== "all") && (
        <button type="button" onClick={handleClear}
          className="flex items-center gap-1 rounded-xl border border-stone-200 px-3 py-2.5 text-sm text-stone-500 hover:bg-stone-50 transition">
          <X className="w-4 h-4" /> مسح
        </button>
      )}
      {isPending && <span className="text-xs text-stone-400">جاري البحث...</span>}
    </form>
  );
}

"use client";

import { useState } from "react";
import { PackageSearch, ExternalLink, Search } from "lucide-react";
import { cn } from "@/lib/utils";

type Shipment = {
  id: string;
  order_id: string | null;
  oto_order_id: number | null;
  delivery_company: string | null;
  delivery_option_name: string | null;
  tracking_number: string | null;
  dc_tracking_number: string | null;
  tracking_url: string | null;
  branded_tracking_url: string | null;
  print_awb_url: string | null;
  status: string;
  dc_status: string | null;
  price: number | null;
  cod_amount: number | null;
  driver_name: string | null;
  driver_phone: string | null;
  created_at: string;
  error_message: string | null;
};

const statusMeta: Record<string, { label: string; cls: string }> = {
  pending: { label: "قيد الانتظار", cls: "bg-stone-100 text-stone-600" },
  processing: { label: "قيد المعالجة", cls: "bg-amber-50 text-amber-700" },
  in_transit: { label: "في الطريق", cls: "bg-blue-50 text-blue-700" },
  delivered: { label: "تم التوصيل", cls: "bg-emerald-50 text-emerald-700" },
  returned: { label: "مرتجع", cls: "bg-rose-50 text-rose-700" },
  cancelled: { label: "ملغي", cls: "bg-stone-100 text-stone-500" },
};

export function ShipmentsTable({ shipments }: { shipments: Shipment[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");

  const filtered = shipments.filter((s) => {
    const matchesStatus = !status || s.status === status;
    const q = query.trim().toLowerCase();
    const matchesQuery =
      !q ||
      String(s.tracking_number || "").toLowerCase().includes(q) ||
      String(s.delivery_company || "").toLowerCase().includes(q) ||
      String(s.delivery_option_name || "").toLowerCase().includes(q) ||
      String(s.oto_order_id || "").includes(q);
    return matchesStatus && matchesQuery;
  });

  const counts = shipments.reduce<Record<string, number>>((acc, s) => {
    acc[s.status] = (acc[s.status] || 0) + 1;
    return acc;
  }, {});

  const inputCls = "rounded-lg border border-stone-200 px-3 py-2 text-sm focus:border-gold focus:outline-none bg-white";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">الشحنات</h1>
        <p className="mt-1 text-sm text-stone-500">تتبع جميع الشحنات المنشأة عبر OTO وحالة كل شحنة لحظياً</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => setStatus("")}
          className={cn("rounded-full px-3 py-1.5 text-xs font-bold transition", !status ? "bg-gold text-white" : "bg-white text-stone-600 border border-stone-200")}>
          الكل ({shipments.length})
        </button>
        {Object.entries(statusMeta).map(([key, m]) => (
          <button key={key} onClick={() => setStatus(key)}
            className={cn("rounded-full px-3 py-1.5 text-xs font-bold transition", status === key ? "bg-gold text-white" : "bg-white text-stone-600 border border-stone-200")}>
            {m.label} ({counts[key] || 0})
          </button>
        ))}
      </div>

      <div className="relative">
        <Search className="absolute right-3 top-2.5 w-4 h-4 text-stone-400" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث برقم التتبع أو الشركة..." className={inputCls + " w-full pr-9"} />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-amber-100 bg-white p-12 text-center text-stone-400">
          <PackageSearch className="w-10 h-10 mx-auto mb-3 text-gold/40" />
          لا توجد شحنات مطابقة
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-amber-100 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-amber-50 text-right text-xs text-stone-500">
                <th className="px-4 py-3 font-semibold">رقم التتبع</th>
                <th className="px-4 py-3 font-semibold">الشركة</th>
                <th className="px-4 py-3 font-semibold">الحالة</th>
                <th className="px-4 py-3 font-semibold hidden md:table-cell">السعر</th>
                <th className="px-4 py-3 font-semibold hidden md:table-cell">COD</th>
                <th className="px-4 py-3 font-semibold hidden lg:table-cell">السائق</th>
                <th className="px-4 py-3 font-semibold hidden md:table-cell">التاريخ</th>
                <th className="px-4 py-3 font-semibold">التتبع</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const meta = statusMeta[s.status] || { label: s.status, cls: "bg-stone-100 text-stone-600" };
                return (
                  <tr key={s.id} className="border-b border-amber-50/50 last:border-0 hover:bg-amber-50/30">
                    <td className="px-4 py-3 font-bold text-stone-800" dir="ltr">{s.tracking_number || s.dc_tracking_number || "—"}</td>
                    <td className="px-4 py-3">{s.delivery_option_name || s.delivery_company || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={cn("rounded-full px-2.5 py-1 text-xs font-bold", meta.cls)}>{meta.label}</span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">{s.price != null ? `${s.price} ${s.price ? "ر.س" : ""}` : "—"}</td>
                    <td className="px-4 py-3 hidden md:table-cell">{s.cod_amount ? `${s.cod_amount} ر.س` : "—"}</td>
                    <td className="px-4 py-3 hidden lg:table-cell">{s.driver_name ? `${s.driver_name} ${s.driver_phone || ""}` : "—"}</td>
                    <td className="px-4 py-3 text-xs text-stone-500 hidden md:table-cell">{new Date(s.created_at).toLocaleDateString("ar-SA")}</td>
                    <td className="px-4 py-3">
                      {(s.branded_tracking_url || s.tracking_url) && (
                        <a href={s.branded_tracking_url || s.tracking_url || "#"} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-bold text-gold-dark hover:bg-amber-100">
                          تتبع <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

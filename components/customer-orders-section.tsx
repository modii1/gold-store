"use client";

import { useState } from "react";
import Link from "next/link";
import { Package, ExternalLink } from "lucide-react";
import { Currency } from "@/components/storefront/currency";
import { formatDate, pluralizeArabic } from "@/lib/format";
import type { Order } from "@/types";
import { CustomerOrderDrawer } from "./customer-order-drawer";

type Shipment = {
  id: string;
  order_id: string;
  status: string;
  delivery_company: string | null;
  delivery_option_name: string | null;
  tracking_url: string | null;
  branded_tracking_url: string | null;
  driver_name: string | null;
};

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "قيد المراجعة", cls: "bg-amber-50 text-amber-700" },
  confirmed: { label: "مؤكد", cls: "bg-sky-50 text-sky-700" },
  processing: { label: "قيد التجهيز", cls: "bg-indigo-50 text-indigo-700" },
  shipped: { label: "جاري الشحن", cls: "bg-blue-50 text-blue-700" },
  picked_up: { label: "تم استلام الشحنة", cls: "bg-violet-50 text-violet-700" },
  in_transit: { label: "في الطريق", cls: "bg-blue-50 text-blue-700" },
  out_for_delivery: { label: "خرج للتوصيل", cls: "bg-cyan-50 text-cyan-700" },
  delivered: { label: "تم التسليم", cls: "bg-teal-50 text-teal-700" },
  paid: { label: "مدفوع", cls: "bg-emerald-50 text-emerald-700" },
  cancelled: { label: "ملغي", cls: "bg-red-50 text-red-600" },
  returned: { label: "مرتجع", cls: "bg-rose-50 text-rose-600" },
};

const SHIPMENT_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "قيد الانتظار", cls: "bg-stone-100 text-stone-600" },
  processing: { label: "قيد المعالجة", cls: "bg-amber-50 text-amber-700" },
  awaiting_delivery: { label: "بانتظار التسليم", cls: "bg-cyan-50 text-cyan-700" },
  in_transit: { label: "في الطريق", cls: "bg-blue-50 text-blue-700" },
  on_hold: { label: "معلقة بالمستودع", cls: "bg-violet-50 text-violet-700" },
  delivered: { label: "تم التسليم", cls: "bg-teal-50 text-teal-700" },
  returned: { label: "مرتجع", cls: "bg-rose-50 text-rose-600" },
  cancelled: { label: "ملغي", cls: "bg-stone-100 text-stone-500" },
  failed: { label: "فشل الشحن", cls: "bg-rose-50 text-rose-700" },
};

type Props = {
  orders: Order[];
  shipmentMap: Map<string, Shipment>;
};

export function CustomerOrdersSection({ orders, shipmentMap }: Props) {
  const [drawerOrderId, setDrawerOrderId] = useState<string | null>(null);

  if (orders.length === 0) {
    return (
      <div className="mt-4 rounded-3xl border border-sand bg-white p-12 text-center">
        <Package className="mx-auto mb-3 h-10 w-10 text-gold/40" />
        <p className="text-stone-500">لا توجد طلبات بعد</p>
        <Link href="/shop" className="mt-4 inline-block rounded-full bg-ink px-8 py-3 text-sm font-bold text-ivory hover:bg-gold transition">
          ابدئي التسوق
        </Link>
      </div>
    );
  }

  return (
    <>
      {/* Mobile cards */}
      <div className="mt-4 space-y-4 lg:hidden">
        {orders.map((o) => {
          const st = STATUS[o.status] || STATUS.pending;
          const shipment = shipmentMap.get(o.id);
          const sst = shipment
            ? SHIPMENT_STATUS[shipment.status] || { label: shipment.status, cls: "bg-stone-100 text-stone-600" }
            : null;
          const trackUrl = shipment?.tracking_url || shipment?.branded_tracking_url || o.tracking_url;
          return (
            <article key={o.id} className="rounded-3xl border border-sand bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-bold text-ink">طلب #{o.order_number}</p>
                  <p className="mt-0.5 text-xs text-stone-400 text-right" dir="ltr">{formatDate(o.created_at)}</p>
                </div>
                <div className="flex items-center gap-2">
                  {shipment ? (
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${sst!.cls}`}>{sst!.label}</span>
                  ) : (
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${st.cls}`}>{st.label}</span>
                  )}
                  {trackUrl && <a href={trackUrl} target="_blank" rel="noreferrer" className="rounded-full bg-ink px-3 py-1 text-[11px] font-bold text-ivory hover:bg-gold/80 transition">تتبع</a>}
                </div>
              </div>
              {shipment && shipment.delivery_company && (
                <p className="mt-2 text-xs text-stone-400">الشحن: {shipment.delivery_option_name || shipment.delivery_company}</p>
              )}
              <div className="mt-4 space-y-2 border-t border-sand pt-4">
                {(o.items || []).map((item, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="text-stone-700">{item.name} × {item.qty}</span>
                    <Currency value={item.price * item.qty} className="text-stone-500" />
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-sand pt-4">
                <span className="text-sm text-stone-500">
                  {o.payment_method} {o.shipping_cost > 0 && <><span> · شحن </span><Currency value={o.shipping_cost} /></>}
                  {o.discount > 0 && <><span> · خصم </span><Currency value={o.discount} /></>}
                </span>
                <Currency value={o.total} className="font-bold text-gold-dark" />
              </div>
              <button
                onClick={() => setDrawerOrderId(o.id)}
                className="mt-3 w-full rounded-xl border border-gold/30 bg-cream py-2.5 text-xs font-bold text-gold hover:bg-gold/10 transition"
              >
                تفاصيل الطلب
              </button>
            </article>
          );
        })}
      </div>

      {/* Desktop table */}
      <div className="mt-4 hidden lg:block rounded-3xl border border-sand bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="bg-cream border-b border-sand text-right text-xs text-stone-500">
                <th className="px-5 py-3.5 font-bold">الطلب</th>
                <th className="px-5 py-3.5 font-bold">المنتجات</th>
                <th className="px-5 py-3.5 font-bold">التاريخ</th>
                <th className="px-5 py-3.5 font-bold">الدفع</th>
                <th className="px-5 py-3.5 font-bold">الإجمالي</th>
                <th className="px-5 py-3.5 font-bold">الحالة</th>
                <th className="px-5 py-3.5 font-bold"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sand/60">
              {orders.map((o) => {
                const st = STATUS[o.status] || STATUS.pending;
                const shipment = shipmentMap.get(o.id);
                const sst = shipment ? SHIPMENT_STATUS[shipment.status] || { label: shipment.status, cls: "bg-stone-100 text-stone-600" } : null;
                const trackUrl = shipment?.tracking_url || shipment?.branded_tracking_url || o.tracking_url;
                return (
                  <tr key={o.id} className="hover:bg-cream/60 transition">
                    <td className="px-5 py-4 align-top">
                      <p className="font-bold text-ink">#{o.order_number}</p>
                    </td>
                    <td className="px-5 py-4 align-top">
                      <div className="max-w-[260px] space-y-0.5">
                        {(o.items || []).slice(0, 3).map((item, i) => (
                          <p key={i} className="truncate text-xs text-stone-500">{item.name} × {item.qty}</p>
                        ))}
                        {(o.items || []).length > 3 && <p className="text-xs text-stone-400">+{(o.items || []).length - 3} {pluralizeArabic((o.items || []).length - 3, "منتج", "منتجين", "منتجات")}</p>}
                      </div>
                    </td>
                    <td className="px-5 py-4 align-top">
                      <p className="whitespace-nowrap text-xs text-stone-500 text-right" dir="ltr">{formatDate(o.created_at)}</p>
                    </td>
                    <td className="px-5 py-4 align-top">
                      <p className="text-xs text-stone-600">{o.payment_method || "—"}</p>
                      {o.shipping_cost > 0 && <p className="mt-0.5 text-[11px] text-stone-400">شحن: <Currency value={o.shipping_cost} /></p>}
                      {o.discount > 0 && <p className="text-[11px] text-emerald-600">خصم: -<Currency value={o.discount} /></p>}
                    </td>
                    <td className="px-5 py-4 align-top">
                      <Currency value={o.total} className="whitespace-nowrap text-base font-bold text-gold-dark" />
                    </td>
                    <td className="px-5 py-4 align-top">
                      <div className="flex flex-wrap items-center gap-2">
                        {shipment ? (
                          <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold ${sst!.cls}`}>{sst!.label}</span>
                        ) : (
                          <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold ${st.cls}`}>{st.label}</span>
                        )}
                        {trackUrl && (
                          <a href={trackUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full bg-ink px-3 py-1 text-[11px] font-bold text-ivory hover:bg-gold/80 transition whitespace-nowrap">
                            تتبع <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                      {shipment?.delivery_company && (
                        <p className="mt-1 text-[11px] text-stone-400">{shipment.delivery_option_name || shipment.delivery_company}</p>
                      )}
                    </td>
                    <td className="px-5 py-4 align-top">
                      <button
                        onClick={() => setDrawerOrderId(o.id)}
                        className="flex items-center gap-1.5 rounded-full border border-gold/30 bg-cream px-4 py-2 text-xs font-bold text-gold hover:bg-gold/10 transition whitespace-nowrap"
                      >
                        تفاصيل الطلب <ExternalLink className="h-3 w-3" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Drawer */}
      <CustomerOrderDrawer
        orderId={drawerOrderId}
        onClose={() => setDrawerOrderId(null)}
        onOrderCancelled={() => {
          window.location.reload();
        }}
      />
    </>
  );
}

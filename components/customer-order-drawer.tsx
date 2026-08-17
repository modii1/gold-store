"use client";

import { useEffect, useState } from "react";
import {
  X, Phone, MapPin, CreditCard, Truck, Box, Banknote, ExternalLink,
  Loader2, PackageCheck, Clock, Ban,
} from "lucide-react";
import { Currency } from "@/components/storefront/currency";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Order, OrderStatusLog } from "@/types";
import {
  ORDER_STATUS_META, shipmentCompanyName,
} from "@/lib/orders/order-meta";
import { getCustomerOrderDetailsAction, cancelOrderAction } from "@/app/actions/orders";

type Shipment = Record<string, unknown>;

const SHIPMENT_STATUS: Record<string, { label: string; cls: string }> = {
  not_created: { label: "لم تُنشأ الشحنة", cls: "bg-stone-100 text-stone-500" },
  created: { label: "تم إنشاء الشحنة", cls: "bg-sky-50 text-sky-700" },
  picked_up: { label: "تم استلام الشحنة", cls: "bg-indigo-50 text-indigo-700" },
  in_transit: { label: "في الطريق", cls: "bg-blue-50 text-blue-700" },
  awaiting_delivery: { label: "بانتظار التسليم", cls: "bg-cyan-50 text-cyan-700" },
  on_hold: { label: "معلقة بالمستودع", cls: "bg-violet-50 text-violet-700" },
  out_for_delivery: { label: "خرج للتوصيل", cls: "bg-violet-50 text-violet-700" },
  delivered: { label: "تم التسليم", cls: "bg-teal-50 text-teal-700" },
  failed: { label: "فشل التسليم", cls: "bg-rose-50 text-rose-700" },
  returned: { label: "مرتجع", cls: "bg-rose-50 text-rose-600" },
  cancelled: { label: "ملغي", cls: "bg-stone-100 text-stone-500" },
  processing: { label: "قيد المعالجة", cls: "bg-amber-50 text-amber-700" },
};

function Section({ title, icon: Icon, children }: { title: string; icon: typeof Box; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-sand bg-white p-4">
      <h3 className="mb-3 flex items-center gap-2 font-bold text-stone-900">
        <Icon className="h-4 w-4 text-gold" /> {title}
      </h3>
      {children}
    </section>
  );
}

function Badge({ label, cls }: { label: string; cls: string }) {
  return <span className={cn("whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold", cls)}>{label}</span>;
}

type Props = {
  orderId: string | null;
  onClose: () => void;
  onOrderCancelled: () => void;
};

export function CustomerOrderDrawer({ orderId, onClose, onOrderCancelled }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [statusLog, setStatusLog] = useState<OrderStatusLog[]>([]);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (!orderId) return;
    setLoading(true);
    setError(null);
    setOrder(null);
    getCustomerOrderDetailsAction(orderId).then((res) => {
      if (res.error) {
        setError(res.error);
      } else {
        setOrder(res.order || null);
        setShipments(res.shipments || []);
        setStatusLog(res.statusLog || []);
      }
      setLoading(false);
    }).catch(() => {
      setError("حدث خطأ في تحميل التفاصيل");
      setLoading(false);
    });
  }, [orderId]);

  const handleCancel = async () => {
    if (!order) return;
    setCancelling(true);
    const res = await cancelOrderAction(order.id);
    setCancelling(false);
    if (res.error) {
      alert(res.error);
      return;
    }
    setOrder({ ...order, status: "cancelled" });
    onOrderCancelled();
  };

  if (!orderId) return null;

  const open = Boolean(orderId);
  const subtotal = order ? order.total - order.shipping_cost + order.discount : 0;

  return (
    <div className={cn("fixed inset-0 z-[95] transition-opacity", open ? "opacity-100" : "pointer-events-none opacity-0")}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`تفاصيل الطلب #${order?.order_number || ""}`}
        className="absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col bg-stone-50 shadow-2xl transition-transform"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-sand bg-white px-5 py-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-lg font-extrabold text-ink">طلب #{order?.order_number || "…"}</p>
              {order && <Badge {...(ORDER_STATUS_META[order.status] || ORDER_STATUS_META.pending)} />}
            </div>
            <p className="text-xs text-stone-400" dir="ltr">{order ? formatDate(order.created_at) : ""}</p>
          </div>
          <button onClick={onClose} aria-label="إغلاق"
            className="rounded-lg border border-sand p-2 text-stone-500 hover:bg-stone-100 transition">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="animate-pulse rounded-2xl border border-sand bg-white p-4">
                  <div className="h-4 w-1/3 rounded bg-stone-100" />
                  <div className="mt-3 h-8 rounded bg-stone-100" />
                  <div className="mt-2 h-8 rounded bg-stone-100" />
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-600">{error}</div>
          ) : order ? (
            <div className="space-y-4">
              {/* Products */}
              <Section title="المنتجات" icon={PackageCheck}>
                <div className="divide-y divide-sand/60">
                  {(order.items || []).map((item, i) => (
                    <div key={i} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                      {item.image && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.image} alt={item.name} className="h-12 w-12 rounded-xl border border-stone-100 object-cover" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-stone-900">{item.name}</p>
                        <p className="text-xs text-stone-400">الكمية: {item.qty}</p>
                      </div>
                      <Currency value={item.price * item.qty} className="text-sm font-bold text-stone-900" />
                    </div>
                  ))}
                </div>
                <div className="mt-3 space-y-1.5 border-t border-sand pt-3 text-sm">
                  <div className="flex justify-between text-stone-500"><span>المجموع الفرعي</span><Currency value={subtotal} /></div>
                  <div className="flex justify-between text-stone-500"><span>الشحن</span><Currency value={order.shipping_cost} /></div>
                  {order.discount > 0 && (
                    <div className="flex justify-between text-emerald-600">
                      <span>الخصم {order.coupon_code && `(${order.coupon_code})`}</span>
                      <span>- <Currency value={order.discount} /></span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-sand pt-2 text-base font-bold">
                    <span className="text-stone-900">الإجمالي</span>
                    <Currency value={order.total} className="text-gold-dark" />
                  </div>
                </div>
              </Section>

              {/* Payment */}
              <Section title="الدفع" icon={Banknote}>
                <div className="space-y-2 text-sm">
                  <p className="flex items-center gap-1.5 text-stone-700">
                    <CreditCard className="h-3.5 w-3.5 text-stone-400" /> {order.payment_method || "غير محدد"}
                  </p>
                  {order.payment_method?.includes("تحويل") && order.transfer_receipt_url && (
                    <a href={order.transfer_receipt_url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 hover:underline">
                      <ExternalLink className="h-3.5 w-3.5" /> عرض إيصال التحويل
                    </a>
                  )}
                  {order.payment_method?.includes("تحويل") && order.transfer_receipt_url && (order.status === "pending" || order.status === "confirmed") && (
                    <p className="text-xs text-amber-600">بانتظار اعتماد التحويل من الإدارة</p>
                  )}
                </div>
              </Section>

              {/* Shipping */}
              <Section title="الشحن" icon={Truck}>
                <div className="space-y-2 text-sm">
                  <p className="text-stone-700">{order.shipping_method || "لم يتم تحديد شركة شحن"}</p>
                  {order.tracking_number && (
                    <p className="text-xs">
                      <span className="text-stone-500">رقم التتبع:</span>{" "}
                      {order.tracking_url ? (
                        <a href={order.tracking_url} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-bold text-gold hover:underline">
                          اضغط هنا <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="font-bold text-stone-700" dir="ltr">{order.tracking_number}</span>
                      )}
                    </p>
                  )}
                  {shipments.map((s: any) => {
                    const sst = SHIPMENT_STATUS[s.status] || { label: s.status, cls: "bg-stone-100 text-stone-600" };
                    const trackUrl = s.tracking_url || s.branded_tracking_url;
                    return (
                      <div key={s.id} className="rounded-xl bg-stone-50 p-2.5 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-bold text-stone-700">{shipmentCompanyName(s, order)}</p>
                          <Badge {...sst} />
                        </div>
                        {(s.tracking_number || s.dc_tracking_number) && (
                          <p className="mt-1 text-stone-500">
                            رقم الشحنة: <span dir="ltr">{s.tracking_number || s.dc_tracking_number}</span>
                          </p>
                        )}
                        {trackUrl && (
                          <a href={trackUrl} target="_blank" rel="noopener noreferrer"
                            className="mt-1 inline-flex items-center gap-1 font-bold text-gold hover:underline">
                            تتبع الشحنة <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                        {s.driver_name && <p className="mt-1 text-stone-400">السائق: {s.driver_name}</p>}
                      </div>
                    );
                  })}
                </div>
              </Section>

              {/* Delivery Address */}
              <Section title="عنوان التوصيل" icon={MapPin}>
                <div className="text-sm text-stone-600 space-y-1">
                  <p className="font-bold text-stone-800">{order.customer_name}</p>
                  <p>{order.customer_city}{order.region ? `، ${order.region}` : ""}</p>
                  {order.address && <p className="text-stone-500">{order.address}</p>}
                  {order.national_address && <p className="text-xs text-stone-400">العنوان الوطني: {order.national_address}</p>}
                  {order.maps_url && (
                    <a href={order.maps_url} target="_blank" rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-gold hover:underline">
                      فتح الموقع <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </Section>

              {/* Timeline */}
              <Section title="سجل الحالات" icon={Clock}>
                {statusLog.length === 0 ? (
                  <p className="text-sm text-stone-400">لا يوجد سجل بعد</p>
                ) : (
                  <ol className="relative space-y-4 pr-5">
                    <span className="absolute right-[7px] top-1 bottom-1 w-0.5 bg-sand" />
                    {statusLog.map((log) => {
                      const cfg = ORDER_STATUS_META[log.new_status as keyof typeof ORDER_STATUS_META] || ORDER_STATUS_META.pending;
                      return (
                        <li key={log.id} className="relative">
                          <span className={cn(
                            "absolute right-[-17px] top-1 h-3.5 w-3.5 rounded-full border-2 border-white",
                            cfg.cls.includes("red") || cfg.cls.includes("rose") ? "bg-red-500" : "bg-gold"
                          )} />
                          <Badge {...cfg} />
                          {log.old_status && (
                            <span className="mr-2 text-xs text-stone-400">
                              من {ORDER_STATUS_META[log.old_status as keyof typeof ORDER_STATUS_META]?.label || log.old_status}
                            </span>
                          )}
                          <p className="mt-1 text-xs text-stone-400" dir="ltr">{formatDate(log.created_at)}</p>
                          {log.note && <p className="mt-0.5 text-sm text-stone-600">{log.note}</p>}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </Section>
            </div>
          ) : null}
        </div>

        {/* Footer — Cancel button */}
        {order && order.status === "pending" && (
          <div className="flex items-center gap-2 border-t border-sand bg-white px-5 py-3">
            <button
              onClick={handleCancel}
              disabled={cancelling}
              className="flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-bold text-red-600 hover:bg-red-100 transition disabled:opacity-50"
            >
              {cancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
              إلغاء الطلب
            </button>
            <p className="text-xs text-stone-400">يمكنك إلغاء الطلب فقط قبل الشحن</p>
          </div>
        )}
      </div>
    </div>
  );
}

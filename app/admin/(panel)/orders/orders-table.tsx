"use client";

import { useState } from "react";
import { Trash2, ExternalLink, Loader2, CheckCircle2, Truck, PackageCheck, Banknote, Clock } from "lucide-react";
import { updateOrderStatusAction, deleteOrderAction, createShipmentAction } from "@/app/actions/orders-admin";
import { formatCurrency } from "@/lib/format";
import { Currency } from "@/components/storefront/currency";
import type { Order, Carrier } from "@/types";

const statusConfig: Record<Order["status"], { label: string; cls: string }> = {
  pending: { label: "قيد المراجعة", cls: "bg-amber-50 text-amber-700" },
  confirmed: { label: "مؤكد", cls: "bg-sky-50 text-sky-700" },
  processing: { label: "قيد التجهيز", cls: "bg-indigo-50 text-indigo-700" },
  shipped: { label: "تم الشحن", cls: "bg-emerald-50 text-emerald-700" },
  delivered: { label: "تم التسليم", cls: "bg-teal-50 text-teal-700" },
  paid: { label: "مدفوع", cls: "bg-emerald-50 text-emerald-700" },
  cancelled: { label: "ملغي", cls: "bg-red-50 text-red-600" },
  returned: { label: "مرتجع", cls: "bg-rose-50 text-rose-600" },
};

export function OrdersTable({ orders, carriers }: { orders: Order[]; carriers: Carrier[] }) {
  const [shipping, setShipping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apiCarriers = carriers.filter((c) => c.mode === "api");
  const hasOtoOrders = orders.some((o) => o.delivery_option_id);
  const canShip = apiCarriers.length > 0 || hasOtoOrders;

  const isTransfer = (o: Order) => {
    const pm = (o.payment_method || "").toLowerCase();
    return pm.includes("تحويل") || pm.includes("بنكي") || pm.includes("transfer");
  };
  const isCod = (o: Order) => {
    const pm = (o.payment_method || "").toLowerCase();
    return pm.includes("عند الاستلام") || pm.includes("cod") || pm.includes("cash on delivery");
  };

  const advance = async (orderId: string, target: string) => {
    setBusy(orderId);
    setError(null);
    const fd = new FormData();
    fd.set("id", orderId);
    fd.set("status", target);
    const res = await updateOrderStatusAction(fd);
    setBusy(null);
    if (res.error) {
      setError(res.error);
      return;
    }
    window.location.reload();
  };

  const ship = async (orderId: string) => {
    setBusy(orderId);
    setError(null);
    const fd = new FormData();
    fd.set("id", orderId);
    const carrierId = shipping[orderId];
    if (carrierId) fd.set("carrier_id", carrierId);
    const res = await createShipmentAction(fd);
    setBusy(null);
    if (res.error) {
      setError(res.error);
      return;
    }
    window.location.reload();
  };

  type WorkflowAction =
    | { type: "advance"; label: string; target: string; icon: typeof CheckCircle2 }
    | { type: "ship"; label: string }
    | { type: "blocked"; text: string }
    | null;

  const workflow = (o: Order): WorkflowAction => {
    if (o.status === "pending") {
      if (isTransfer(o) && !o.transfer_receipt_url) {
        return { type: "blocked", text: "بانتظار إثبات التحويل" };
      }
      return { type: "advance", label: "تأكيد التحويل", target: "processing", icon: CheckCircle2 };
    }
    if (o.status === "confirmed") {
      return { type: "advance", label: "تأكيد التحويل", target: "processing", icon: CheckCircle2 };
    }
    if (o.status === "processing") return { type: "ship", label: "تم الشحن" };
    if (o.status === "shipped") return { type: "advance", label: "تم التسليم", target: "delivered", icon: PackageCheck };
    if (o.status === "delivered") return { type: "advance", label: "تأكيد الدفع", target: "paid", icon: Banknote };
    return null;
  };

  return (
    <div className="space-y-4">
      {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600">{error}</p>}
      {!canShip && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
          لا توجد شركات شحن في وضع API — أضف شركة (أرامكس/سمسا) مع بيانات الدخول من صفحة «الشحن» لتفعيل إنشاء الشحنات،
          أو فعّل OTO من صفحة «إعدادات OTO».
        </p>
      )}
      {orders.length === 0 ? (
        <div className="rounded-2xl border border-amber-100 bg-white p-12 text-center text-stone-400">
          لا توجد طلبات بعد
        </div>
      ) : (
        orders.map((o) => {
          const st = statusConfig[o.status];
          return (
            <article key={o.id} className="rounded-2xl border border-amber-100 bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-stone-900">طلب #{o.order_number}</p>
                    <span className={`rounded-full px-3 py-0.5 text-xs font-semibold ${st.cls}`}>{st.label}</span>
                  </div>
                  <p className="mt-1 text-sm text-stone-600">{o.customer_name} — <span dir="ltr">{o.customer_phone}</span></p>
                  {o.customer_city && <p className="text-xs text-stone-400">{o.customer_city}</p>}
                  <p className="mt-1 text-xs text-stone-400">{new Date(o.created_at).toLocaleString("ar-SA")}</p>
                  {o.shipping_method && <p className="mt-0.5 text-xs text-stone-400">الشحن: {o.shipping_method}</p>}
                  {o.tracking_number && (
                    <p className="mt-1 text-xs font-semibold text-blue-600">
                      {o.tracking_url ? (
                        <a href={o.tracking_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">
                          <ExternalLink className="w-3 h-3" /> تتبع: {o.tracking_number}
                        </a>
                      ) : (
                        `رقم التتبع: ${o.tracking_number}`
                      )}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Currency value={o.total} className="text-xl font-bold text-gold" />
                  <form action={updateOrderStatus}>
                    <input type="hidden" name="id" value={o.id} />
                    <select
                      name="status"
                      defaultValue={o.status}
                      onChange={(e) => e.target.form?.requestSubmit()}
                      className="rounded-xl border border-stone-200 px-3 py-1.5 text-sm font-semibold focus:border-gold focus:outline-none"
                    >
                      <option value="pending">قيد المراجعة</option>
                      <option value="confirmed">مؤكد</option>
                      <option value="processing">قيد التجهيز</option>
                      <option value="shipped">تم الشحن</option>
                      <option value="delivered">تم التسليم</option>
                      <option value="paid">مدفوع</option>
                      <option value="cancelled">ملغي</option>
                      <option value="returned">مرتجع</option>
                    </select>
                  </form>
                </div>
              </div>

              <div className="mt-4 rounded-xl bg-stone-50 p-3 space-y-1">
                {(o.items || []).map((item, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="text-stone-700">{item.name} × {item.qty}</span>
                    <Currency value={item.price * item.qty} className="text-stone-500" />
                  </div>
                ))}
              </div>

              {o.notes && (
                <p className="mt-3 text-sm text-stone-500 bg-amber-50 border border-amber-100 rounded-lg p-2">
                  ملاحظات: {o.notes}
                </p>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {o.transfer_receipt_url ? (
                  <a href={o.transfer_receipt_url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 transition">
                    <ExternalLink className="w-3.5 h-3.5" /> إثبات التحويل
                  </a>
                ) : (
                  isTransfer(o) && o.status === "pending" && (
                    <span className="text-xs text-stone-400">لا يوجد إثبات تحويل</span>
                  )
                )}

                {o.status === "processing" && (
                  <span className="flex items-center gap-1.5 rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-600">
                    <Clock className="w-3.5 h-3.5" /> بانتظار تسليم الشحنة لشركة الشحن
                  </span>
                )}

                {workflow(o)?.type === "ship" && !canShip && (
                  <span className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                    فعّل OTO أو أضف شركة شحن لتفعيل إنشاء الشحنة
                  </span>
                )}

                {(() => {
                  const w = workflow(o);
                  if (!w || w.type === "blocked") return null;
                  if (w.type === "ship" && !canShip) return null;
                  return (
                    <button
                      onClick={() => {
                        if (w.type === "advance") advance(o.id, w.target);
                        else if (w.type === "ship") ship(o.id);
                      }}
                      disabled={busy === o.id}
                      className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 transition disabled:opacity-50 shadow-sm"
                    >
                      {busy === o.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : w.type === "advance" ? (
                        <w.icon className="w-3.5 h-3.5" />
                      ) : (
                        <Truck className="w-3.5 h-3.5" />
                      )}
                      {w.label}
                    </button>
                  );
                })()}

                {(() => {
                  const w = workflow(o);
                  if (!w || w.type !== "blocked") return null;
                  return (
                    <span className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                      <Clock className="w-3.5 h-3.5" /> {w.text} — رفع إيصال من العميل
                    </span>
                  );
                })()}

                {o.tracking_number && !o.tracking_url && (
                  <span className="text-xs font-bold text-blue-600">رقم التتبع: {o.tracking_number}</span>
                )}

                <form action={deleteOrder}>
                  <input type="hidden" name="id" value={o.id} />
                  <button type="submit"
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-stone-500 hover:bg-rose-50 hover:text-rose-600 transition"
                    onClick={(e) => { if (!confirm("متأكد من حذف الطلب؟")) e.preventDefault(); }}>
                    <Trash2 className="w-3.5 h-3.5" /> حذف
                  </button>
                </form>
              </div>
            </article>
          );
        })
      )}
    </div>
  );

  function updateOrderStatus(formData: FormData) {
    void updateOrderStatusAction(formData);
  }

  function deleteOrder(formData: FormData) {
    void deleteOrderAction(formData);
  }
}

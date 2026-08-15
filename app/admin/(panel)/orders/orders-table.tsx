"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Trash2, ExternalLink, Loader2, CheckCircle2, Truck, PackageCheck, Banknote, Clock, Eye, Tag } from "lucide-react";
import { updateOrderStatusAction, deleteOrderAction, createShipmentAction, searchOrdersAction } from "@/app/actions/orders-admin";
import { Currency } from "@/components/storefront/currency";
import { formatDate } from "@/lib/format";
import { OrderFilters } from "./order-filters";
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

const statusOptions = [
  { value: "pending", label: "قيد المراجعة" },
  { value: "confirmed", label: "مؤكد" },
  { value: "processing", label: "قيد التجهيز" },
  { value: "shipped", label: "تم الشحن" },
  { value: "delivered", label: "تم التسليم" },
  { value: "paid", label: "مدفوع" },
  { value: "cancelled", label: "ملغي" },
  { value: "returned", label: "مرتجع" },
];

export function OrdersTable({ orders: initialOrders, carriers }: { orders: Order[]; carriers: Carrier[] }) {
  const [orders, setOrders] = useState(initialOrders);
  const [shipping, setShipping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isSearch, setIsSearch] = useState(false);

  const apiCarriers = carriers.filter((c) => c.mode === "api");
  const hasOtoOrders = orders.some((o) => o.delivery_option_id);
  const canShip = apiCarriers.length > 0 || hasOtoOrders;

  const isTransfer = (o: Order) => {
    const pm = (o.payment_method || "").toLowerCase();
    return pm.includes("تحويل") || pm.includes("بنكي") || pm.includes("transfer");
  };

  const handleSearch = (query: string, status: string) => {
    setIsSearch(true);
    startTransition(async () => {
      const results = await searchOrdersAction(query, status);
      setOrders(results as Order[]);
      setIsSearch(false);
    });
  };

  const changeStatus = (orderId: string, status: string) => {
    const fd = new FormData();
    fd.set("id", orderId);
    fd.set("status", status);
    void updateOrderStatusAction(fd).then(() => window.location.reload());
  };

  const advance = async (orderId: string, target: string) => {
    setBusy(orderId);
    setError(null);
    const fd = new FormData();
    fd.set("id", orderId);
    fd.set("status", target);
    const res = await updateOrderStatusAction(fd);
    setBusy(null);
    if (res.error) { setError(res.error); return; }
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
    if (res.error) { setError(res.error); return; }
    window.location.reload();
  };

  type WorkflowAction =
    | { type: "advance"; label: string; target: string; icon: typeof CheckCircle2 }
    | { type: "ship"; label: string }
    | { type: "blocked"; text: string }
    | null;

  const workflow = (o: Order): WorkflowAction => {
    if (o.status === "pending") {
      if (isTransfer(o) && !o.transfer_receipt_url) return { type: "blocked", text: "بانتظار إثبات التحويل" };
      return { type: "advance", label: "تأكيد التحويل", target: "processing", icon: CheckCircle2 };
    }
    if (o.status === "confirmed") return { type: "advance", label: "تأكيد التحويل", target: "processing", icon: CheckCircle2 };
    if (o.status === "processing") return { type: "ship", label: "تم الشحن" };
    if (o.status === "shipped") return { type: "advance", label: "تم التسليم", target: "delivered", icon: PackageCheck };
    if (o.status === "delivered") return { type: "advance", label: "تأكيد الدفع", target: "paid", icon: Banknote };
    return null;
  };

  const renderStatusBadge = (o: Order) => {
    const st = statusConfig[o.status];
    return <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${st.cls}`}>{st.label}</span>;
  };

  return (
    <div className="space-y-4">
      <OrderFilters onSearch={handleSearch} isPending={isPending || isSearch} />

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
        <>
          <p className="text-sm text-stone-500">{orders.length} طلب</p>

          {/* ============ Mobile cards ============ */}
          <div className="md:hidden space-y-4">
            {orders.map((o) => {
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
                      <p className="mt-1 text-xs text-stone-400 text-right" dir="ltr">{formatDate(o.created_at)}</p>
                      {o.coupon_code && (
                        <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-gold/10 px-2 py-0.5 text-xs font-bold text-gold-dark">
                          <Tag className="w-3 h-3" /> كود الخصم: {o.coupon_code} {o.discount > 0 && <span>(-{o.discount})</span>}
                        </p>
                      )}
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
                    <div className="flex flex-col items-start gap-2">
                      <Currency value={o.total} className="text-xl font-bold text-gold" />
                      <select
                        defaultValue={o.status}
                        onChange={(e) => changeStatus(o.id, e.target.value)}
                        className="rounded-xl border border-stone-200 px-3 py-1.5 text-sm font-semibold focus:border-gold focus:outline-none"
                      >
                        {statusOptions.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
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
                    <Link href={`/admin/orders/${o.id}`}
                      className="flex items-center gap-1.5 rounded-lg bg-stone-100 px-3 py-1.5 text-xs font-bold text-stone-700 hover:bg-stone-200 transition">
                      <Eye className="w-3.5 h-3.5" /> تفاصيل
                    </Link>

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
                        <button onClick={() => { if (w.type === "advance") advance(o.id, w.target); else if (w.type === "ship") ship(o.id); }}
                          disabled={busy === o.id}
                          className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 transition disabled:opacity-50 shadow-sm">
                          {busy === o.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : w.type === "advance" ? <w.icon className="w-3.5 h-3.5" /> : <Truck className="w-3.5 h-3.5" />}
                          {w.label}
                        </button>
                      );
                    })()}

                    {(() => {
                      const w = workflow(o);
                      if (!w || w.type !== "blocked") return null;
                      return (
                        <span className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                          <Clock className="w-3.5 h-3.5" /> {w.text}
                        </span>
                      );
                    })()}

                    <form action={async (fd) => { await deleteOrderAction(fd); window.location.reload(); }}>
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
            })}
          </div>

          {/* ============ Desktop table ============ */}
          <div className="hidden md:block rounded-2xl border border-amber-100 bg-white overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead>
                  <tr className="bg-stone-50 border-b border-stone-100 text-right text-xs text-stone-500">
                    <th className="px-5 py-3.5 font-bold">الطلب</th>
                    <th className="px-5 py-3.5 font-bold">العميل</th>
                    <th className="px-5 py-3.5 font-bold">التاريخ</th>
                    <th className="px-5 py-3.5 font-bold">الدفع والشحن</th>
                    <th className="px-5 py-3.5 font-bold">الإجمالي</th>
                    <th className="px-5 py-3.5 font-bold">الحالة</th>
                    <th className="px-5 py-3.5 font-bold">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {orders.map((o) => {
                    const w = workflow(o);
                    const canDoShip = w?.type === "ship" && canShip;
                    return (
                      <tr key={o.id} className="hover:bg-stone-50/70 transition">
                        {/* Order */}
                        <td className="px-5 py-4 align-top">
                          <Link href={`/admin/orders/${o.id}`} className="font-bold text-stone-900 hover:text-gold transition">
                            #{o.order_number}
                          </Link>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            {renderStatusBadge(o)}
                            {o.coupon_code && (
                              <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-gold/10 px-2 py-0.5 text-[11px] font-bold text-gold-dark">
                                <Tag className="w-3 h-3" /> {o.coupon_code}
                              </span>
                            )}
                          </div>
                          <div className="mt-2 max-w-[240px] space-y-0.5">
                            {(o.items || []).slice(0, 2).map((item, i) => (
                              <p key={i} className="truncate text-xs text-stone-500">{item.name} × {item.qty}</p>
                            ))}
                            {(o.items || []).length > 2 && (
                              <p className="text-xs text-stone-400">+{(o.items || []).length - 2} منتجات أخرى</p>
                            )}
                          </div>
                        </td>
                        {/* Customer */}
                        <td className="px-5 py-4 align-top">
                          <p className="font-semibold text-stone-800">{o.customer_name}</p>
                          <p className="mt-0.5 text-xs text-stone-500 text-right" dir="ltr">{o.customer_phone}</p>
                          {o.customer_city && <p className="mt-0.5 text-xs text-stone-400">{o.customer_city}</p>}
                          {o.email && <p className="mt-0.5 max-w-[180px] truncate text-xs text-stone-400" dir="ltr">{o.email}</p>}
                        </td>
                        {/* Date */}
                        <td className="px-5 py-4 align-top">
                          <p className="whitespace-nowrap text-xs text-stone-600 text-right" dir="ltr">{formatDate(o.created_at)}</p>
                        </td>
                        {/* Payment & shipping */}
                        <td className="px-5 py-4 align-top">
                          <p className="text-xs text-stone-700">{o.payment_method || "—"}</p>
                          {isTransfer(o) && o.transfer_receipt_url ? (
                            <a href={o.transfer_receipt_url} target="_blank" rel="noopener noreferrer"
                              className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 hover:underline">
                              <ExternalLink className="w-3 h-3" /> إثبات التحويل
                            </a>
                          ) : isTransfer(o) && o.status === "pending" ? (
                            <p className="mt-0.5 text-[11px] font-semibold text-amber-600">بانتظار إثبات التحويل</p>
                          ) : null}
                          {o.shipping_method && (
                            <p className="mt-1 text-[11px] text-stone-400">{o.shipping_method}</p>
                          )}
                          {o.tracking_number && (
                            <p className="mt-0.5 text-[11px] font-semibold text-blue-600">
                              {o.tracking_url ? (
                                <a href={o.tracking_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">
                                  تتبع: {o.tracking_number}
                                </a>
                              ) : (
                                `تتبع: ${o.tracking_number}`
                              )}
                            </p>
                          )}
                        </td>
                        {/* Total */}
                        <td className="px-5 py-4 align-top">
                          <Currency value={o.total} className="whitespace-nowrap text-base font-bold text-gold" />
                        </td>
                        {/* Status */}
                        <td className="px-5 py-4 align-top">
                          <select
                            value={o.status}
                            onChange={(e) => changeStatus(o.id, e.target.value)}
                            className="rounded-lg border border-stone-200 px-2 py-1.5 text-xs font-semibold bg-white focus:border-gold focus:outline-none"
                          >
                            {statusOptions.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                          </select>
                        </td>
                        {/* Actions */}
                        <td className="px-5 py-4 align-top">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Link href={`/admin/orders/${o.id}`}
                              className="flex items-center gap-1 rounded-lg border border-stone-200 px-2.5 py-1.5 text-xs font-bold text-stone-700 hover:bg-stone-100 transition">
                              <Eye className="w-3.5 h-3.5" /> تفاصيل
                            </Link>
                            {w && w.type === "blocked" && (
                              <span className="flex items-center gap-1 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-bold text-amber-700" title={w.text}>
                                <Clock className="w-3.5 h-3.5" /> {w.text}
                              </span>
                            )}
                            {w && w.type === "ship" && !canShip && (
                              <span className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-bold text-amber-700" title="فعّل OTO أو أضف شركة شحن">
                                لا توجد شحنة
                              </span>
                            )}
                            {w && w.type === "advance" && (
                              <button onClick={() => advance(o.id, w.target)} disabled={busy === o.id}
                                className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 transition disabled:opacity-50 shadow-sm">
                                {busy === o.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <w.icon className="w-3.5 h-3.5" />}
                                {w.label}
                              </button>
                            )}
                            {w && w.type === "ship" && canDoShip && (
                              <button onClick={() => ship(o.id)} disabled={busy === o.id}
                                className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 transition disabled:opacity-50 shadow-sm">
                                {busy === o.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Truck className="w-3.5 h-3.5" />}
                                {w.label}
                              </button>
                            )}
                            <form action={async (fd) => { await deleteOrderAction(fd); window.location.reload(); }}>
                              <input type="hidden" name="id" value={o.id} />
                              <button type="submit"
                                className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold text-stone-500 hover:bg-rose-50 hover:text-rose-600 transition"
                                onClick={(e) => { if (!confirm("متأكد من حذف الطلب؟")) e.preventDefault(); }}>
                                <Trash2 className="w-3.5 h-3.5" /> حذف
                              </button>
                            </form>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

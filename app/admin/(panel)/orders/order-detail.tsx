"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight, Truck, PackageCheck, Banknote, CheckCircle2, Clock, XCircle,
  ExternalLink, Loader2, StickyNote, Trash2, Printer, MapPin, Phone, Mail,
  CreditCard, Calendar, Hash, Box, MessageSquare
} from "lucide-react";
import { updateOrderStatusAction, createShipmentAction, addOrderNoteAction, deleteOrderNoteAction } from "@/app/actions/orders-admin";
import { Currency } from "@/components/storefront/currency";
import { formatDate } from "@/lib/format";
import type { Order, OrderStatusLog, OrderNote } from "@/types";

const statusConfig: Record<string, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  pending: { label: "قيد المراجعة", cls: "bg-amber-50 text-amber-700 border border-amber-200", icon: Clock },
  confirmed: { label: "مؤكد", cls: "bg-sky-50 text-sky-700 border border-sky-200", icon: CheckCircle2 },
  processing: { label: "قيد التجهيز", cls: "bg-indigo-50 text-indigo-700 border border-indigo-200", icon: Box },
  shipped: { label: "تم الشحن", cls: "bg-emerald-50 text-emerald-700 border border-emerald-200", icon: Truck },
  delivered: { label: "تم التسليم", cls: "bg-teal-50 text-teal-700 border border-teal-200", icon: PackageCheck },
  paid: { label: "مدفوع", cls: "bg-emerald-50 text-emerald-700 border border-emerald-200", icon: Banknote },
  cancelled: { label: "ملغي", cls: "bg-red-50 text-red-600 border border-red-200", icon: XCircle },
  returned: { label: "مرتجع", cls: "bg-rose-50 text-rose-600 border border-rose-200", icon: ArrowRight },
};

const allStatuses = [
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
  order: Order;
  statusLog: OrderStatusLog[];
  notes: OrderNote[];
  shipments: any[];
};

export function OrderDetail({ order, statusLog, notes: initialNotes, shipments }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [notes, setNotes] = useState(initialNotes);
  const [statusLogState, setStatusLogState] = useState(statusLog);

  const st = statusConfig[order.status] || statusConfig.pending;
  const isTransfer = (order.payment_method || "").toLowerCase().includes("تحويل") || (order.payment_method || "").toLowerCase().includes("بنكي");
  const isCod = (order.payment_method || "").toLowerCase().includes("عند الاستلام") || (order.payment_method || "").toLowerCase().includes("cod");

  const handleStatusChange = async (newStatus: string) => {
    if (newStatus === order.status) return;
    setBusy(true);
    const fd = new FormData();
    fd.set("id", order.id);
    fd.set("status", newStatus);
    const res = await updateOrderStatusAction(fd);
    setBusy(false);
    if (!res.error) {
      setStatusLogState((prev) => [...prev, {
        id: `local-${Date.now()}`,
        order_id: order.id,
        old_status: order.status,
        new_status: newStatus,
        changed_by: "admin",
        note: null,
        created_at: new Date().toISOString(),
      } as OrderStatusLog]);
      router.refresh();
    }
  };

  const handleShip = async () => {
    setBusy(true);
    const fd = new FormData();
    fd.set("id", order.id);
    const res = await createShipmentAction(fd);
    setBusy(false);
    if (res.error) { alert(res.error); return; }
    router.refresh();
  };

  const handleAddNote = async () => {
    if (!noteText.trim()) return;
    setBusy(true);
    const fd = new FormData();
    fd.set("order_id", order.id);
    fd.set("content", noteText);
    const res = await addOrderNoteAction(fd);
    setBusy(false);
    if (res.error) { alert(res.error); return; }
    setNotes((prev) => [...prev, {
      id: `local-${Date.now()}`,
      order_id: order.id,
      content: noteText.trim(),
      author: "admin",
      is_internal: true,
      created_at: new Date().toISOString(),
    } as OrderNote]);
    setNoteText("");
    router.refresh();
  };

  const handleDeleteNote = async (noteId: string) => {
    if (!confirm("حذف الملاحظة؟")) return;
    await deleteOrderNoteAction(noteId, order.id);
    router.refresh();
  };

  const advance = async (target: string) => {
    setBusy(true);
    const fd = new FormData();
    fd.set("id", order.id);
    fd.set("status", target);
    const res = await updateOrderStatusAction(fd);
    setBusy(false);
    if (!res.error) router.refresh();
  };

  const workflow = () => {
    if (order.status === "pending") {
      if (isTransfer && !order.transfer_receipt_url) return { blocked: true, text: "بانتظار إثبات التحويل" };
      return { action: () => advance("processing"), label: "تأكيد الطلب", icon: CheckCircle2 };
    }
    if (order.status === "confirmed") return { action: () => advance("processing"), label: "بدء التجهيز", icon: CheckCircle2 };
    if (order.status === "processing") return { action: handleShip, label: "شحن الطلب", icon: Truck };
    if (order.status === "shipped") return { action: () => advance("delivered"), label: "تم التسليم", icon: PackageCheck };
    if (order.status === "delivered") return { action: () => advance("paid"), label: "تأكيد الدفع", icon: Banknote };
    return null;
  };

  const w = workflow();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="rounded-xl border border-stone-200 p-2 hover:bg-stone-50 transition">
            <ArrowRight className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-stone-900">طلب #{order.order_number}</h1>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${st.cls}`}>
                {st.label}
              </span>
            </div>
            <p className="mt-0.5 text-sm text-stone-500 text-right">
              <Calendar className="inline w-3.5 h-3.5 ml-1" />
              <span dir="ltr">{formatDate(order.created_at)}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => window.print()} className="flex items-center gap-1.5 rounded-xl border border-stone-200 px-3 py-2 text-sm hover:bg-stone-50 transition">
            <Printer className="w-4 h-4" /> طباعة
          </button>
          {w && !w.blocked && (
            <button onClick={w.action} disabled={busy}
              className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 transition disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : w.icon && <w.icon className="w-4 h-4" />}
              {w.label}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Items */}
          <div className="rounded-2xl border border-amber-100 bg-white p-5">
            <h2 className="flex items-center gap-2 font-bold text-stone-900 mb-4">
              <Box className="w-5 h-5 text-gold" /> المنتجات
            </h2>
            <div className="divide-y divide-stone-100">
              {(order.items || []).map((item, i) => (
                <div key={i} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
                  {item.image && (
                    <img src={item.image} alt={item.name} className="w-14 h-14 rounded-xl object-cover border border-stone-100" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-stone-900 truncate">{item.name}</p>
                    <p className="text-sm text-stone-500">الكمية: {item.qty}</p>
                  </div>
                  <Currency value={item.price * item.qty} className="font-bold text-stone-900" />
                </div>
              ))}
            </div>
            <div className="mt-4 border-t border-stone-100 pt-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-stone-500">المجموع الفرعي</span>
                <Currency value={order.total - order.shipping_cost + order.discount} />
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-stone-500">الشحن</span>
                <Currency value={order.shipping_cost} />
              </div>
              {order.discount > 0 && (
                <div className="flex justify-between text-sm text-emerald-600">
                  <span>الخصم {order.coupon_code && `(${order.coupon_code})`}</span>
                  <span>- <Currency value={order.discount} /></span>
                </div>
              )}
              <div className="flex justify-between text-base font-bold border-t border-stone-100 pt-2">
                <span>الإجمالي</span>
                <Currency value={order.total} className="text-gold text-lg" />
              </div>
            </div>
          </div>

          {/* Status Log / Timeline */}
          <div className="rounded-2xl border border-amber-100 bg-white p-5">
            <h2 className="flex items-center gap-2 font-bold text-stone-900 mb-4">
              <Clock className="w-5 h-5 text-gold" /> سجل التغييرات
            </h2>
            {statusLogState.length === 0 ? (
              <p className="text-sm text-stone-400">لا يوجد سجل بعد</p>
            ) : (
              <div className="relative">
                <div className="absolute right-4 top-0 bottom-0 w-0.5 bg-stone-100" />
                <div className="space-y-4">
                  {statusLogState.map((log) => {
                    const cfg = statusConfig[log.new_status] || statusConfig.pending;
                    return (
                      <div key={log.id} className="relative flex gap-4 pr-10">
                        <div className={`absolute right-2 top-1 w-5 h-5 rounded-full border-2 border-white flex items-center justify-center ${log.new_status === "cancelled" ? "bg-red-500" : log.new_status === "delivered" || log.new_status === "paid" ? "bg-emerald-500" : "bg-gold"}`}>
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${cfg.cls}`}>{cfg.label}</span>
                            {log.old_status && (
                              <span className="text-xs text-stone-400">
                                من {statusConfig[log.old_status]?.label || log.old_status}
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs text-stone-400 text-right">
                            <span dir="ltr">{formatDate(log.created_at)}</span>
                            {log.changed_by && ` — ${log.changed_by}`}
                          </p>
                          {log.note && <p className="mt-1 text-sm text-stone-600">{log.note}</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="rounded-2xl border border-amber-100 bg-white p-5">
            <h2 className="flex items-center gap-2 font-bold text-stone-900 mb-4">
              <MessageSquare className="w-5 h-5 text-gold" /> ملاحظات داخلية
            </h2>
            {notes.length > 0 && (
              <div className="space-y-3 mb-4">
                {notes.map((n) => (
                  <div key={n.id} className="flex items-start gap-3 rounded-xl bg-stone-50 p-3">
                    <StickyNote className="w-4 h-4 mt-0.5 text-stone-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-stone-700">{n.content}</p>
                      <p className="mt-1 text-xs text-stone-400 text-right">
                        {n.author} — <span dir="ltr">{formatDate(n.created_at)}</span>
                      </p>
                    </div>
                    <button onClick={() => handleDeleteNote(n.id)} className="text-stone-400 hover:text-red-500 transition">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddNote()}
                placeholder="أضف ملاحظة داخلية..."
                className="flex-1 rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none"
              />
              <button onClick={handleAddNote} disabled={busy || !noteText.trim()}
                className="rounded-xl bg-gold px-4 py-2.5 text-sm font-bold text-white hover:bg-gold-light transition disabled:opacity-50">
                إضافة
              </button>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Status Control */}
          <div className="rounded-2xl border border-amber-100 bg-white p-5">
            <h2 className="font-bold text-stone-900 mb-3">تغيير الحالة</h2>
            <select
              value={order.status}
              onChange={(e) => handleStatusChange(e.target.value)}
              disabled={busy}
              className="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm font-semibold focus:border-gold focus:outline-none"
            >
              {allStatuses.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>

          {/* Customer Info */}
          <div className="rounded-2xl border border-amber-100 bg-white p-5">
            <h2 className="font-bold text-stone-900 mb-3">بيانات العميل</h2>
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-semibold text-stone-900">{order.customer_name}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-stone-600">
                <Phone className="w-4 h-4 text-stone-400" />
                <span dir="ltr">{order.customer_phone}</span>
                <a href={`https://wa.me/${order.customer_phone?.replace(/^0/, "966")}`} target="_blank" rel="noopener noreferrer"
                  className="text-emerald-600 hover:underline text-xs">واتساب</a>
              </div>
              {order.email && (
                <div className="flex items-center gap-2 text-sm text-stone-600">
                  <Mail className="w-4 h-4 text-stone-400" />
                  <span>{order.email}</span>
                </div>
              )}
              {(order.address || order.customer_city) && (
                <div className="flex items-start gap-2 text-sm text-stone-600">
                  <MapPin className="w-4 h-4 text-stone-400 mt-0.5 shrink-0" />
                  <div>
                    {order.address && <p>{order.address}</p>}
                    {[order.customer_city, order.region].filter(Boolean).join("، ")}
                  </div>
                </div>
              )}
              {order.national_address && (
                <p className="text-xs text-stone-400">العنوان الوطني: {order.national_address}</p>
              )}
            </div>
          </div>

          {/* Payment Info */}
          <div className="rounded-2xl border border-amber-100 bg-white p-5">
            <h2 className="font-bold text-stone-900 mb-3">الدفع</h2>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <CreditCard className="w-4 h-4 text-stone-400" />
                <span>{order.payment_method || "غير محدد"}</span>
              </div>
              {isCod && <p className="text-xs text-amber-600 font-bold">الدفع عند الاستلام — {order.total} ر.س</p>}
              {isTransfer && order.transfer_receipt_url && (
                <a href={order.transfer_receipt_url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-sm text-emerald-600 hover:underline">
                  <ExternalLink className="w-3.5 h-3.5" /> عرض إيصال التحويل
                </a>
              )}
              {isTransfer && !order.transfer_receipt_url && order.status === "pending" && (
                <p className="text-xs text-amber-600 font-bold">بانتظار رفع إيصال التحويل</p>
              )}
            </div>
          </div>

          {/* Shipping Info */}
          <div className="rounded-2xl border border-amber-100 bg-white p-5">
            <h2 className="font-bold text-stone-900 mb-3">الشحن</h2>
            <div className="space-y-2">
              {order.shipping_method && (
                <p className="text-sm"><span className="text-stone-500">الشركة:</span> {order.shipping_method}</p>
              )}
              {order.tracking_number && (
                <p className="text-sm">
                  <span className="text-stone-500">رقم التتبع:</span>{" "}
                  {order.tracking_url ? (
                    <a href={order.tracking_url} target="_blank" rel="noopener noreferrer"
                      className="text-blue-600 hover:underline font-bold inline-flex items-center gap-1">
                      {order.tracking_number} <ExternalLink className="w-3 h-3" />
                    </a>
                  ) : (
                    <span className="font-bold">{order.tracking_number}</span>
                  )}
                </p>
              )}
              {!order.shipping_method && !order.tracking_number && (
                <p className="text-sm text-stone-400">لم يتم الشحن بعد</p>
              )}
              {shipments.length > 0 && (
                <div className="mt-2 space-y-2">
                  {shipments.map((s: any) => (
                    <div key={s.id} className="rounded-lg bg-stone-50 p-2 text-xs">
                      <p className="font-bold">{s.delivery_company || s.delivery_option_name || order.shipping_method || "شحنة"}</p>
                      {s.tracking_number && <p>تتبع: {s.tracking_number}</p>}
                      {s.print_awb_url && (
                        <a href={s.print_awb_url} target="_blank" rel="noopener noreferrer" className="text-gold hover:underline">
                          طباعة Waybill
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Order Notes */}
          {order.notes && (
            <div className="rounded-2xl border border-amber-100 bg-white p-5">
              <h2 className="font-bold text-stone-900 mb-2">ملاحظات العميل</h2>
              <p className="text-sm text-stone-600 bg-amber-50 rounded-xl p-3">{order.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

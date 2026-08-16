"use client";

import { useEffect, useState } from "react";
import {
  X, Phone, Mail, MapPin, CreditCard, Truck, Box, Banknote, CheckCircle2, XCircle,
  ExternalLink, Loader2, Printer, Copy, StickyNote, Trash2, ArrowRight, FileWarning, PackageCheck,
} from "lucide-react";
import { addOrderNoteAction, deleteOrderNoteAction } from "@/app/actions/orders-admin";
import { Currency } from "@/components/storefront/currency";
import { formatArabicDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Order, OrderDetails, OrderNote } from "@/types";
import {
  ORDER_STATUS_META, PAYMENT_STATUS_META, SHIPPING_STATUS_META, WORKFLOW_STEPS,
  derivePaymentStatus, deriveShippingStatus, isTransfer, workflowAction,
} from "@/lib/orders/order-meta";

type DrawerState = {
  open: boolean;
  orderId: string | null;
  data: OrderDetails | null;
  loading: boolean;
  error: string | null;
};

type Props = {
  drawer: DrawerState;
  busyId: string | null;
  onClose: () => void;
  onStatus: (o: Order, target: string, label: string) => void;
  onShip: (o: Order) => void;
  onApproveTransfer: (o: Order) => void;
  onRejectTransfer: (o: Order) => void;
  onPrint: (o: Order) => void;
  onCopy: (o: Order) => void;
};

function Section({ title, icon: Icon, children }: { title: string; icon: typeof Box; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-amber-100 bg-white p-4">
      <h3 className="mb-3 flex items-center gap-2 font-bold text-stone-900">
        <Icon className="h-4.5 w-4.5 text-gold" /> {title}
      </h3>
      {children}
    </section>
  );
}

function Badge({ label, cls }: { label: string; cls: string }) {
  return <span className={cn("whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-bold", cls)}>{label}</span>;
}

export function OrderDrawer({ drawer, busyId, onClose, onStatus, onShip, onApproveTransfer, onRejectTransfer, onPrint, onCopy }: Props) {
  const [noteText, setNoteText] = useState("");
  const [notes, setNotes] = useState<OrderNote[]>([]);
  const [addingNote, setAddingNote] = useState(false);

  const data = drawer.data;
  const order = data?.order;

  useEffect(() => {
    if (data?.notes) setNotes(data.notes);
    setNoteText("");
  }, [data?.notes]);

  const handleAddNote = async () => {
    if (!order || !noteText.trim()) return;
    setAddingNote(true);
    const fd = new FormData();
    fd.set("order_id", order.id);
    fd.set("content", noteText);
    const res = await addOrderNoteAction(fd);
    setAddingNote(false);
    if (res.error) return;
    setNotes((prev) => [...prev, {
      id: `local-${Date.now()}`,
      order_id: order.id,
      content: noteText.trim(),
      author: "admin",
      is_internal: true,
      created_at: new Date().toISOString(),
    } as OrderNote]);
    setNoteText("");
  };

  const handleDeleteNote = async (noteId: string) => {
    if (!order) return;
    await deleteOrderNoteAction(noteId, order.id);
    setNotes((prev) => prev.filter((n) => n.id !== noteId));
  };

  if (!drawer.open) return null;
  const panel = drawer.loading || !order ? null : renderDetail();

  function renderDetail() {
    if (!order) return null;
    const st = ORDER_STATUS_META[order.status] || ORDER_STATUS_META.pending;
    const pst = PAYMENT_STATUS_META[derivePaymentStatus(order)];
    const sst = SHIPPING_STATUS_META[deriveShippingStatus(order)];
    const w = workflowAction(order);
    const stepIndex = WORKFLOW_STEPS.findIndex((s) => s.value === order.status);
    const terminal = order.status === "cancelled" || order.status === "returned";

    const subtotal = order.total - order.shipping_cost + order.discount;

    return (
      <div className="space-y-4">
        {/* Stepper */}
        <Section title="سير العمل" icon={CheckCircle2}>
          {terminal ? (
            <div className="flex items-center gap-2 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-600">
              <XCircle className="h-5 w-5" />
              الطلب {order.status === "cancelled" ? "ملغي" : "مرتجع"}
              {order.notes && <span className="text-xs font-normal text-red-500">— {order.notes}</span>}
            </div>
          ) : (
            <ol className="flex items-center justify-between gap-1 overflow-x-auto py-2">
              {WORKFLOW_STEPS.map((step, i) => {
                const done = stepIndex >= i;
                const current = stepIndex === i;
                return (
                  <li key={step.value} className="flex min-w-[70px] flex-1 flex-col items-center gap-1.5">
                    <span
                      className={cn(
                        "flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-bold",
                        current
                          ? "border-gold bg-gold text-white"
                          : done
                          ? "border-emerald-500 bg-emerald-500 text-white"
                          : "border-stone-200 bg-white text-stone-400"
                      )}
                    >
                      {done && !current ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                    </span>
                    <span className={cn("whitespace-nowrap text-[10px] font-bold", current ? "text-gold-dark" : done ? "text-emerald-700" : "text-stone-400")}>
                      {step.label}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
          <div className="mt-2 flex flex-wrap gap-2 border-t border-stone-100 pt-3">
            <Badge {...st} />
            <Badge {...pst} />
            <Badge {...sst} />
          </div>
        </Section>

        {/* Customer */}
        <Section title="بيانات العميل" icon={Box}>
          <div className="space-y-2 text-sm">
            <p className="font-bold text-stone-900">{order.customer_name}</p>
            <div className="flex flex-wrap items-center gap-3">
              <a href={`tel:${order.customer_phone}`} className="flex items-center gap-1.5 text-stone-600 hover:text-gold-dark" dir="ltr">
                <Phone className="h-3.5 w-3.5 text-stone-400" /> {order.customer_phone}
              </a>
              <a
                href={`https://wa.me/${order.customer_phone?.replace(/^0/, "966")}`}
                target="_blank" rel="noopener noreferrer"
                className="rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 hover:bg-emerald-100"
              >
                واتساب
              </a>
            </div>
            {order.email && (
              <p className="flex items-center gap-1.5 text-stone-600"><Mail className="h-3.5 w-3.5 text-stone-400" /> {order.email}</p>
            )}
            <div className="flex items-start gap-1.5 text-stone-600">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-stone-400" />
              <span>
                {[order.customer_city, order.region].filter(Boolean).join("، ") || "بدون مدينة"}
                {order.address && <span className="block text-xs text-stone-500">{order.address}</span>}
                {order.national_address && <span className="block text-xs text-stone-400">العنوان الوطني: {order.national_address}</span>}
                {order.maps_url && (
                  <a href={order.maps_url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:underline">
                    فتح الموقع <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </span>
            </div>
          </div>
        </Section>

        {/* Products */}
        <Section title="المنتجات" icon={PackageCheck}>
          <div className="divide-y divide-stone-100">
            {(order.items || []).map((item, i) => (
              <div key={i} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                {item.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.image} alt={item.name} className="h-12 w-12 rounded-xl border border-stone-100 object-cover" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-stone-900">{item.name}</p>
                  <p className="text-xs text-stone-400">الكمية: {item.qty}{item.sku ? ` · SKU: ${item.sku}` : ""}</p>
                </div>
                <Currency value={item.price * item.qty} className="text-sm font-bold text-stone-900" />
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-1.5 border-t border-stone-100 pt-3 text-sm">
            <div className="flex justify-between text-stone-500"><span>المجموع الفرعي</span><Currency value={subtotal} /></div>
            <div className="flex justify-between text-stone-500"><span>الشحن</span><Currency value={order.shipping_cost} /></div>
            {order.discount > 0 && (
              <div className="flex justify-between text-emerald-600">
                <span>الخصم {order.coupon_code && `(${order.coupon_code})`}</span>
                <span>- <Currency value={order.discount} /></span>
              </div>
            )}
            <div className="flex justify-between border-t border-stone-100 pt-2 text-base font-bold">
              <span className="text-stone-900">الإجمالي</span>
              <Currency value={order.total} className="text-gold-dark" />
            </div>
          </div>
        </Section>

        {/* Payment */}
        <Section title="الدفع" icon={Banknote}>
          <div className="space-y-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-stone-700"><CreditCard className="h-3.5 w-3.5 text-stone-400" /> {order.payment_method || "غير محدد"}</p>
              <Badge {...pst} />
            </div>
            {isTransfer(order) && order.transfer_receipt_url && (
              <a href={order.transfer_receipt_url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 hover:underline">
                <ExternalLink className="h-3.5 w-3.5" /> عرض إيصال التحويل
              </a>
            )}
            {isTransfer(order) && (order.status === "pending" || order.status === "confirmed") && order.transfer_receipt_url && (
              <div className="flex flex-wrap gap-2">
                <button onClick={() => onApproveTransfer(order)} disabled={busyId === order.id}
                  className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                  {busyId === order.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  اعتماد التحويل
                </button>
                <button onClick={() => onRejectTransfer(order)} disabled={busyId === order.id}
                  className="flex items-center gap-1 rounded-lg bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-100 disabled:opacity-50">
                  <XCircle className="h-3.5 w-3.5" /> رفض التحويل
                </button>
              </div>
            )}
          </div>
        </Section>

        {/* Shipping */}
        <Section title="الشحن" icon={Truck}>
          <div className="space-y-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-stone-700">{order.shipping_method || "لم يتم تحديد شركة شحن"}</p>
              <Badge {...sst} />
            </div>
            {order.tracking_number && (
              <p className="text-xs">
                <span className="text-stone-500">رقم التتبع:</span>{" "}
                {order.tracking_url ? (
                  <a href={order.tracking_url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-bold text-blue-600 hover:underline">
                    {order.tracking_number} <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  <span className="font-bold text-stone-700" dir="ltr">{order.tracking_number}</span>
                )}
              </p>
            )}
            {(data?.shipments || []).map((s: any) => (
              <div key={s.id} className="rounded-xl bg-stone-50 p-2.5 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-bold text-stone-700">{s.delivery_company || s.delivery_option_name || order.shipping_method || "شحنة"}</p>
                  {s.status && <Badge {...(SHIPPING_STATUS_META[s.status as keyof typeof SHIPPING_STATUS_META] || SHIPPING_STATUS_META.created)} />}
                </div>
                {(s.tracking_number || s.dc_tracking_number) && (
                  <p className="mt-1 text-stone-500">تتبع: <span dir="ltr">{s.tracking_number || s.dc_tracking_number}</span></p>
                )}
                {s.print_awb_url && (
                  <a href={s.print_awb_url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 font-bold text-gold-dark hover:underline">
                    طباعة Waybill <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {s.error_message && <p className="mt-1 text-rose-600">{s.error_message}</p>}
              </div>
            ))}
            {order.status === "processing" && (
              <button onClick={() => onShip(order)} disabled={busyId === order.id}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                {busyId === order.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Truck className="h-3.5 w-3.5" />}
                إنشاء الشحنة
              </button>
            )}
          </div>
        </Section>

        {/* Timeline */}
        <Section title="سجل التغييرات" icon={FileWarning}>
          {!data?.statusLog.length ? (
            <p className="text-sm text-stone-400">لا يوجد سجل بعد</p>
          ) : (
            <ol className="relative space-y-4 pr-5">
              <span className="absolute right-[7px] top-1 bottom-1 w-0.5 bg-stone-100" />
              {[...(data?.statusLog || [])].reverse().map((log) => {
                const cfg = ORDER_STATUS_META[log.new_status as keyof typeof ORDER_STATUS_META] || ORDER_STATUS_META.pending;
                return (
                  <li key={log.id} className="relative">
                    <span className={cn("absolute right-[-17px] top-1 h-3.5 w-3.5 rounded-full border-2 border-white", cfg.cls.includes("red") || cfg.cls.includes("rose") ? "bg-red-500" : "bg-gold")} />
                    <Badge {...cfg} />
                    {log.old_status && (
                      <span className="mr-2 text-xs text-stone-400">
                        من {ORDER_STATUS_META[log.old_status as keyof typeof ORDER_STATUS_META]?.label || log.old_status}
                      </span>
                    )}
                    <p className="mt-1 text-xs text-stone-400" dir="ltr">{formatArabicDateTime(log.created_at)}</p>
                    {log.note && <p className="mt-0.5 text-sm text-stone-600">{log.note}</p>}
                    {log.changed_by && <p className="text-[11px] text-stone-400">بواسطة: {log.changed_by}</p>}
                  </li>
                );
              })}
            </ol>
          )}
        </Section>

        {/* Notes */}
        <Section title="ملاحظات داخلية" icon={StickyNote}>
          {notes.length > 0 && (
            <div className="mb-3 space-y-2">
              {notes.map((n) => (
                <div key={n.id} className="flex items-start gap-2 rounded-xl bg-stone-50 p-2.5">
                  <p className="flex-1 text-sm text-stone-700">{n.content}</p>
                  <button onClick={() => handleDeleteNote(n.id)} aria-label="حذف الملاحظة" className="text-stone-400 hover:text-red-500">
                    <Trash2 className="h-3.5 w-3.5" />
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
              className="flex-1 rounded-xl border border-stone-200 px-3 py-2 text-sm focus:border-gold focus:outline-none"
            />
            <button onClick={handleAddNote} disabled={addingNote || !noteText.trim()}
              className="rounded-xl bg-gold px-3 py-2 text-sm font-bold text-white hover:bg-gold-light disabled:opacity-50">
              إضافة
            </button>
          </div>
        </Section>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[95]">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`تفاصيل الطلب #${order?.order_number || ""}`}
        className="absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col bg-stone-50 shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-stone-200 bg-white px-5 py-4">
          <div>
            <p className="text-lg font-extrabold text-stone-900">طلب #{order?.order_number || "…"}</p>
            <p className="text-xs text-stone-400" dir="ltr">{order ? formatArabicDateTime(order.created_at) : ""}</p>
          </div>
          <div className="flex items-center gap-2">
            {order && (
              <>
                <button onClick={() => onPrint(order)} aria-label="طباعة الفاتورة"
                  className="rounded-lg border border-stone-200 p-2 text-stone-500 hover:bg-stone-100">
                  <Printer className="h-4 w-4" />
                </button>
                <button onClick={() => onCopy(order)} aria-label="نسخ رقم الطلب"
                  className="rounded-lg border border-stone-200 p-2 text-stone-500 hover:bg-stone-100">
                  <Copy className="h-4 w-4" />
                </button>
                <button onClick={onClose} aria-label="إغلاق" className="rounded-lg border border-stone-200 p-2 text-stone-500 hover:bg-stone-100">
                  <X className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {drawer.loading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="animate-pulse rounded-2xl border border-amber-100 bg-white p-4">
                  <div className="h-4 w-1/3 rounded bg-stone-100" />
                  <div className="mt-3 h-8 rounded bg-stone-100" />
                  <div className="mt-2 h-8 rounded bg-stone-100" />
                </div>
              ))}
            </div>
          ) : drawer.error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-600">{drawer.error}</div>
          ) : (
            panel
          )}
        </div>

        {order && (
          <div className="flex flex-wrap items-center gap-2 border-t border-stone-200 bg-white px-5 py-3">
            {(() => {
              const w = workflowAction(order);
              if (!w) return null;
              if (w.type === "blocked") {
                return (
                  <span className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                    <XCircle className="h-3.5 w-3.5" /> {w.label}
                  </span>
                );
              }
              if (w.type === "ship") {
                return (
                  <button onClick={() => onShip(order)} disabled={busyId === order.id}
                    className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                    {busyId === order.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Truck className="h-3.5 w-3.5" />}
                    {w.label}
                  </button>
                );
              }
              return (
                <button onClick={() => onStatus(order, w.target as string, w.label)} disabled={busyId === order.id}
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                  {busyId === order.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
                  {w.label}
                </button>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

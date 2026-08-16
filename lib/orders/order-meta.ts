import type {
  Order,
  OrderStatus,
  PaymentStatus,
  ShippingStatus,
} from "@/types";

export function isTransfer(o: { payment_method?: string | null }) {
  const pm = (o.payment_method || "").toLowerCase();
  return pm.includes("تحويل") || pm.includes("بنكي") || pm.includes("transfer");
}

export function isCod(o: { payment_method?: string | null }) {
  const pm = (o.payment_method || "").toLowerCase();
  return (
    pm.includes("عند الاستلام") ||
    pm.includes("cod") ||
    pm.includes("cash on delivery") ||
    pm.includes("الدفع عند")
  );
}

export const ORDER_STATUS_META: Record<OrderStatus, { label: string; cls: string }> = {
  pending: { label: "قيد المراجعة", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  confirmed: { label: "مؤكد", cls: "bg-sky-50 text-sky-700 border-sky-200" },
  processing: { label: "قيد التجهيز", cls: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  shipped: { label: "تم الشحن", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  delivered: { label: "تم التسليم", cls: "bg-teal-50 text-teal-700 border-teal-200" },
  paid: { label: "مدفوع", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  cancelled: { label: "ملغي", cls: "bg-red-50 text-red-600 border-red-200" },
  returned: { label: "مرتجع", cls: "bg-rose-50 text-rose-600 border-rose-200" },
};

export const ALL_ORDER_STATUSES: { value: OrderStatus; label: string }[] = [
  { value: "pending", label: "قيد المراجعة" },
  { value: "confirmed", label: "مؤكد" },
  { value: "processing", label: "قيد التجهيز" },
  { value: "shipped", label: "تم الشحن" },
  { value: "delivered", label: "تم التسليم" },
  { value: "paid", label: "مدفوع" },
  { value: "cancelled", label: "ملغي" },
  { value: "returned", label: "مرتجع" },
];

export const PAYMENT_STATUS_META: Record<PaymentStatus, { label: string; cls: string }> = {
  unpaid: { label: "غير مدفوع", cls: "bg-stone-100 text-stone-600 border-stone-200" },
  awaiting_receipt: { label: "بانتظار إثبات التحويل", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  awaiting_approval: { label: "بانتظار اعتماد التحويل", cls: "bg-orange-50 text-orange-700 border-orange-200" },
  paid: { label: "مدفوع", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  refunded: { label: "مسترد", cls: "bg-rose-50 text-rose-600 border-rose-200" },
  cancelled: { label: "ملغي", cls: "bg-red-50 text-red-600 border-red-200" },
};

export const SHIPPING_STATUS_META: Record<ShippingStatus, { label: string; cls: string }> = {
  not_created: { label: "لم تُنشأ الشحنة", cls: "bg-stone-100 text-stone-500 border-stone-200" },
  created: { label: "تم إنشاء الشحنة", cls: "bg-sky-50 text-sky-700 border-sky-200" },
  picked_up: { label: "تم استلام الشحنة", cls: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  in_transit: { label: "في الطريق", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  out_for_delivery: { label: "خرج للتوصيل", cls: "bg-violet-50 text-violet-700 border-violet-200" },
  delivered: { label: "تم التسليم", cls: "bg-teal-50 text-teal-700 border-teal-200" },
  failed: { label: "فشل التسليم", cls: "bg-red-50 text-red-600 border-red-200" },
  returned: { label: "مرتجع للشاحن", cls: "bg-rose-50 text-rose-600 border-rose-200" },
  cancelled: { label: "ملغي", cls: "bg-stone-100 text-stone-500 border-stone-200" },
};

/** Steps of the order workflow stepper (progress display only — never "paid"). */
export const WORKFLOW_STEPS: { value: OrderStatus; label: string }[] = [
  { value: "pending", label: "قيد المراجعة" },
  { value: "confirmed", label: "مؤكد" },
  { value: "processing", label: "قيد التجهيز" },
  { value: "shipped", label: "تم الشحن" },
  { value: "delivered", label: "تم التسليم" },
];

/** Derive a payment status from the order row without new DB columns. */
export function derivePaymentStatus(o: Order): PaymentStatus {
  if (o.status === "paid") return "paid";
  if (o.status === "returned") return "refunded";
  if (o.status === "cancelled") return "cancelled";

  if (isTransfer(o)) {
    if (!o.transfer_receipt_url) return "awaiting_receipt";
    if (o.status === "pending" || o.status === "confirmed") return "awaiting_approval";
    // Receipt uploaded and order moved forward → payment accepted.
    return "paid";
  }

  if (isCod(o)) return o.status === "delivered" ? "paid" : "unpaid";

  // Gateway / unknown method.
  return o.status === "delivered" ? "paid" : "unpaid";
}

/** Derive a shipping status from the order row + optional shipment row. */
export function deriveShippingStatus(o: Order): ShippingStatus {
  if (o.status === "returned") return "returned";
  if (o.status === "cancelled") return "cancelled";
  if (o.status === "delivered") return "delivered";

  const hasTracking = Boolean(o.tracking_number);

  if (o.status === "shipped") {
    return hasTracking ? "in_transit" : "created";
  }

  const hasShipment = Boolean(o.tracking_number || o.shipping_method || o.delivery_option_id);
  if (hasShipment) return "created";
  return "not_created";
}

/** Allowed quick "advance" actions per order status (workflow). */
export function workflowAction(o: Order): { type: "advance" | "ship" | "blocked"; label: string; target?: OrderStatus } | null {
  if (o.status === "pending") {
    if (isTransfer(o) && !o.transfer_receipt_url) {
      return { type: "blocked", label: "بانتظار إثبات التحويل" };
    }
    return { type: "advance", label: "تأكيد الطلب", target: "processing" };
  }
  if (o.status === "confirmed") return { type: "advance", label: "بدء التجهيز", target: "processing" };
  if (o.status === "processing") return { type: "ship", label: "إنشاء الشحنة" };
  if (o.status === "shipped") return { type: "advance", label: "تم التسليم", target: "delivered" };
  if (o.status === "delivered") return { type: "advance", label: "تأكيد الدفع", target: "paid" };
  return null;
}

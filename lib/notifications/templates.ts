import type { TemplateVariables, NotificationTemplate } from "./types";

/**
 * Template Engine — renders {{variable}} placeholders and validates them.
 * Templates are stored in the DB (notification_templates); the built-in list
 * here is only the seed data used when a template is missing.
 */

export const SUPPORTED_VARIABLES = [
  "customer_name",
  "customer_phone",
  "order_number",
  "order_id",
  "order_total",
  "tracking_number",
  "carrier_name",
  "shipping_status",
  "tracking_url",
  "delivery_date",
  "store_name",
  "support_phone",
  "return_reason",
  "error_message",
  "amount",
  "remaining_credit",
] as const;

const VARIABLE_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function extractVariables(template: string): string[] {
  const vars = new Set<string>();
  for (const match of template.matchAll(VARIABLE_RE)) {
    vars.add(match[1]);
  }
  return [...vars];
}

export function renderTemplate(
  template: string,
  variables: TemplateVariables
): string {
  return template.replace(VARIABLE_RE, (_full, key: string) => {
    const value = variables[key];
    if (value === undefined || value === null) return `{{${key}}}`;
    return String(value);
  });
}

export function renderTemplateTitle(template: string, variables: TemplateVariables): string {
  const rendered = renderTemplate(template, variables);
  return rendered.replace(VARIABLE_RE, "");
}

/**
 * Validate a template against the known variable list.
 * Returns the list of unknown variables (empty = valid).
 */
export function validateTemplateVariables(template: string): string[] {
  const unknown = extractVariables(template).filter((v) => !SUPPORTED_VARIABLES.includes(v as (typeof SUPPORTED_VARIABLES)[number]));
  return unknown;
}

export const BUILT_IN_TEMPLATES: Omit<NotificationTemplate, "is_active">[] = [
  // ---------- Orders ----------
  {
    event_type: "order.created",
    name: "طلب جديد",
    title: "طلب جديد {{order_number}}",
    body: "مرحبًا {{store_name}}، تم استلام طلب جديد رقم {{order_number}} بقيمة {{order_total}} ر.س من {{customer_name}}.",
    severity: "info",
    category: "orders",
    channels: ["in_app", "email"],
  },
  {
    event_type: "order.payment_success",
    name: "تم الدفع",
    title: "تم دفع الطلب {{order_number}}",
    body: "تم تأكيد دفع طلبك {{order_number}} بقيمة {{order_total}} ر.س بنجاح. شكرًا لثقتك بـ {{store_name}}.",
    severity: "success",
    category: "payment",
    channels: ["in_app", "email", "sms"],
  },
  {
    event_type: "order.payment_failed",
    name: "فشل الدفع",
    title: "فشل دفع الطلب {{order_number}}",
    body: "تعذر إتمام عملية الدفع للطلب {{order_number}} بقيمة {{order_total}} ر.س. يرجى إعادة المحاولة.",
    severity: "critical",
    category: "payment",
    channels: ["in_app", "email", "sms"],
  },
  {
    event_type: "order.cancelled",
    name: "إلغاء الطلب",
    title: "إلغاء الطلب {{order_number}}",
    body: "تم إلغاء الطلب {{order_number}}. تواصل مع الدعم على {{support_phone}} لأي استفسار.",
    severity: "warning",
    category: "orders",
    channels: ["in_app", "email"],
  },
  // ---------- Shipping ----------
  {
    event_type: "shipment.created",
    name: "تم إنشاء الشحنة",
    title: "تم شحن طلبك {{order_number}}",
    body: "مرحبًا {{customer_name}}، تم شحن طلبك رقم {{order_number}} عبر {{carrier_name}}. رقم التتبع: {{tracking_number}} — الرابط: {{tracking_url}}",
    severity: "info",
    category: "shipping",
    channels: ["in_app", "email", "sms"],
  },
  {
    event_type: "shipment.picked_up",
    name: "تم استلام الشحنة من المتجر",
    title: "تم استلام طلبك {{order_number}} من المتجر",
    body: "تم استلام طلبك {{order_number}} من المتجر وبدأت عملية الشحن عبر {{carrier_name}}.",
    severity: "info",
    category: "shipping",
    channels: ["in_app", "email"],
  },
  {
    event_type: "shipment.in_transit",
    name: "الشحنة في الطريق",
    title: "طلبك {{order_number}} في الطريق",
    body: "شحنتك رقم {{tracking_number}} للطلب {{order_number}} في الطريق. تتبعها عبر {{tracking_url}}",
    severity: "info",
    category: "shipping",
    channels: ["in_app"],
  },
  {
    event_type: "shipment.out_for_delivery",
    name: "الشحنة خرجت للتسليم",
    title: "طلبك {{order_number}} خرج للتسليم",
    body: "مرحبًا {{customer_name}}، طلبك {{order_number}} في طريقه إليك الآن. الرجاء تجهيز الاستلام.",
    severity: "info",
    category: "shipping",
    channels: ["in_app", "sms"],
  },
  {
    event_type: "shipment.delivered",
    name: "تم التسليم",
    title: "تم تسليم طلبك {{order_number}}",
    body: "مرحبًا {{customer_name}}، تم تسليم طلبك {{order_number}} بنجاح. نتمنى أن يكون كل شيء على ما يرام.",
    severity: "success",
    category: "shipping",
    channels: ["in_app", "email", "sms"],
  },
  {
    event_type: "shipment.delivery_failed",
    name: "فشل محاولة التسليم",
    title: "تعذر تسليم الطلب {{order_number}}",
    body: "تعذر تسليم الطلب {{order_number}} عبر {{carrier_name}}. يرجى التواصل معنا على {{support_phone}}.",
    severity: "warning",
    category: "shipping",
    channels: ["in_app", "sms"],
  },
  {
    event_type: "shipment.failed",
    name: "فشل إنشاء الشحنة",
    title: "فشل إنشاء شحنة الطلب {{order_number}}",
    body: "فشل إنشاء الشحنة للطلب {{order_number}} عبر {{carrier_name}}. السبب: {{error_message}}",
    severity: "critical",
    category: "shipping",
    channels: ["in_app", "email", "sms"],
  },
  {
    event_type: "shipment.cancelled",
    name: "إلغاء الشحنة",
    title: "إلغاء شحنة الطلب {{order_number}}",
    body: "تم إلغاء شحنة الطلب {{order_number}} عبر {{carrier_name}}.",
    severity: "warning",
    category: "shipping",
    channels: ["in_app"],
  },
  {
    event_type: "shipment.delayed",
    name: "شحنة متأخرة",
    title: "شحنة الطلب {{order_number}} متأخرة",
    body: "تجاوزت شحنة الطلب {{order_number}} عبر {{carrier_name}} موعد التسليم المتوقع. التحديث الحالي: {{shipping_status}}",
    severity: "warning",
    category: "shipping",
    channels: ["in_app", "email"],
  },
  {
    event_type: "shipment.stuck",
    name: "شحنة متوقفة",
    title: "شحنة الطلب {{order_number}} متوقفة",
    body: "لا يوجد تحديث لشحنة الطلب {{order_number}} عبر {{carrier_name}} منذ أكثر من 48 ساعة. مطلوب مراجعة.",
    severity: "warning",
    category: "shipping",
    channels: ["in_app", "email"],
  },
  {
    event_type: "shipment.carrier_changed",
    name: "تم تغيير شركة الشحن",
    title: "تحويل شحنة الطلب {{order_number}}",
    body: "تم تحويل شحنة الطلب {{order_number}} إلى {{carrier_name}} بسبب فشل الإنشاء لدى الشركة السابقة.",
    severity: "info",
    category: "shipping",
    channels: ["in_app"],
  },
  // ---------- Returns ----------
  {
    event_type: "return.requested",
    name: "طلب استرجاع جديد",
    title: "طلب استرجاع للطلب {{order_number}}",
    body: "قام {{customer_name}} بطلب استرجاع للطلب {{order_number}}. السبب: {{return_reason}}",
    severity: "info",
    category: "returns",
    channels: ["in_app", "email"],
  },
  {
    event_type: "return.approved",
    name: "تمت الموافقة على الاسترجاع",
    title: "تمت الموافقة على استرجاع طلبك {{order_number}}",
    body: "مرحبًا {{customer_name}}، تمت الموافقة على طلب الاسترجاع الخاص بالطلب {{order_number}}.",
    severity: "success",
    category: "returns",
    channels: ["in_app", "email", "sms"],
  },
  {
    event_type: "return.created",
    name: "تم إنشاء شحنة المرتجع",
    title: "تم إنشاء شحنة مرتجع للطلب {{order_number}}",
    body: "تم إنشاء شحنة المرتجع للطلب {{order_number}} عبر {{carrier_name}}.",
    severity: "info",
    category: "returns",
    channels: ["in_app"],
  },
  {
    event_type: "return.received",
    name: "تم استلام المرتجع",
    title: "تم استلام مرتجع الطلب {{order_number}}",
    body: "تم استلام المرتجع الخاص بالطلب {{order_number}}. جاري الفحص.",
    severity: "info",
    category: "returns",
    channels: ["in_app"],
  },
  {
    event_type: "return.refunded",
    name: "تم رد المبلغ",
    title: "تم رد مبلغ الطلب {{order_number}}",
    body: "مرحبًا {{customer_name}}، تم رد مبلغ الطلب {{order_number}} بنجاح.",
    severity: "success",
    category: "returns",
    channels: ["in_app", "email", "sms"],
  },
  {
    event_type: "return.rejected",
    name: "رفض الاسترجاع",
    title: "تم رفض طلب الاسترجاع للطلب {{order_number}}",
    body: "نأسف، تم رفض طلب الاسترجاع الخاص بالطلب {{order_number}}. تواصل معنا على {{support_phone}}.",
    severity: "warning",
    category: "returns",
    channels: ["in_app", "email"],
  },
  // ---------- System / webhook / security ----------
  {
    event_type: "webhook.failed",
    name: "فشل Webhook",
    title: "فشل استقبال Webhook من {{carrier_name}}",
    body: "حدث خطأ أثناء معالجة Webhook. السبب: {{error_message}}",
    severity: "critical",
    category: "webhook",
    channels: ["in_app", "email"],
  },
  {
    event_type: "oto.api_error",
    name: "خطأ OTO API",
    title: "خطأ OTO API — {{error_message}}",
    body: "حدث خطأ في الاتصال بـ OTO. السبب: {{error_message}}",
    severity: "critical",
    category: "system",
    channels: ["in_app", "email"],
  },
  {
    event_type: "notification.failed",
    name: "فشل إرسال إشعار",
    title: "فشل إرسال إشعار عبر {{carrier_name}}",
    body: "فشل تسليم إشعار عبر قناة {{carrier_name}} بعد كل المحاولات. السبب: {{error_message}}",
    severity: "critical",
    category: "system",
    channels: ["in_app", "email"],
  },
  {
    event_type: "system.error",
    name: "خطأ في النظام",
    title: "خطأ في النظام",
    body: "{{error_message}}",
    severity: "critical",
    category: "system",
    channels: ["in_app", "email"],
  },
  {
    event_type: "security.alert",
    name: "تنبيه أمني",
    title: "تنبيه أمني",
    body: "{{error_message}}",
    severity: "critical",
    category: "security",
    channels: ["in_app", "email"],
  },
];

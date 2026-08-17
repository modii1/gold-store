import type { TemplateVariables, NotificationTemplate } from "./types";

/**
 * Template Engine — renders {{variable}} placeholders and validates them.
 * Templates are stored in the DB (notification_templates); the built-in list
 * here is only the seed data used when a template is missing.
 *
 * Supported syntax:
 *   {{variable}}                     — replaced with the value; omitted if missing
 *   {{#if variable}}...{{/if}}       — section only rendered when the variable
 *                                      is present and non-empty (e.g. optional
 *                                      tracking details).
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
const IF_BLOCK_RE = /\{\{#if\s+([a-zA-Z0-9_]+)\s*\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g;

export function extractVariables(template: string): string[] {
  const vars = new Set<string>();
  for (const match of template.matchAll(VARIABLE_RE)) {
    const v = match[1];
    if (v !== "else") vars.add(v);
  }
  return [...vars];
}

export function renderTemplate(
  template: string,
  variables: TemplateVariables
): string {
  let out = template.replace(IF_BLOCK_RE, (_full, key: string, thenBody: string, elseBody?: string) => {
    const value = variables[key];
    const present = value !== undefined && value !== null && String(value).trim() !== "";
    return present ? thenBody : (elseBody ?? "");
  });
  out = out.replace(VARIABLE_RE, (_full, key: string) => {
    const value = variables[key];
    if (value === undefined || value === null) return "";
    return String(value);
  });
  return out.trim();
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
    title: "طلب جديد",
    body: "مرحبًا {{store_name}}، تم استلام طلب جديد رقم {{order_number}} بقيمة {{order_total}} ر.س من {{customer_name}}.",
    severity: "info",
    category: "orders",
    channels: ["in_app", "email"],
  },
  {
    event_type: "order.payment_success",
    name: "تم الدفع",
    title: "تم دفع الطلب",
    body: "تم تأكيد دفع طلبك {{order_number}} بقيمة {{order_total}} ر.س بنجاح. شكرًا لثقتك بـ {{store_name}}.",
    severity: "success",
    category: "payment",
    channels: ["in_app", "email", "sms"],
  },
  {
    event_type: "order.payment_failed",
    name: "فشل الدفع",
    title: "فشل دفع الطلب",
    body: "تعذر إتمام عملية الدفع للطلب {{order_number}} بقيمة {{order_total}} ر.س. يرجى إعادة المحاولة.",
    severity: "critical",
    category: "payment",
    channels: ["in_app", "email", "sms"],
  },
  {
    event_type: "order.cancelled",
    name: "إلغاء الطلب",
    title: "إلغاء الطلب",
    body: "تم إلغاء الطلب {{order_number}}. تواصل مع الدعم على {{support_phone}} لأي استفسار.",
    severity: "warning",
    category: "orders",
    channels: ["in_app", "email"],
  },
  // ---------- Shipping ----------
  {
    event_type: "shipment.created",
    name: "تم إنشاء الشحنة",
    title: "تم شحن طلبك",
    body: "مرحبًا {{customer_name}}، تم شحن طلبك رقم {{order_number}} عبر {{carrier_name}}.{{#if tracking_number}} رقم التتبع: {{tracking_number}}.{{/if}}{{#if tracking_url}} يمكنك تتبع الشحنة عبر: {{tracking_url}}{{/if}}",
    severity: "info",
    category: "shipping",
    channels: ["in_app", "email", "sms"],
  },
  {
    event_type: "shipment.tracking_available",
    name: "رقم التتبع متاح",
    title: "أصبح طلبك قابلًا للتتبع",
    body: "مرحبًا {{customer_name}}، أصبح طلبك رقم {{order_number}} قابلًا للتتبع عبر {{carrier_name}}.{{#if tracking_number}} رقم التتبع: {{tracking_number}}.{{/if}}{{#if tracking_url}} يمكنك تتبع الشحنة عبر: {{tracking_url}}{{/if}}",
    severity: "info",
    category: "shipping",
    channels: ["in_app", "email", "sms"],
  },
  {
    event_type: "shipment.picked_up",
    name: "استلام الشحنة من المتجر",
    title: "تم استلام طلبك من المتجر",
    body: "تم استلام طلبك {{order_number}} من المتجر وبدأت عملية الشحن عبر {{carrier_name}}.",
    severity: "info",
    category: "shipping",
    channels: ["in_app", "email"],
  },
  {
    event_type: "shipment.in_transit",
    name: "الشحنة في الطريق",
    title: "طلبك في الطريق",
    body: "شحنة طلبك {{order_number}} {{#if tracking_number}}في الطريق برقم التتبع {{tracking_number}}{{else}}قيد المعالجة الآن{{/if}}.{{#if tracking_url}} يمكنك تتبعها عبر: {{tracking_url}}{{/if}}",
    severity: "info",
    category: "shipping",
    channels: ["in_app"],
  },
  {
    event_type: "shipment.out_for_delivery",
    name: "الشحنة خرجت للتسليم",
    title: "طلبك خرج للتسليم",
    body: "مرحبًا {{customer_name}}، طلبك {{order_number}} في طريقه إليك الآن. الرجاء تجهيز الاستلام.",
    severity: "info",
    category: "shipping",
    channels: ["in_app", "sms"],
  },
  {
    event_type: "shipment.delivered",
    name: "تم التسليم",
    title: "تم تسليم طلبك",
    body: "مرحبًا {{customer_name}}، تم تسليم طلبك {{order_number}} بنجاح. نتمنى أن يكون كل شيء على ما يرام.",
    severity: "success",
    category: "shipping",
    channels: ["in_app", "email", "sms"],
  },
  {
    event_type: "shipment.delivery_failed",
    name: "فشل محاولة التسليم",
    title: "تعذر تسليم الطلب",
    body: "تعذر تسليم الطلب {{order_number}} عبر {{carrier_name}}. يرجى التواصل معنا على {{support_phone}}.",
    severity: "warning",
    category: "shipping",
    channels: ["in_app", "sms"],
  },
  {
    event_type: "shipment.failed",
    name: "فشل إنشاء الشحنة",
    title: "فشل إنشاء الشحنة",
    body: "فشل إنشاء الشحنة للطلب {{order_number}} عبر {{carrier_name}}. السبب: {{error_message}}",
    severity: "critical",
    category: "shipping",
    channels: ["in_app", "email", "sms"],
  },
  {
    event_type: "shipment.cancelled",
    name: "إلغاء الشحنة",
    title: "إلغاء الشحنة",
    body: "تم إلغاء شحنة الطلب {{order_number}} عبر {{carrier_name}}.",
    severity: "warning",
    category: "shipping",
    channels: ["in_app"],
  },
  {
    event_type: "shipment.on_hold",
    name: "الشحنة معلقة",
    title: "شحنتك معلقة",
    body: "تم تعليق شحنة طلبك {{order_number}} لدى {{carrier_name}}.{{#if error_message}} السبب: {{error_message}}.{{/if}} تواصل معنا على {{support_phone}}.",
    severity: "warning",
    category: "shipping",
    channels: ["in_app", "email", "sms"],
  },
  {
    event_type: "shipment.delayed",
    name: "شحنة متأخرة",
    title: "شحنتك متأخرة",
    body: "تجاوزت شحنة الطلب {{order_number}} عبر {{carrier_name}} موعد التسليم المتوقع. التحديث الحالي: {{shipping_status}}",
    severity: "warning",
    category: "shipping",
    channels: ["in_app", "email"],
  },
  {
    event_type: "shipment.stuck",
    name: "شحنة متوقفة",
    title: "شحنتك متوقفة",
    body: "لا يوجد تحديث لشحنة الطلب {{order_number}} عبر {{carrier_name}} منذ أكثر من 48 ساعة. مطلوب مراجعة.",
    severity: "warning",
    category: "shipping",
    channels: ["in_app", "email"],
  },
  {
    event_type: "shipment.carrier_changed",
    name: "تم تغيير شركة الشحن",
    title: "تحويل الشحنة",
    body: "تم تحويل شحنة الطلب {{order_number}} إلى {{carrier_name}} بسبب فشل الإنشاء لدى الشركة السابقة.",
    severity: "info",
    category: "shipping",
    channels: ["in_app"],
  },
  // ---------- Returns ----------
  {
    event_type: "return.requested",
    name: "طلب استرجاع جديد",
    title: "طلب استرجاع جديد",
    body: "قام {{customer_name}} بطلب استرجاع للطلب {{order_number}}. السبب: {{return_reason}}",
    severity: "info",
    category: "returns",
    channels: ["in_app", "email"],
  },
  {
    event_type: "return.approved",
    name: "تمت الموافقة على الاسترجاع",
    title: "تمت الموافقة على الاسترجاع",
    body: "مرحبًا {{customer_name}}، تمت الموافقة على طلب الاسترجاع الخاص بالطلب {{order_number}}.",
    severity: "success",
    category: "returns",
    channels: ["in_app", "email", "sms"],
  },
  {
    event_type: "return.created",
    name: "تم إنشاء شحنة المرتجع",
    title: "تم إنشاء شحنة المرتجع",
    body: "تم إنشاء شحنة المرتجع للطلب {{order_number}} عبر {{carrier_name}}.",
    severity: "info",
    category: "returns",
    channels: ["in_app"],
  },
  {
    event_type: "return.received",
    name: "تم استلام المرتجع",
    title: "تم استلام المرتجع",
    body: "تم استلام المرتجع الخاص بالطلب {{order_number}}. جاري الفحص.",
    severity: "info",
    category: "returns",
    channels: ["in_app"],
  },
  {
    event_type: "return.refunded",
    name: "تم رد المبلغ",
    title: "تم رد المبلغ",
    body: "مرحبًا {{customer_name}}، تم رد مبلغ الطلب {{order_number}} بنجاح.",
    severity: "success",
    category: "returns",
    channels: ["in_app", "email", "sms"],
  },
  {
    event_type: "return.rejected",
    name: "رفض الاسترجاع",
    title: "رفض الاسترجاع",
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

/**
 * Templates shown to the customer when the built-in/admin template is written
 * for the store's internal audience (e.g. "new order received"). The customer
 * gets a personal, customer-facing message instead.
 */
export const CUSTOMER_TEMPLATE_OVERRIDES: Record<string, { title: string; body: string }> = {
  "order.created": {
    title: "تم استلام طلبك",
    body: "مرحبًا {{customer_name}}، تم استلام طلبك رقم {{order_number}} بقيمة {{order_total}} ر.س. سنراجع طلبك ونتواصل معك قريبًا.",
  },
  "return.requested": {
    title: "تم إرسال طلب الاسترجاع",
    body: "مرحبًا {{customer_name}}، تم استلام طلب الاسترجاع الخاص بالطلب {{order_number}}. سنراجعه ونبلغك بالنتيجة.",
  },
};

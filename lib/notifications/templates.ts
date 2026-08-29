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
  // ---------- Orders (Admin) ----------
  {
    event_type: "order.created",
    name: "طلب جديد",
    title: "طلب جديد #{{order_number}}",
    body: "تم استلام طلب جديد رقم #{{order_number}} بقيمة {{order_total}} ر.س من {{customer_name}}.",
    severity: "info",
    category: "orders",
    channels: ["in_app", "email"],
  },
  {
    event_type: "order.payment_success",
    name: "تم الدفع",
    title: "تأكيد دفع — طلب #{{order_number}}",
    body: "تم تأكيد دفع الطلب #{{order_number}} بقيمة {{order_total}} ر.س. يمكن الآن تجهيز الشحنة.",
    severity: "success",
    category: "payment",
    channels: ["in_app", "email", "sms"],
  },
  {
    event_type: "order.payment_failed",
    name: "فشل الدفع",
    title: "فشل دفع — طلب #{{order_number}}",
    body: "تعذر إتمام عملية الدفع للطلب #{{order_number}} بقيمة {{order_total}} ر.س.{{#if error_message}} السبب: {{error_message}}{{/if}}",
    severity: "critical",
    category: "payment",
    channels: ["in_app", "email", "sms"],
  },
  {
    event_type: "order.status_changed",
    name: "تحديث حالة الطلب",
    title: "تحديث حالة — طلب #{{order_number}}",
    body: "تم تحديث حالة الطلب #{{order_number}} إلى {{status_label}}.",
    severity: "info",
    category: "orders",
    channels: ["in_app"],
  },
  {
    event_type: "order.cancelled",
    name: "إلغاء الطلب",
    title: "إلغاء — طلب #{{order_number}}",
    body: "تم إلغاء الطلب #{{order_number}} من قبل {{customer_name}}.",
    severity: "warning",
    category: "orders",
    channels: ["in_app", "email"],
  },
  // ---------- Shipping (Admin) ----------
  {
    event_type: "shipment.created",
    name: "إنشاء شحنة",
    title: "شحنة جديدة — طلب #{{order_number}}",
    body: "تم إنشاء شحنة للطلب #{{order_number}} عبر {{carrier_name}}.{{#if tracking_number}} رقم التتبع: {{tracking_number}}.{{/if}}{{#if tracking_url}} رابط التتبع: {{tracking_url}}{{/if}}",
    severity: "info",
    category: "shipping",
    channels: ["in_app", "email", "sms"],
  },
  {
    event_type: "shipment.tracking_available",
    name: "رقم التتبع متاح",
    title: "تتبع متاح — طلب #{{order_number}}",
    body: "أصبح رقم التتبع متاحًا للطلب #{{order_number}} عبر {{carrier_name}}.{{#if tracking_number}} رقم التتبع: {{tracking_number}}.{{/if}}{{#if tracking_url}} رابط التتبع: {{tracking_url}}{{/if}}",
    severity: "info",
    category: "shipping",
    channels: ["in_app", "email", "sms"],
  },
  {
    event_type: "shipment.picked_up",
    name: "استلام الشحنة من المتجر",
    title: "تم الاستلام — طلب #{{order_number}}",
    body: "تم استلام شحنة الطلب #{{order_number}} من المتجر عبر {{carrier_name}}.",
    severity: "info",
    category: "shipping",
    channels: ["in_app", "email"],
  },
  {
    event_type: "shipment.in_transit",
    name: "الشحنة في الطريق",
    title: "في الطريق — طلب #{{order_number}}",
    body: "شحنة الطلب #{{order_number}} عبر {{carrier_name}}{{#if tracking_number}} (تتبع: {{tracking_number}}){{/if}} في حالة {{#if shipping_status}}{{shipping_status}}{{else}}قيد النقل{{/if}}.{{#if tracking_url}} رابط التتبع: {{tracking_url}}{{/if}}",
    severity: "info",
    category: "shipping",
    channels: ["in_app"],
  },
  {
    event_type: "shipment.out_for_delivery",
    name: "خرج للتسليم",
    title: "خرج للتسليم — طلب #{{order_number}}",
    body: "شحنة الطلب #{{order_number}} عبر {{carrier_name}} خرجت للتسليم.",
    severity: "info",
    category: "shipping",
    channels: ["in_app", "sms"],
  },
  {
    event_type: "shipment.delivered",
    name: "تم التسليم",
    title: "تم التسليم — طلب #{{order_number}}",
    body: "تم تسليم الطلب #{{order_number}} بنجاح عبر {{carrier_name}} للعميل {{customer_name}}.",
    severity: "success",
    category: "shipping",
    channels: ["in_app", "email", "sms"],
  },
  {
    event_type: "shipment.delivery_failed",
    name: "فشل محاولة التسليم",
    title: "فشل تسليم — طلب #{{order_number}}",
    body: "فشلت محاولة تسليم الطلب #{{order_number}} عبر {{carrier_name}}.{{#if error_message}} السبب: {{error_message}}.{{/if}} يُرجى المتابعة.",
    severity: "warning",
    category: "shipping",
    channels: ["in_app", "sms"],
  },
  {
    event_type: "shipment.failed",
    name: "فشل إنشاء الشحنة",
    title: "فشل شحنة — طلب #{{order_number}}",
    body: "فشل إنشاء الشحنة للطلب #{{order_number}} عبر {{carrier_name}}.{{#if error_message}} السبب: {{error_message}}.{{/if}}",
    severity: "critical",
    category: "shipping",
    channels: ["in_app", "email", "sms"],
  },
  {
    event_type: "shipment.cancelled",
    name: "إلغاء الشحنة",
    title: "إلغاء شحنة — طلب #{{order_number}}",
    body: "تم إلغاء شحنة الطلب #{{order_number}} عبر {{carrier_name}}.",
    severity: "warning",
    category: "shipping",
    channels: ["in_app"],
  },
  {
    event_type: "shipment.on_hold",
    name: "الشحنة معلقة",
    title: "شحنة معلقة — طلب #{{order_number}}",
    body: "شحنة الطلب #{{order_number}} معلقة لدى {{carrier_name}}.{{#if error_message}} السبب: {{error_message}}.{{/if}} يُرجى المتابعة.",
    severity: "warning",
    category: "shipping",
    channels: ["in_app", "email", "sms"],
  },
  {
    event_type: "shipment.delayed",
    name: "شحنة متأخرة",
    title: "تأخير شحنة — طلب #{{order_number}}",
    body: "شحنة الطلب #{{order_number}} عبر {{carrier_name}} تجاوزت موعد التسليم المتوقع. الحالة: {{shipping_status}}",
    severity: "warning",
    category: "shipping",
    channels: ["in_app", "email"],
  },
  {
    event_type: "shipment.stuck",
    name: "شحنة متوقفة",
    title: "شحنة متوقفة — طلب #{{order_number}}",
    body: "لا يوجد تحديث لشحنة الطلب #{{order_number}} عبر {{carrier_name}} منذ أكثر من 48 ساعة. يُرجى المتابعة مع شركة الشحن.",
    severity: "warning",
    category: "shipping",
    channels: ["in_app", "email"],
  },
  {
    event_type: "shipment.carrier_changed",
    name: "تم تغيير شركة الشحن",
    title: "تحويل شحنة — طلب #{{order_number}}",
    body: "تم تحويل شحنة الطلب #{{order_number}} إلى {{carrier_name}} بسبب فشل الإنشاء لدى الشركة السابقة.",
    severity: "info",
    category: "shipping",
    channels: ["in_app"],
  },
  // ---------- Returns (Admin) ----------
  {
    event_type: "return.requested",
    name: "طلب استرجاع جديد",
    title: "طلب استرجاع — طلب #{{order_number}}",
    body: "طلب {{customer_name}} استرجاع للطلب #{{order_number}}. السبب: {{return_reason}}",
    severity: "info",
    category: "returns",
    channels: ["in_app", "email"],
  },
  {
    event_type: "return.approved",
    name: "تمت الموافقة على الاسترجاع",
    title: "موافقة استرجاع — طلب #{{order_number}}",
    body: "تمت الموافقة على استرجاع الطلب #{{order_number}} من {{customer_name}}. يُرجى إنشاء شحنة مرتجع.",
    severity: "success",
    category: "returns",
    channels: ["in_app", "email", "sms"],
  },
  {
    event_type: "return.created",
    name: "إنشاء شحنة مرتجع",
    title: "شحنة مرتجع — طلب #{{order_number}}",
    body: "تم إنشاء شحنة المرتجع للطلب #{{order_number}} عبر {{carrier_name}}.",
    severity: "info",
    category: "returns",
    channels: ["in_app"],
  },
  {
    event_type: "return.received",
    name: "استلام المرتجع",
    title: "تم استلام المرتجع — طلب #{{order_number}}",
    body: "تم استلام مرتجع الطلب #{{order_number}}. يُرجى الفحص وتأكيد الاسترجاع.",
    severity: "info",
    category: "returns",
    channels: ["in_app"],
  },
  {
    event_type: "return.refunded",
    name: "رد المبلغ",
    title: "رد مبلغ — طلب #{{order_number}}",
    body: "تم رد مبلغ الطلب #{{order_number}} بنجاح للعميل {{customer_name}}.",
    severity: "success",
    category: "returns",
    channels: ["in_app", "email", "sms"],
  },
  {
    event_type: "return.rejected",
    name: "رفض الاسترجاع",
    title: "رفض استرجاع — طلب #{{order_number}}",
    body: "تم رفض طلب استرجاع الطلب #{{order_number}} من {{customer_name}}.",
    severity: "warning",
    category: "returns",
    channels: ["in_app", "email"],
  },
  // ---------- System / webhook / security (Admin only) ----------
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
  // ---------- Orders ----------
  "order.created": {
    title: "لقد استلمنا طلبك",
    body: "مرحبًا {{customer_name}}، لقد استلمنا طلبك رقم #{{order_number}} بقيمة {{order_total}} ر.س. جاري مراجعة الطلب وتأكيد التفاصيل معك خلال دقائق.",
  },
  "order.payment_success": {
    title: "تم تأكيد الدفع",
    body: "مرحبًا {{customer_name}}، تم تأكيد الدفع لطلبك رقم #{{order_number}} بقيمة {{order_total}} ر.س. جاري تجهيز الطلب للشحن.",
  },
  "order.status_changed": {
    title: "تم تحديث طلبك",
    body: "مرحبًا {{customer_name}}، تم تحديث حالة طلبك رقم #{{order_number}} إلى «{{status_label}}».",
  },
  "order.payment_failed": {
    title: "لم يتم تأكيد الدفع",
    body: "مرحبًا {{customer_name}}، لم يتم تأكيد الدفع لطلبك رقم #{{order_number}}. يرجى إعادة المحاولة من صفحة \"طلباتي\" في حسابك.",
  },
  "order.cancelled": {
    title: "تم إلغاء طلبك",
    body: "مرحبًا {{customer_name}}، تم إلغاء طلبك رقم #{{order_number}}. إذا كان لديك أي استفسار، يرجى التواصل معنا.",
  },
  // ---------- Shipping ----------
  "shipment.created": {
    title: "تم شحن طلبك",
    body: "مرحبًا {{customer_name}}، تم شحن طلبك رقم #{{order_number}} عبر {{carrier_name}}.{{#if tracking_number}} رقم التتبع: {{tracking_number}}.{{/if}}{{#if tracking_url}} {{tracking_url}}{{/if}}",
  },
  "shipment.tracking_available": {
    title: "رقم التتبع متاح",
    body: "مرحبًا {{customer_name}}، أصبح رقم التتبع متاحًا لطلبك رقم #{{order_number}} عبر {{carrier_name}}.{{#if tracking_number}} رقم التتبع: {{tracking_number}}{{/if}}",
  },
  "shipment.picked_up": {
    title: "تم استلام الشحنة",
    body: "مرحبًا {{customer_name}}، لقد استلمنا شحنة طلبك رقم #{{order_number}} من المتجر. بدأت الشحنة رحلتها إليك عبر {{carrier_name}}.",
  },
  "shipment.in_transit": {
    title: "شحنتك في الطريق",
    body: "مرحبًا {{customer_name}}، شحنة طلبك رقم #{{order_number}}{{#if tracking_number}} (رقم التتبع: {{tracking_number}}){{/if}} جاري نقلها إليك.{{#if tracking_url}} تتبع الشحنة: {{tracking_url}}{{/if}}",
  },
  "shipment.out_for_delivery": {
    title: "شحنتك في طريقها إليك",
    body: "مرحبًا {{customer_name}}، شحنة طلبك رقم #{{order_number}} خرجت للتسليم وستصل إليك اليوم. يرجى التأكد من توفرك للاستلام.",
  },
  "shipment.delivered": {
    title: "تم تسليم طلبك بنجاح",
    body: "مرحبًا {{customer_name}}، تم تسليم طلبك رقم #{{order_number}} بنجاح. نتمنى أن تكون تجربتك مع متجر لمعة للاكسسوارات المطلية مميزة.",
  },
  "shipment.delivery_failed": {
    title: "تعذر تسليم الطلب",
    body: "مرحبًا {{customer_name}}، تعذر تسليم طلبك رقم #{{order_number}} اليوم. يرجى التواصل معنا لإعادة جدولة موعد التسليم.",
  },
  "shipment.failed": {
    title: "مشكلة في الشحن",
    body: "مرحبًا {{customer_name}}، حدثت مشكلة أثناء شحن طلبك رقم #{{order_number}}. جاري معالجة الأمر وسنبلغك بالتحديث قريباً.",
  },
  "shipment.cancelled": {
    title: "تم إلغاء الشحنة",
    body: "مرحبًا {{customer_name}}، تم إلغاء شحنة طلبك رقم #{{order_number}}. يرجى التواصل معنا لمزيد من التفاصيل.",
  },
  "shipment.on_hold": {
    title: "شحنتك معلقة مؤقتاً",
    body: "مرحبًا {{customer_name}}، شحنة طلبك رقم #{{order_number}} معلقة مؤقتاً. جاري متابعة الوضع وسنبلغك بأي تحديث فوري.",
  },
  "shipment.delayed": {
    title: "تأخير في التوصيل",
    body: "مرحبًا {{customer_name}}، هناك تأخير بسيط في وصول شحنة طلبك رقم #{{order_number}}. نعتذر عن هذا الإزعاج ونعمل على إتمام التوصيل بأسرع وقت.",
  },
  "shipment.stuck": {
    title: "تأخر غير عادي في الشحنة",
    body: "مرحبًا {{customer_name}}، هناك تأخر غير عادي في شحنة طلبك رقم #{{order_number}}. جاري التواصل مع شركة الشحن لمتابعة الوضع وإبلاغك بالتحديث.",
  },
  "shipment.carrier_changed": {
    title: "تم تحويل شحنتك",
    body: "مرحبًا {{customer_name}}، تم تحويل شحنة طلبك رقم #{{order_number}} إلى {{carrier_name}} لضمان وصولها إليك بأسرع وقت ممكن.",
  },
  // ---------- Returns ----------
  "return.requested": {
    title: "تم استلام طلب الاسترجاع",
    body: "مرحبًا {{customer_name}}، تم استلام طلب استرجاعك للطلب #{{order_number}}. سنراجع طلبك ونبلغك بالنتيجة خلال أيام قليلة.",
  },
  "return.approved": {
    title: "تمت الموافقة على الاسترجاع",
    body: "مرحبًا {{customer_name}}، تمت الموافقة على طلب استرجاع الطلب #{{order_number}}. جاري تجهيز شحنة المرتجع.",
  },
  "return.created": {
    title: "شحنة المرتجع جاهزة",
    body: "مرحبًا {{customer_name}}، تم إنشاء شحنة المرتجع للطلب #{{order_number}} عبر {{carrier_name}}. يرجى تجهيز وإرسال المنتج.",
  },
  "return.received": {
    title: "تم استلام المرتجع",
    body: "مرحبًا {{customer_name}}، تم استلام المرتجع للطلب #{{order_number}}. جاري فحص المنتج وتأكيد إتمام الاسترجاع.",
  },
  "return.refunded": {
    title: "تم رد المبلغ",
    body: "مرحبًا {{customer_name}}، تم رد مبلغ طلبك رقم #{{order_number}} بنجاح. سيظهر المبلغ في حسابك المالي خلال أيام قليلة.",
  },
  "return.rejected": {
    title: "تم رفض طلب الاسترجاع",
    body: "مرحبًا {{customer_name}}، لم تتوفر شروط الموافقة على استرجاع الطلب #{{order_number}}. يرجى التواصل معنا لمعرفة التفاصيل.",
  },
};

import type { Rule, ChannelCode } from "./types";

/**
 * Rule Engine — decides which channels + recipients an event goes to.
 * Rules are stored in notification_rules; built-ins are the seed defaults
 * used when no rule exists for an event type.
 */

export const BUILT_IN_RULES: Omit<Rule, "is_active">[] = [
  { event_type: "order.created", name: "طلب جديد", condition: {}, channels: ["in_app", "email"], recipients: ["admin"] },
  { event_type: "order.payment_success", name: "تم الدفع", condition: {}, channels: ["in_app", "email", "sms"], recipients: ["admin", "finance"] },
  { event_type: "order.payment_failed", name: "فشل الدفع", condition: {}, channels: ["in_app", "email", "sms"], recipients: ["admin", "finance"] },
  { event_type: "order.cancelled", name: "إلغاء الطلب", condition: {}, channels: ["in_app"], recipients: ["admin"] },
  { event_type: "shipment.created", name: "تم إنشاء الشحنة", condition: {}, channels: ["in_app", "email", "sms"], recipients: ["admin"] },
  { event_type: "shipment.picked_up", name: "تم الاستلام", condition: {}, channels: ["in_app"], recipients: ["admin"] },
  { event_type: "shipment.in_transit", name: "في الطريق", condition: {}, channels: ["in_app"], recipients: ["admin"] },
  { event_type: "shipment.out_for_delivery", name: "خرج للتسليم", condition: {}, channels: ["in_app", "sms"], recipients: ["admin", "shipping_manager"] },
  { event_type: "shipment.delivered", name: "تم التسليم", condition: {}, channels: ["in_app", "email", "sms"], recipients: ["admin"] },
  { event_type: "shipment.delivery_failed", name: "فشل التسليم", condition: {}, channels: ["in_app", "sms"], recipients: ["admin", "shipping_manager"] },
  { event_type: "shipment.failed", name: "فشل إنشاء الشحنة", condition: {}, channels: ["in_app", "email", "sms"], recipients: ["admin", "shipping_manager"] },
  { event_type: "shipment.cancelled", name: "إلغاء الشحنة", condition: {}, channels: ["in_app"], recipients: ["admin"] },
  { event_type: "shipment.delayed", name: "شحنة متأخرة", condition: {}, channels: ["in_app", "email"], recipients: ["admin", "shipping_manager"] },
  { event_type: "shipment.stuck", name: "شحنة متوقفة", condition: {}, channels: ["in_app", "email"], recipients: ["admin", "shipping_manager"] },
  { event_type: "shipment.carrier_changed", name: "تغيير شركة الشحن", condition: {}, channels: ["in_app"], recipients: ["admin", "shipping_manager"] },
  { event_type: "return.requested", name: "طلب استرجاع", condition: {}, channels: ["in_app", "email"], recipients: ["admin"] },
  { event_type: "return.approved", name: "موافقة استرجاع", condition: {}, channels: ["in_app", "email", "sms"], recipients: ["admin"] },
  { event_type: "return.created", name: "شحنة مرتجع", condition: {}, channels: ["in_app"], recipients: ["admin"] },
  { event_type: "return.received", name: "استلام مرتجع", condition: {}, channels: ["in_app"], recipients: ["admin"] },
  { event_type: "return.refunded", name: "رد المبلغ", condition: {}, channels: ["in_app", "email", "sms"], recipients: ["admin", "finance"] },
  { event_type: "return.rejected", name: "رفض استرجاع", condition: {}, channels: ["in_app"], recipients: ["admin"] },
  { event_type: "webhook.failed", name: "فشل Webhook", condition: {}, channels: ["in_app", "email"], recipients: ["admin"] },
  { event_type: "oto.api_error", name: "خطأ OTO", condition: {}, channels: ["in_app", "email"], recipients: ["admin"] },
  { event_type: "notification.failed", name: "فشل إشعار", condition: {}, channels: ["in_app", "email"], recipients: ["admin"] },
  { event_type: "system.error", name: "خطأ النظام", condition: {}, channels: ["in_app", "email"], recipients: ["admin"] },
  { event_type: "security.alert", name: "تنبيه أمني", condition: {}, channels: ["in_app", "email"], recipients: ["admin"] },
];

export function matchRule(rule: Rule, variables: Record<string, unknown>): boolean {
  const cond = rule.condition || {};
  for (const [key, expected] of Object.entries(cond)) {
    const actual = variables[key];
    if (Array.isArray(expected)) {
      if (!expected.includes(actual)) return false;
    } else if (actual !== expected) {
      return false;
    }
  }
  return true;
}

export function resolveChannels(
  eventType: string,
  rules: Rule[],
  templateChannels: ChannelCode[],
  variables: Record<string, unknown>,
  enabledChannels: ChannelCode[]
): ChannelCode[] {
  const rule = rules.find((r) => r.event_type === eventType && r.is_active && matchRule(r, variables));
  const chosen = rule ? rule.channels : templateChannels;
  return Array.from(new Set(chosen.filter((c) => enabledChannels.includes(c))));
}

export function builtInRuleFor(eventType: string): Omit<Rule, "is_active"> | undefined {
  return BUILT_IN_RULES.find((r) => r.event_type === eventType);
}

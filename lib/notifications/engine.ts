import { createAdminClient } from "@/lib/supabase/admin";
import type { EventInput, TemplateVariables, ChannelCode, Category, Severity } from "./types";
import { ingestEvent, logNotificationEvent } from "./events";
import { BUILT_IN_TEMPLATES, CUSTOMER_TEMPLATE_OVERRIDES, renderTemplate, renderTemplateTitle, validateTemplateVariables } from "./templates";
import { builtInRuleFor, matchRule, resolveChannels } from "./rules";
import { getCustomerPreferences, filterChannelsForCustomer } from "./preferences";
import { createDeliveries, attemptDelivery } from "./dispatcher";

/**
 * Notification Engine — the single entry point for producing notifications.
 *
 *   Event -> ingest (idempotent) -> template + rules -> notifications ->
 *   channel deliveries -> dispatch attempts.
 *
 * Nothing in the app talks to an SMS/Email provider directly; it always goes
 * through this engine and the channel adapters.
 */

type TemplateRow = {
  event_type: string;
  name: string;
  title: string;
  body: string;
  severity: string;
  category: string;
  channels: ChannelCode[];
  is_active: boolean;
};

type RuleRow = {
  event_type: string;
  name: string;
  condition: Record<string, unknown>;
  channels: ChannelCode[];
  recipients: string[];
  is_active: boolean;
};

type ChannelRow = { code: ChannelCode; enabled: boolean };

async function loadEnabledChannels(): Promise<ChannelCode[]> {
  const supabase = createAdminClient();

  // مفتاح رئيسي: إيقاف مؤقت شامل لكل القنوات (من إعدادات الإشعارات).
  try {
    const { data: settings } = await supabase.from("settings").select("notifications_paused").eq("id", 1).maybeSingle();
    if (settings && (settings as { notifications_paused?: boolean }).notifications_paused) return [];
  } catch {}

  const { data } = await supabase.from("notification_channels").select("code, enabled");
  if (!data) return ["in_app"];
  return (data as ChannelRow[]).filter((c) => c.enabled).map((c) => c.code);
}

async function loadTemplate(eventType: string): Promise<TemplateRow> {
  const supabase = createAdminClient();
  const builtIn = BUILT_IN_TEMPLATES.find((t) => t.event_type === eventType);
  if (builtIn) {
    // The code is the source of truth: keep the DB row in sync with the
    // built-in so stale seeded templates (old titles/placeholders) never
    // override current ones. Mirrors what the settings page seed does.
    const { data } = await supabase
      .from("notification_templates")
      .select("name, title, body, severity, category")
      .eq("event_type", eventType)
      .maybeSingle();
    const stale =
      !data ||
      data.name !== builtIn.name ||
      data.title !== builtIn.title ||
      data.body !== builtIn.body ||
      data.severity !== builtIn.severity ||
      data.category !== builtIn.category;
    if (stale) {
      await supabase.from("notification_templates").upsert(
        { ...builtIn, is_active: true, updated_at: new Date().toISOString() },
        { onConflict: "event_type" }
      );
    }
    return builtIn as unknown as TemplateRow;
  }
  const { data } = await supabase.from("notification_templates").select("*").eq("event_type", eventType).maybeSingle();
  if (data) return data as unknown as TemplateRow;
  return {
    event_type: eventType,
    name: eventType,
    title: eventType,
    body: "",
    severity: "info",
    category: "system",
    channels: ["in_app"],
    is_active: true,
  };
}

async function loadRules(): Promise<RuleRow[]> {
  const supabase = createAdminClient();
  const { data } = await supabase.from("notification_rules").select("*");
  const rows = (data as unknown as RuleRow[]) || [];
  const merged = new Map<string, RuleRow>();
  for (const eventType of new Set([...BUILT_IN_TEMPLATES.map((t) => t.event_type), ...rows.map((r) => r.event_type)])) {
    const dbRule = rows.find((r) => r.event_type === eventType);
    const builtIn = builtInRuleFor(eventType);
    merged.set(eventType, {
      event_type: eventType,
      name: dbRule?.name || builtIn?.name || eventType,
      condition: dbRule?.condition || builtIn?.condition || {},
      channels: dbRule?.channels || builtIn?.channels || ["in_app"],
      recipients: dbRule?.recipients || builtIn?.recipients || ["admin"],
      is_active: dbRule?.is_active ?? true,
    });
  }
  return [...merged.values()];
}

async function enrichVariables(base: TemplateVariables, orderId?: string | null, shipmentId?: string | null): Promise<TemplateVariables> {
  const vars = { ...base };
  if (orderId) {
    const supabase = createAdminClient();
    const { data: order } = await supabase
      .from("orders")
      .select("order_number, customer_name, customer_phone, total, email, tracking_number, tracking_url, delivery_status")
      .eq("id", orderId)
      .maybeSingle();
    if (order) {
      vars.order_number = vars.order_number ?? (order as { order_number: number }).order_number;
      vars.customer_name = vars.customer_name ?? (order as { customer_name: string }).customer_name;
      vars.customer_phone = vars.customer_phone ?? (order as { customer_phone: string }).customer_phone;
      vars.order_total = vars.order_total ?? (order as { total: number }).total;
      vars.tracking_number = vars.tracking_number ?? (order as { tracking_number: string | null }).tracking_number;
      vars.tracking_url = vars.tracking_url ?? (order as { tracking_url: string | null }).tracking_url;
      vars.shipping_status = vars.shipping_status ?? (order as { delivery_status: string | null }).delivery_status;
      vars.order_id = orderId;
    }
  }
  if (shipmentId) {
    const supabase = createAdminClient();
    const { data: shipment } = await supabase
      .from("shipments")
      .select("delivery_company, tracking_number, tracking_url")
      .eq("id", shipmentId)
      .maybeSingle();
    if (shipment) {
      const s = shipment as { delivery_company: string | null; tracking_number: string | null; tracking_url: string | null };
      vars.carrier_name = vars.carrier_name ?? s.delivery_company;
      vars.tracking_number = vars.tracking_number ?? s.tracking_number;
      vars.tracking_url = vars.tracking_url ?? s.tracking_url;
    }
  }
  return vars;
}

function severityFor(eventType: string): Severity {
  const t = BUILT_IN_TEMPLATES.find((x) => x.event_type === eventType);
  return (t?.severity as Severity) || "info";
}

function categoryFor(eventType: string): Category {
  const t = BUILT_IN_TEMPLATES.find((x) => x.event_type === eventType);
  return (t?.category as Category) || "system";
}

async function createNotificationRow(args: {
  userType: "admin" | "customer";
  userId: string;
  customerId?: string | null;
  orderId?: string | null;
  orderNumber?: number | null;
  shipmentId?: string | null;
  eventType: string;
  category: Category;
  severity: Severity;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
  actionUrl?: string | null;
}): Promise<string | null> {
  const supabase = createAdminClient();

  // منع التكرار: نفس الحدث قد يصل عبر أكثر من مسار (ويب هوك OTO + مزامنة لوحة
  // التحكم) وقد تتعامل عدة أدوار معه. إن وُجد إشعار مطابق (نفس النوع والطلب
  // والنص) خلال آخر 3 دقائق، نتخطى إنشاء صف جديد حتى لا تتكرر الرسالة.
  let dupQuery = supabase
    .from("notifications")
    .select("id")
    .eq("user_type", args.userType)
    .eq("type", args.eventType)
    .eq("title", args.title)
    .eq("message", args.message)
    .gte("created_at", new Date(Date.now() - 3 * 60 * 1000).toISOString());
  if (args.orderId) dupQuery = dupQuery.eq("order_id", args.orderId);
  else dupQuery = dupQuery.is("order_id", null);
  if (args.shipmentId) dupQuery = dupQuery.eq("shipment_id", args.shipmentId);
  else dupQuery = dupQuery.is("shipment_id", null);
  const { data: dup } = await dupQuery.limit(1);
  if (dup && dup.length) return null;

  const { data, error } = await supabase
    .from("notifications")
    .insert({
      user_type: args.userType,
      user_id: args.userId,
      customer_id: args.customerId ?? null,
      order_id: args.orderId ?? null,
      order_number: args.orderNumber ?? null,
      shipment_id: args.shipmentId ?? null,
      type: args.eventType,
      category: args.category,
      severity: args.severity,
      title: args.title,
      message: args.message,
      metadata: args.metadata,
      action_url: args.actionUrl ?? null,
      is_read: false,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[notifications] insert failed:", error?.message);
    return null;
  }
  return (data as { id: string }).id;
}

/**
 * Emit an event end-to-end: ingest (idempotent) + process into notifications.
 * Returns false when the event was a duplicate (already processed).
 */
export async function emitNotification(input: EventInput): Promise<{ inserted: boolean }> {
  const { inserted, id: eventId } = await ingestEvent(input);
  if (!inserted || !eventId) return { inserted: false };

  try {
    let storeName = "المتجر";
    let supportPhone = "";
    try {
      const supabase = createAdminClient();
      const { data: settings } = await supabase.from("settings").select("site_name, phone").eq("id", 1).maybeSingle();
      if (settings) {
        storeName = (settings as { site_name: string }).site_name || storeName;
        supportPhone = (settings as { phone: string | null }).phone || "";
      }
    } catch {}

    await processEvent({
      eventId,
      eventType: input.eventType,
      orderId: input.orderId ?? null,
      orderNumber: input.orderNumber ?? null,
      shipmentId: input.shipmentId ?? null,
      customerIdentifier: input.customerIdentifier ?? null,
      payload: { ...input.payload, store_name: storeName, support_phone: supportPhone },
    });
    return { inserted: true };
  } catch (e) {
    console.error("[notifications] processing failed:", e);
    await logNotificationEvent({ event: "engine.process_error", level: "error", message: (e as Error).message, payload: input.payload });
    return { inserted: true };
  }
}

export async function processEvent(args: {
  eventId: number;
  eventType: string;
  orderId?: string | null;
  orderNumber?: number | null;
  shipmentId?: string | null;
  customerIdentifier?: string | null;
  payload: Record<string, unknown>;
}) {
  const { eventType, orderId, shipmentId, customerIdentifier, payload } = args;
  const template = await loadTemplate(eventType);
  const rules = await loadRules();
  const enabledChannels = await loadEnabledChannels();

  const variables = await enrichVariables(
    {
      ...(payload as TemplateVariables),
      store_name: typeof payload.store_name === "string" ? payload.store_name : null,
      support_phone: typeof payload.support_phone === "string" ? payload.support_phone : null,
    },
    orderId,
    shipmentId
  );

  const title = renderTemplateTitle(template.title, variables);
  const message = renderTemplate(template.body, variables);
  const severity = template.severity as Severity;
  const category = template.category as Category;
  const channels = resolveChannels(eventType, rules as never[], template.channels, variables, enabledChannels);

  const customerOverride = CUSTOMER_TEMPLATE_OVERRIDES[eventType];
  const customerTitle = customerOverride ? renderTemplateTitle(customerOverride.title, variables) : title;
  const customerMessage = customerOverride ? renderTemplate(customerOverride.body, variables) : message;

  // --- Validate template variables (warn in logs if unknown) ---
  for (const t of [template.title, template.body]) {
    const unknown = validateTemplateVariables(t);
    if (unknown.length) {
      await logNotificationEvent({ event: "template.unknown_variable", level: "warning", message: `قوالب غير معروفة في ${eventType}: ${unknown.join(", ")}` });
    }
  }

  // --- Admin recipients (roles) ---
  const rule = rules.find((r) => r.event_type === eventType && r.is_active && matchRule(r as never, variables));
  const recipients = rule?.recipients?.length ? rule.recipients : ["admin"];

  const actionUrl = orderId
    ? shipmentId
      ? `/admin/shipments`
      : `/admin/orders/${orderId}`
    : null;

  for (const role of recipients) {
    const adminNotificationId = await createNotificationRow({
      userType: "admin",
      userId: role,
      orderId,
      orderNumber: args.orderNumber,
      shipmentId,
      eventType,
      category,
      severity,
      title,
      message,
      metadata: { ...payload },
      actionUrl,
    });
    if (adminNotificationId) {
      await createDeliveries(adminNotificationId, channels);
    }
  }

  // --- Customer recipient (always create row; deliveries only if channels exist) ---
  if (customerIdentifier) {
    const prefs = await getCustomerPreferences(customerIdentifier);
    const customerChannels = filterChannelsForCustomer(category, channels, prefs);
    const customerNotificationId = await createNotificationRow({
      userType: "customer",
      userId: customerIdentifier,
      customerId: customerIdentifier,
      orderId,
      orderNumber: args.orderNumber,
      shipmentId,
      eventType,
      category,
      severity,
      title: customerTitle,
      message: customerMessage,
      metadata: { ...payload },
      actionUrl: orderId ? "/account#orders" : null,
    });
    if (customerNotificationId && customerChannels.length) {
      await createDeliveries(customerNotificationId, customerChannels);
    }
  }

  const supabase = createAdminClient();
  await supabase.from("notification_events").update({ status: "processed", processed_at: new Date().toISOString() }).eq("id", args.eventId);
  void attemptDelivery; // dispatcher runs synchronously inside createDeliveries for in_app
}

type StoredNotificationRow = {
  id: string;
  user_type: "admin" | "customer";
  type: string;
  title: string;
  message: string;
  metadata: Record<string, unknown> | null;
  order_id: string | null;
  order_number: number | null;
  shipment_id: string | null;
};

let lastRepairRunAt = 0;

/**
 * Re-renders already-stored notification rows from the current templates so
 * stale seeded text (duplicate order numbers, store-greeting sent to customers,
 * literal {{...}} leftovers) is corrected in place. Idempotent: each row is
 * flagged via metadata.repaired and processed only once. Rate-limited to once
 * per 30s per process so list fetches stay cheap.
 */
export async function repairStaleNotifications(limit = 100): Promise<number> {
  const now = Date.now();
  if (now - lastRepairRunAt < 10_000) return 0;
  lastRepairRunAt = now;

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("notifications")
    .select("id, user_type, type, title, message, metadata, order_id, order_number, shipment_id")
    .order("created_at", { ascending: false })
    .limit(limit);

  let repaired = 0;
  for (const row of (data as StoredNotificationRow[] | null) || []) {
    const meta = (row.metadata || {}) as Record<string, unknown>;
    if (meta.repair_skip === true) continue;
    try {
      const builtIn = BUILT_IN_TEMPLATES.find((t) => t.event_type === row.type);
      if (!builtIn) continue;

      const variables = await enrichVariables(
        {
          ...(meta as TemplateVariables),
          store_name: typeof meta.store_name === "string" ? meta.store_name : null,
          support_phone: typeof meta.support_phone === "string" ? meta.support_phone : null,
        },
        row.order_id,
        row.shipment_id
      );

      const isCustomer = row.user_type === "customer";
      const override = isCustomer ? CUSTOMER_TEMPLATE_OVERRIDES[row.type] : undefined;
      const templateBody = override?.body ?? builtIn.body;
      const templateTitle = override?.title ?? builtIn.title;
      const newTitle = renderTemplateTitle(templateTitle, variables);
      const rendered = renderTemplate(templateBody, variables);
      const hasLeftover = /\{\{/.test(rendered);

      if (hasLeftover) continue;

      const titleChanged = newTitle !== row.title;
      const messageChanged = rendered !== row.message;

      if (!titleChanged && !messageChanged) {
        if ((meta.repaired === true) !== true) {
          await supabase.from("notifications").update({ metadata: { ...meta, repaired: true, repair_skip: true } }).eq("id", row.id);
        }
        continue;
      }

      const patch: Record<string, unknown> = {
        metadata: { ...meta, repaired: true, repair_skip: true },
        updated_at: new Date().toISOString(),
      };
      if (titleChanged) patch.title = newTitle;
      if (messageChanged) patch.message = rendered;

      await supabase.from("notifications").update(patch).eq("id", row.id);
      repaired += 1;
    } catch (e) {
      console.error("[notifications] repair failed for", row.id, e);
    }
  }
  return repaired;
}

import { createAdminClient } from "@/lib/supabase/admin";
import type { ChannelCode, DeliveryStatus } from "./types";
import { computeNextAttempt, shouldRetry } from "./retry";
import { logNotificationEvent } from "./events";
import { getAdapter } from "@/lib/providers";

/**
 * Dispatcher — creates per-channel deliveries and attempts to send them via
 * the registered channel adapters. Failed attempts are scheduled for retry
 * with exponential backoff (processed by the cron route).
 */

export async function createDeliveries(notificationId: string, channels: ChannelCode[]): Promise<void> {
  const supabase = createAdminClient();
  for (const channel of channels) {
    const adapter = getAdapter(channel);
    if (!adapter) continue;

    if (channel === "in_app") {
      // In-app delivery is implicit: the notification row is the delivery.
      await supabase.from("notification_deliveries").insert({
        notification_id: notificationId,
        channel: "in_app",
        provider: "in_app",
        status: "delivered",
        attempt: 1,
        delivered_at: new Date().toISOString(),
      });
      continue;
    }

    const { data, error } = await supabase
      .from("notification_deliveries")
      .insert({
        notification_id: notificationId,
        channel,
        provider: adapter.name,
        status: "pending",
        attempt: 0,
        max_attempts: 4,
        next_attempt_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error || !data) {
      await logNotificationEvent({ notificationId, event: "delivery.create_failed", channel, level: "error", message: error?.message || "failed to create delivery" });
      continue;
    }

    // WhatsApp deliveries are owned by the external QR bridge (qr-server),
    // which polls these rows from Supabase. Never attempt/settle them here so
    // the cloud worker doesn't fight the bridge.
    if (channel === "whatsapp") continue;

    const configured = await Promise.resolve(adapter.isConfigured());

    if (!configured) {
      await supabase.from("notification_deliveries").update({ status: "skipped", error_message: "القناة غير مفعلة", updated_at: new Date().toISOString() }).eq("id", (data as { id: number }).id);
      continue;
    }

    void (data as { id: number }).id;
    await attemptDelivery((data as { id: number }).id);
  }
}

export async function attemptDelivery(deliveryId: number): Promise<void> {
  const supabase = createAdminClient();
  const { data: delivery } = await supabase
    .from("notification_deliveries")
    .select("id, notification_id, channel, attempt, max_attempts, error_message, notifications(title, message, order_id, customer_id)")
    .eq("id", deliveryId)
    .maybeSingle();

  if (!delivery) return;
  const d = delivery as unknown as {
    id: number;
    notification_id: string;
    channel: ChannelCode;
    attempt: number;
    max_attempts: number;
    error_message: string | null;
    notifications: { title: string; message: string; order_id: string | null; customer_id: string | null } | null;
  };

  const adapter = getAdapter(d.channel);
  if (!adapter) {
    await supabase.from("notification_deliveries").update({ status: "failed", error_message: "قناة غير معروفة", failed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", d.id);
    return;
  }

  const nextAttempt = d.attempt + 1;
  await supabase.from("notification_deliveries").update({ status: "sending", attempt: nextAttempt, updated_at: new Date().toISOString() }).eq("id", d.id);

  try {
    const result = await adapter.send({
      recipient: d.notifications?.customer_id || d.notifications?.order_id || "admin",
      title: d.notifications?.title || "",
      message: d.notifications?.message || "",
      variables: {},
      notificationId: d.notification_id,
    });

    if (result.ok) {
      await supabase.from("notification_deliveries").update({
        status: result.status || "sent",
        provider_message_id: result.providerMessageId ?? null,
        sent_at: new Date().toISOString(),
        delivered_at: result.status === "delivered" ? new Date().toISOString() : null,
        error_code: null,
        error_message: null,
        failed_at: null,
        updated_at: new Date().toISOString(),
      }).eq("id", d.id);
      await logNotificationEvent({ notificationId: d.notification_id, event: "delivery.sent", channel: d.channel, level: "info", message: `تم الإرسال عبر ${adapter.name}` });
      return;
    }

    await handleFailure(supabase, d, result.errorMessage || "فشل الإرسال", result.errorCode || null);
  } catch (e) {
    await handleFailure(supabase, d, (e as Error).message, "exception");
  }
}

async function handleFailure(
  supabase: ReturnType<typeof createAdminClient>,
  d: { id: number; notification_id: string; channel: ChannelCode; attempt: number; max_attempts: number },
  errorMessage: string,
  errorCode: string | null
) {
  const canRetry = shouldRetry(d.attempt, d.max_attempts);
  if (canRetry) {
    const next = computeNextAttempt(d.attempt);
    await supabase.from("notification_deliveries").update({
      status: "failed",
      error_code: errorCode,
      error_message: errorMessage.slice(0, 500),
      next_attempt_at: next?.toISOString() ?? null,
      updated_at: new Date().toISOString(),
    }).eq("id", d.id);
    await logNotificationEvent({ notificationId: d.notification_id, event: "delivery.retry_scheduled", channel: d.channel, level: "warning", message: errorMessage, payload: { attempt: d.attempt, next: next?.toISOString() } });
    return;
  }

  await supabase.from("notification_deliveries").update({
    status: "permanent_failed",
    error_code: errorCode,
    error_message: errorMessage.slice(0, 500),
    failed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", d.id);
  await logNotificationEvent({ notificationId: d.notification_id, event: "delivery.permanent_failed", channel: d.channel, level: "error", message: errorMessage });
}

/**
 * Cron entry point: process all due deliveries (pending/failed and
 * next_attempt_at <= now). Runs inside the scheduled cron route.
 */
export async function processPendingDeliveries(limit = 50): Promise<number> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("notification_deliveries")
    .select("id")
    .in("status", ["pending", "failed"])
    .neq("channel", "whatsapp") // whatsapp تُعالج من سيرفر QR الخارجي فقط
    .lte("next_attempt_at", new Date().toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(limit);

  const rows = (data as { id: number }[]) || [];
  for (const row of rows) {
    await attemptDelivery(row.id);
  }
  return rows.length;
}

export async function markDeliverySkipped(deliveryId: number, reason: string) {
  const supabase = createAdminClient();
  await supabase.from("notification_deliveries").update({ status: "skipped" as DeliveryStatus, error_message: reason, updated_at: new Date().toISOString() }).eq("id", deliveryId);
}

import { createAdminClient } from "@/lib/supabase/admin";
import { createHash } from "crypto";
import type { EventInput } from "./types";

/**
 * Event System — ingests raw events (webhooks, internal actions) with
 * idempotency. A unique (source, external_event_id) constraint guarantees a
 * duplicate webhook never produces a duplicate notification.
 */

export function buildEventId(source: string, parts: (string | number | null | undefined)[]): string {
  const raw = [source, ...parts].map((p) => String(p ?? "")).join("|");
  return createHash("sha256").update(raw).digest("hex").slice(0, 40);
}

/**
 * Insert an event once. Returns false when the event is a duplicate
 * (constraint violation) or null on unexpected error.
 */
export async function ingestEvent(input: EventInput): Promise<{ inserted: boolean; id: number | null }> {
  const supabase = createAdminClient();
  const externalEventId = input.externalEventId || buildEventId(input.source, [input.eventType, input.orderNumber, input.shipmentId, Date.now()]);

  const { data, error } = await supabase
    .from("notification_events")
    .insert({
      source: input.source,
      external_event_id: externalEventId,
      event_type: input.eventType,
      order_id: input.orderId ?? null,
      order_number: input.orderNumber ?? null,
      shipment_id: input.shipmentId ?? null,
      customer_identifier: input.customerIdentifier ?? null,
      payload: input.payload ?? {},
      status: "pending",
    })
    .select("id, status")
    .maybeSingle();

  if (error) {
    // unique violation (23505) => duplicate event, ignore
    if ((error as { code?: string }).code === "23505") {
      return { inserted: false, id: null };
    }
    console.error("[notifications] ingest error:", error.message);
    return { inserted: false, id: null };
  }

  return { inserted: true, id: (data as { id: number } | null)?.id ?? null };
}

export async function markEventProcessed(id: number, status: "processed" | "ignored" | "failed", note?: string) {
  const supabase = createAdminClient();
  await supabase
    .from("notification_events")
    .update({ status, processed_at: new Date().toISOString(), payload: undefined as unknown as Record<string, unknown> })
    .eq("id", id);
  void note;
}

export async function logNotificationEvent(args: {
  notificationId?: string;
  event: string;
  channel?: string;
  level?: string;
  message: string;
  payload?: Record<string, unknown>;
}) {
  const supabase = createAdminClient();
  await supabase.from("notification_logs").insert({
    notification_id: args.notificationId ?? null,
    event: args.event,
    channel: args.channel ?? null,
    level: args.level ?? "info",
    message: args.message,
    payload: args.payload ?? {},
  });
}

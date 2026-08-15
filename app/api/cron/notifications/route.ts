import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processPendingDeliveries } from "@/lib/notifications/dispatcher";
import { emitNotification } from "@/lib/notifications/engine";
import { buildEventId, logNotificationEvent } from "@/lib/notifications/events";

export const dynamic = "force-dynamic";

/**
 * POST /api/cron/notifications
 * Called periodically (e.g. every 15 min). Must include `x-cron-secret` header.
 *  1. Retries due deliveries (exponential backoff).
 *  2. Smart delay detection: stuck (>48h no update) and delayed (past ETA).
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const processed = await processPendingDeliveries(50);

  let stuck = 0;
  let delayed = 0;

  try {
    const dayKey = new Date().toISOString().slice(0, 10);
    const cutoff48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    // --- Stuck shipments (in transit, no update for 48h) ---
    const { data: stuckShipments } = await supabase
      .from("shipments")
      .select("id, order_id, delivery_company, tracking_number")
      .eq("status", "in_transit")
      .lte("updated_at", cutoff48h)
      .limit(50);

    for (const s of (stuckShipments || []) as { id: string; order_id: string | null; delivery_company: string | null; tracking_number: string | null }[]) {
      const { inserted } = await emitNotification({
        source: "system",
        externalEventId: buildEventId("stuck", [s.id, dayKey]),
        eventType: "shipment.stuck",
        shipmentId: s.id,
        orderId: s.order_id,
        payload: { carrier_name: s.delivery_company, tracking_number: s.tracking_number, shipping_status: "in_transit" },
      });
      if (inserted) stuck++;
    }

    // --- Delayed shipments (past expected delivery) ---
    const { data: carriers } = await supabase.from("carriers").select("code, estimated_days");
    const estDays = new Map<string, number>();
    for (const c of (carriers || []) as { code: string; estimated_days: number | null }[]) {
      if (c.estimated_days) estDays.set(c.code, c.estimated_days);
    }

    const { data: activeShipments } = await supabase
      .from("shipments")
      .select("id, order_id, delivery_company, tracking_number, status, created_at")
      .in("status", ["in_transit", "processing"])
      .limit(500);

    for (const s of (activeShipments || []) as { id: string; order_id: string | null; delivery_company: string | null; tracking_number: string | null; status: string; created_at: string }[]) {
      const est = 7; // default 7 days
      const expected = new Date(new Date(s.created_at).getTime() + est * 24 * 60 * 60 * 1000);
      if (expected.getTime() < Date.now()) {
        const { inserted } = await emitNotification({
          source: "system",
          externalEventId: buildEventId("delayed", [s.id, dayKey]),
          eventType: "shipment.delayed",
          shipmentId: s.id,
          orderId: s.order_id,
          payload: { carrier_name: s.delivery_company, tracking_number: s.tracking_number, shipping_status: s.status, delivery_date: expected.toISOString() },
        });
        if (inserted) delayed++;
      }
    }
  } catch (e) {
    await logNotificationEvent({ event: "cron.detection_error", level: "error", message: (e as Error).message });
  }

  return NextResponse.json({ success: true, deliveriesProcessed: processed, stuckDetected: stuck, delayedDetected: delayed });
}

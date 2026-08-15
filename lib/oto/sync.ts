import { createAdminClient } from "@/lib/supabase/admin";
import { otoOrderStatus } from "@/lib/oto/client";
import { emitNotification } from "@/lib/notifications/engine";

type SyncRow = {
  id: string;
  order_id: string | null;
  oto_order_id: number | null;
  tracking_number: string | null;
  dc_tracking_number: string | null;
  status: string;
};

function mapStatus(status?: string): string {
  const s = (status || "").toLowerCase();
  if (s.includes("delivered")) return "delivered";
  if (s.includes("return") || s.includes("rto")) return "returned";
  if (s.includes("cancel")) return "cancelled";
  if (s.includes("fail") || s.includes("error")) return "failed";
  if (s.includes("ship") || s.includes("transit") || s.includes("pick") || s.includes("outfordelivery") || s.includes("out for delivery")) return "in_transit";
  return "processing";
}

function mapOrderStatus(status?: string): string {
  const s = (status || "").toLowerCase();
  if (s.includes("delivered")) return "delivered";
  if (s.includes("return")) return "returned";
  if (s.includes("cancel")) return "cancelled";
  if (s.includes("fail")) return "shipping_error";
  return "shipped";
}

function eventTypeFromStatus(status?: string): string | null {
  const s = (status || "").toLowerCase();
  if (s.includes("delivered")) return "shipment.delivered";
  if (s.includes("return") || s.includes("rto")) return "return.received";
  if (s.includes("cancel")) return "shipment.cancelled";
  if (s.includes("outfordelivery") || s.includes("out for delivery")) return "shipment.out_for_delivery";
  if (s.includes("transit") || s.includes("ship") || s.includes("pick")) return "shipment.in_transit";
  if (s.includes("fail")) return "shipment.failed";
  return null;
}

/**
 * Pull live tracking data from OTO for every shipment that has an OTO order id,
 * then update the local shipments + orders rows. Safe to run on page load.
 */
export async function syncOtoShipments(limit = 100): Promise<{ total: number; updated: number; failed: number; skipped: number }> {
  const supabase = createAdminClient();

  // Only sync shipments that are still moving (not delivered/cancelled) or
  // missing tracking details — keeps page loads fast while filling gaps.
  const { data, error } = await supabase
    .from("shipments")
    .select("id, order_id, oto_order_id, tracking_number, dc_tracking_number, status")
    .not("oto_order_id", "is", null)
    .not("status", "in", '("delivered","cancelled","returned")')
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) return { total: 0, updated: 0, failed: 0, skipped: 0 };

  const rows = data as SyncRow[];
  let updated = 0;
  let failed = 0;
  let skipped = 0;

  // Concurrency guard: max 4 parallel OTO calls to avoid slow page loads.
  const CONCURRENCY = 4;
  let cursor = 0;

  async function worker() {
    while (cursor < rows.length) {
      const row = rows[cursor++];
      const otoId = row.oto_order_id;
      if (otoId === null || otoId === undefined) {
        skipped++;
        continue;
      }

      try {
        const info = await otoOrderStatus({ otoId });
        if (!info || info.success === false) {
          failed++;
          continue;
        }

        const tracking = info.trackingNumber || info.dcTrackingNumber || row.tracking_number || null;
        const status = mapStatus(info.status || row.status);
        const eventType = eventTypeFromStatus(info.status || "");
        const externalEventId = `oto.sync.${otoId}.${info.status ?? "status"}.${tracking ?? "x"}`;

        const changed =
          info.trackingNumber !== row.tracking_number ||
          info.dcTrackingNumber !== row.dc_tracking_number ||
          status !== row.status;

        if (changed) {
          const patch: Record<string, unknown> = {
            tracking_number: tracking || undefined,
            dc_tracking_number: info.dcTrackingNumber || info.trackingNumber || undefined,
            tracking_url: info.trackingUrl || undefined,
            branded_tracking_url: info.trackingUrl || undefined,
            print_awb_url: info.printAWBURL || undefined,
            status,
            dc_status: info.dcStatus || info.status || undefined,
            delivery_company: info.deliveryCompany || undefined,
            driver_name: info.driverName || undefined,
            driver_phone: info.driverPhone || undefined,
            updated_at: new Date().toISOString(),
          };

          await supabase.from("shipments").update(patch).eq("id", row.id);
          updated++;

          // Keep order in sync too
          if (row.order_id) {
            await supabase.from("orders").update({
              status: mapOrderStatus(info.status || status),
              tracking_number: tracking || undefined,
              tracking_url: info.trackingUrl || undefined,
            }).eq("id", row.order_id);
          }

          // Notification for state transitions (idempotent by OTO status+tracking)
          if (eventType) {
            await emitNotification({
              source: "oto",
              externalEventId,
              eventType,
              orderId: row.order_id,
              shipmentId: row.id,
              payload: {
                carrier_name: info.deliveryCompany,
                tracking_number: tracking,
                tracking_url: info.trackingUrl,
                shipping_status: info.status,
              },
            });
          }
        }
      } catch {
        failed++;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length || 1) }, worker));

  return { total: rows.length, updated, failed, skipped };
}

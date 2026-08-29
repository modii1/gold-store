import { createAdminClient } from "@/lib/supabase/admin";
import { otoOrderStatus } from "@/lib/oto/client";
import { emitNotification } from "@/lib/notifications/engine";
import { logOrderStatusChange } from "@/lib/orders/status-log";
import { ORDER_STATUS_META } from "@/lib/orders/order-meta";

type SyncRow = {
  id: string;
  order_id: string | null;
  oto_order_id: number | null;
  tracking_number: string | null;
  dc_tracking_number: string | null;
  status: string;
  delivery_company: string | null;
  delivery_option_name: string | null;
};

type OrderInfo = {
  id: string;
  order_number: number | null;
  customer_name?: string | null;
  shipping_method: string | null;
  delivery_option_name: string | null;
  customer_identifier?: string | null;
};

/**
 * Classify a raw OTO status into a coarse local bucket.
 *
 * OTO exposes dozens of granular statuses (shipmentProcessing, outForDelivery,
 * shipmentOnHoldWarehouse, returnShipmentProcessing, ...). Instead of
 * registering each one, we classify by keyword families — mirroring OTO's own
 * dashboard groups (قيد التنفيذ / بانتظار التسليم / جاري الشحن / المعلقة /
 * المرتجعات). Unknown statuses fall back to "processing" so we never guess a
 * wrong bucket, and the raw status is always kept for display.
 */
const OTO_STATUS_KEYWORDS: { bucket: string; keywords: string[] }[] = [
  // Terminal / outcome states first (never ambiguous).
  { bucket: "delivered", keywords: ["delivered", "received-by-customer"] },
  { bucket: "returned", keywords: ["return", "rto", "reverse"] },
  { bucket: "cancelled", keywords: ["cancel", "cancelled"] },
  { bucket: "failed", keywords: ["fail", "error", "notscheduled", "not_scheduled", "unabletoassign", "unable_to_assign"] },
  // On-hold must be checked BEFORE anything containing "ship"/"transit" —
  // e.g. "shipmentOnHoldWarehouse" must not map to in_transit.
  { bucket: "on_hold", keywords: ["onhold", "on_hold", "suspend", "pendingcancel", "pending_cancel", "hold"] },
  // Actually moving towards the customer.
  { bucket: "in_transit", keywords: [
    "outfordelivery", "out for delivery", "out_for_delivery",
    "shipped", "transit", "pickedup", "picked_up",
    "waytocustomer", "way_to_customer", "ontheway", "on_the_way",
    "reached", "arrived", "destination", "leftwarehouse", "left_warehouse", "left_the_warehouse",
    "arrivewarehouse", "arrive_warehouse", "reachedwarehouse", "reached_warehouse",
    "airport", "airline", "customs", "clearance", "handedto", "handed_to", "international",
  ] },
  // Confirmed & waiting for pickup / delivery slot.
  { bucket: "awaiting_delivery", keywords: [
    "awaiting", "readyforpickup", "ready_for_pickup", "ready",
    "confirmed", "scheduled", "schedule", "confirmedandscheduled",
    "pickuppoint", "pickup_point", "reachedpickup", "reached_pickup",
    "underprocessing", "under_processing",
  ] },
];

function classifyStatus(status?: string): string {
  const s = (status || "").trim().toLowerCase();
  if (!s) return "processing";
  for (const group of OTO_STATUS_KEYWORDS) {
    if (group.keywords.some((k) => s.includes(k))) return group.bucket;
  }
  // Unknown / not-yet-mapped states are kept safe under "قيد التنفيذ".
  return "processing";
}

function mapStatus(status?: string): string {
  return classifyStatus(status);
}
export { mapStatus };
export { mapOrderStatus };

/** Raw OTO status → Arabic label, so admins see OTO's exact state. */
export function otoStatusLabel(status?: string | null): string {
  const s = (status || "").toLowerCase();
  if (s.includes("delivered")) return "تم التوصيل";
  if (s.includes("return")) return "مرتجع";
  if (s.includes("cancel")) return "ملغي";
  if (s.includes("fail") || s.includes("notscheduled") || s.includes("unabletoassign")) return "فشل الشحن";
  if (s.includes("onhold") || s.includes("on_hold") || s.includes("suspend")) return "معلقة بالمستودع";
  if (s.includes("pendingcancel") || s.includes("pending_cancel")) return "قيد الانتظار للإلغاء";
  if (s === "new") return "جديدة لدى OTO";
  if (s.includes("outfordelivery") || s.includes("out for delivery") || s.includes("out_for_delivery")) return "خارج للتوصيل";
  if (s.includes("pickedup") || s.includes("picked_up") || s.includes("shipped")) return "جاري الشحن";
  if (s.includes("transit") || s.includes("ontheway") || s.includes("on_the_way") || s.includes("waytocustomer")) return "في الطريق";
  if (s.includes("airport")) return "تم شحنها إلى المطار";
  if (s.includes("airline")) return "تم تسليمها لشركة الطيران";
  if (s.includes("customs") || s.includes("clearance")) return "اكتملت إجراءات التخليص الجمركي";
  if (s.includes("reachedwarehouse") || s.includes("reached_warehouse") || s.includes("arrivewarehouse")) return "وصل المستودع";
  if (s.includes("leftwarehouse") || s.includes("left_warehouse") || s.includes("left_the_warehouse")) return "غادر المستودع";
  if (s.includes("readyforpickup") || s.includes("ready_for_pickup") || s.includes("ready")) return "جاهزة للاستلام";
  if (s.includes("awaiting")) return "بانتظار التسليم";
  if (s.includes("confirmed") || s.includes("scheduled")) return "مؤكد ومُجَدول للشحن";
  if (s.includes("processing") || s.includes("approve")) return "قيد المعالجة";
  if (s.includes("ship")) return "قيد التجهيز";
  return status ? String(status) : "";
}

function mapOrderStatus(status?: string): string {
  const bucket = classifyStatus(status);
  const s = (status || "").toLowerCase();

  if (bucket === "delivered") return "delivered";
  if (bucket === "returned") return "returned";
  if (bucket === "cancelled" || bucket === "failed") return "cancelled";

  // Granular shipping stages — match OTO keyword families
  if (s.includes("pickedup") || s.includes("picked_up")) return "picked_up";
  if (s.includes("outfordelivery") || s.includes("out_for_delivery") || s.includes("out for delivery") || s.includes("readyforpickup") || s.includes("ready_for_pickup") || s.includes("ready")) return "out_for_delivery";
  if (s.includes("transit") || s.includes("ontheway") || s.includes("on_the_way") || s.includes("waytocustomer") || s.includes("way_to_customer") || s.includes("reached") || s.includes("arrived") || s.includes("leftwarehouse") || s.includes("left_warehouse") || s.includes("left_the_warehouse") || s.includes("airport") || s.includes("airline") || s.includes("customs") || s.includes("clearance") || s.includes("handedto") || s.includes("handed_to") || s.includes("international")) return "in_transit";

  // on_hold / awaiting_delivery / processing / unknown → still "shipped" (جاري الشحن)
  return "shipped";
}

function eventTypeFromStatus(status?: string): string | null {
  const s = (status || "").toLowerCase();
  if (s.includes("delivered")) return "shipment.delivered";
  if (s.includes("return") || s.includes("rto")) return "return.received";
  if (s.includes("cancel")) return "shipment.cancelled";
  if (s.includes("onhold") || s.includes("on_hold") || s.includes("suspend")) return "shipment.on_hold";
  if (s.includes("outfordelivery") || s.includes("out for delivery") || s.includes("out_for_delivery")) return "shipment.out_for_delivery";
  if (s.includes("readyforpickup") || s.includes("ready_for_pickup") || s.includes("ready")) return "shipment.out_for_delivery";
  if (s.includes("transit") || s.includes("pickedup") || s.includes("picked_up") || s.includes("shipped") || s.includes("ontheway") || s.includes("on_the_way") || s.includes("waytocustomer") || s.includes("way_to_customer") || s.includes("leftwarehouse") || s.includes("left_warehouse") || s.includes("airport") || s.includes("airline") || s.includes("customs") || s.includes("clearance") || s.includes("processing") || s.includes("accepted") || s.includes("dispatch")) return "shipment.in_transit";
  if (s.includes("fail") || s.includes("unabletoassign") || s.includes("unable_to_assign")) return "shipment.failed";
  if (s.includes("hold") || s.includes("pending") || s.includes("await") || s.includes("queue")) return "shipment.on_hold";
  return "shipment.in_transit";
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
    .select("id, order_id, oto_order_id, tracking_number, dc_tracking_number, status, delivery_company, delivery_option_name")
    .not("oto_order_id", "is", null)
    .not("status", "in", '("delivered","cancelled","returned")')
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) return { total: 0, updated: 0, failed: 0, skipped: 0 };

  const rows = data as SyncRow[];

  // Pull linked order info (order number, carrier / delivery option) so
  // shipments always show a useful name even before OTO assigns tracking.
    const orderIds = Array.from(new Set(rows.map((r) => r.order_id).filter(Boolean))) as string[];
    const orders = new Map<string, OrderInfo & { customer_identifier?: string | null }>();
    if (orderIds.length) {
      const { data: orderRows } = await supabase
        .from("orders")
        .select("id, order_number, customer_name, shipping_method, customer_identifier")
        .in("id", orderIds);
      (orderRows || []).forEach((o) => orders.set(o.id, o as OrderInfo & { customer_identifier?: string | null }));
    }
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

        const order = row.order_id ? orders.get(row.order_id) : undefined;
        const company =
          info.deliveryCompany ||
          row.delivery_company ||
          order?.shipping_method ||
          null;
        const optionName = info.deliveryOptionName || row.delivery_option_name || order?.shipping_method || null;

        const changed =
          info.trackingNumber !== row.tracking_number ||
          info.dcTrackingNumber !== row.dc_tracking_number ||
          status !== row.status ||
          company !== row.delivery_company ||
          optionName !== row.delivery_option_name;

        if (changed) {
          const patch: Record<string, unknown> = {
            tracking_number: tracking || undefined,
            dc_tracking_number: info.dcTrackingNumber || info.trackingNumber || undefined,
            tracking_url: info.trackingUrl || undefined,
            branded_tracking_url: info.trackingUrl || undefined,
            print_awb_url: info.printAWBURL || undefined,
            status,
            dc_status: info.dcStatus || info.status || undefined,
            delivery_company: company || undefined,
            delivery_option_name: optionName || undefined,
            driver_name: info.driverName || undefined,
            driver_phone: info.driverPhone || undefined,
            updated_at: new Date().toISOString(),
          };

          await supabase.from("shipments").update(patch).eq("id", row.id);
          updated++;

          // Keep order in sync too
          if (row.order_id) {
            const newOrderStatus = mapOrderStatus(info.status || status);
            const { data: currentOrder } = await supabase.from("orders").select("status").eq("id", row.order_id).maybeSingle();
            const oldOrderStatus = currentOrder?.status || null;
            await supabase.from("orders").update({
              status: newOrderStatus,
              tracking_number: tracking || undefined,
              tracking_url: info.trackingUrl || undefined,
            }).eq("id", row.order_id);
            if (oldOrderStatus && oldOrderStatus !== newOrderStatus) {
              await logOrderStatusChange(row.order_id, oldOrderStatus, newOrderStatus, "oto-sync", `تحديث من OTO: ${info.status || status}`);
              await emitNotification({
                source: "oto",
                externalEventId: `order.status_changed.${row.order_id}.${newOrderStatus}.${Date.now()}`,
                eventType: "order.status_changed",
                orderId: row.order_id,
                orderNumber: order?.order_number ?? null,
                customerIdentifier: order?.customer_identifier ?? null,
                payload: {
                  customer_name: order?.customer_name ?? null,
                  order_number: order?.order_number ?? null,
                  status_label: ORDER_STATUS_META[newOrderStatus as keyof typeof ORDER_STATUS_META]?.label || newOrderStatus,
                  old_status: oldOrderStatus,
                  new_status: newOrderStatus,
                },
              });
            }
          }

          // Notification for state transitions (idempotent by OTO status+tracking)
          if (eventType) {
            await emitNotification({
              source: "oto",
              externalEventId,
              eventType,
              orderId: row.order_id,
              shipmentId: row.id,
              customerIdentifier: order?.customer_identifier ?? null,
              payload: {
                carrier_name: info.deliveryCompany || company,
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

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emitNotification, processEvent } from "@/lib/notifications/engine";
import { buildEventId, ingestEvent, logNotificationEvent } from "@/lib/notifications/events";
import { mapStatus as mapOtoStatus } from "@/lib/oto/sync";

type OtoOrderStatusPayload = {
  orderId?: string;
  otoId?: number | string;
  parentOrderId?: string;
  status?: string;
  dcStatus?: string;
  trackingNumber?: string;
  dcTrackingNumber?: string;
  trackingUrl?: string;
  printAWBURL?: string;
  brandedTrackingURL?: string;
  deliveryCompany?: string;
  driverName?: string;
  driverPhone?: string;
  note?: string;
  timestamp?: string;
};

type OtoShipmentErrorPayload = {
  orderId?: string;
  errorMessage?: string;
  errorCode?: string;
  deliveryCompany?: string;
  deliveryCompanyResponse?: string;
  timestamp?: string;
};

type OtoWalletPayload = {
  remainingCredit?: number;
  balance?: number;
  amount?: number;
  type?: string;
  description?: string;
  timestamp?: string;
};

export async function POST(req: NextRequest) {
  const secret = process.env.OTO_WEBHOOK_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") || "";
    const provided = auth.replace(/^Bearer\s+/i, "");
    if (provided !== secret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const supabase = createAdminClient();

  try {
    if (body.trackingNumber || body.status || body.orderId) {
      await handleOrderStatus(supabase, body);
    } else if (body.errorMessage || body.errorCode) {
      await handleShipmentError(supabase, body);
    } else {
      await supabase.from("shipping_logs").insert({
        event: "oto.webhook",
        level: "info",
        message: "OTO webhook (غير مصنف)",
        payload: body,
      });
      await ingestOtoEvent(supabase, "oto.webhook.unknown", body, "system");
    }
  } catch (e) {
    await supabase.from("shipping_logs").insert({
      event: "oto.webhook.error",
      level: "error",
      message: (e as Error).message,
      payload: body,
    });
    await logNotificationEvent({ event: "oto.webhook.processing_error", level: "error", message: (e as Error).message, payload: body });
  }

  return NextResponse.json({ success: true });
}

/**
 * Idempotency: each OTO event gets a stable external id derived from the
 * payload. A duplicate webhook is ignored and produces no duplicate
 * notification or shipping_event.
 */
async function ingestOtoEvent(
  supabase: ReturnType<typeof createAdminClient>,
  eventType: string,
  body: Record<string, unknown>,
  source: string
) {
  const orderId = String(body.orderId ?? body.otoId ?? "");
  const externalEventId = buildEventId("oto", [
    source,
    orderId,
    String(body.status ?? ""),
    String(body.dcStatus ?? ""),
    String(body.trackingNumber ?? body.dcTrackingNumber ?? ""),
    String(body.errorMessage ?? ""),
  ]);

  const { inserted, id } = await ingestEvent({
    source: "oto",
    externalEventId,
    eventType,
    orderId: null, // resolved by caller when known
    shipmentId: null,
    payload: body as Record<string, unknown>,
  });

  if (inserted && id) {
    await processEvent({
      eventId: id,
      eventType,
      orderId: null,
      orderNumber: body.orderId ? Number(body.orderId) || null : null,
      shipmentId: null,
      payload: body as Record<string, unknown>,
    });
  }
}

async function handleOrderStatus(supabase: ReturnType<typeof createAdminClient>, body: OtoOrderStatusPayload) {
  const orderId = body.orderId || String(body.otoId || "");
  if (!orderId) return;

  let internalOrderId: string | null = null;
  let customerIdentifier: string | null = null;
  let internalOrderNumber: number | null = null;
  if (body.orderId) {
    const { data: orders } = await supabase.from("orders")
      .select("id, customer_identifier, order_number")
      .eq("order_number", Number(body.orderId))
      .limit(1);
    if (orders && orders.length) {
      internalOrderId = orders[0].id;
      customerIdentifier = orders[0].customer_identifier || null;
      internalOrderNumber = orders[0].order_number;
    }
  }

  // Match the existing shipment row by stable identifiers (internal order id,
  // OTO order id) first, falling back to tracking numbers. Without this, a
  // status webhook arriving before the tracking number is stored would create
  // a duplicate shipment row instead of updating the existing one.
  let matchFilter: string;
  if (internalOrderId) {
    matchFilter = `order_id.eq.${internalOrderId}`;
  } else if (body.otoId) {
    matchFilter = `oto_order_id.eq.${body.otoId}`;
  } else if (body.trackingNumber) {
    matchFilter = `tracking_number.eq.${body.trackingNumber},dc_tracking_number.eq.${body.trackingNumber}`;
  } else {
    matchFilter = `oto_order_id.eq.${orderId}`;
  }

  const { data: shipments } = await supabase.from("shipments")
    .select("id")
    .or(matchFilter)
    .limit(1);

  const shipmentId = shipments && shipments.length ? shipments[0].id : null;
  const tracking = body.trackingNumber || body.dcTrackingNumber || null;

  if (shipments && shipments.length) {
    await supabase.from("shipments").update({
      tracking_number: tracking || undefined,
      dc_tracking_number: body.dcTrackingNumber || undefined,
      tracking_url: body.trackingUrl || undefined,
      branded_tracking_url: body.brandedTrackingURL || undefined,
      print_awb_url: body.printAWBURL || undefined,
      status: mapOtoStatus(body.status || body.dcStatus),
      dc_status: body.dcStatus || undefined,
      driver_name: body.driverName || undefined,
      driver_phone: body.driverPhone || undefined,
      updated_at: new Date().toISOString(),
    }).eq("id", shipments[0].id);
  } else if (tracking) {
    await supabase.from("shipments").insert({
      order_id: internalOrderId,
      oto_order_id: body.otoId ? Number(body.otoId) : null,
      tracking_number: tracking,
      dc_tracking_number: body.dcTrackingNumber || null,
      tracking_url: body.trackingUrl || null,
      branded_tracking_url: body.brandedTrackingURL || null,
      print_awb_url: body.printAWBURL || null,
      status: mapOtoStatus(body.status || body.dcStatus),
      dc_status: body.dcStatus || null,
      driver_name: body.driverName || null,
      driver_phone: body.driverPhone || null,
      delivery_company: body.deliveryCompany || null,
    });
  }

  await supabase.from("shipping_logs").insert({
    event: "oto.webhook.orderStatus",
    level: "info",
    message: `طلب ${orderId}: ${body.status || body.dcStatus || "تحديث"}`,
    payload: body,
  });

  // Sync order status
  if (body.orderId) {
    const { data: orders } = await supabase.from("orders").select("id").eq("order_number", Number(body.orderId)).limit(1);
    if (orders && orders.length) {
      await supabase.from("orders").update({
        status: mapOrderStatus(body.status || body.dcStatus),
        tracking_number: tracking || undefined,
        tracking_url: body.trackingUrl || body.brandedTrackingURL || undefined,
      }).eq("id", orders[0].id);
    }
  }

  // ---- Notification Engine (idempotent) ----
  const eventType = eventTypeFromStatus(body.status || body.dcStatus);
  if (eventType) {
    const externalEventId = buildEventId("oto", ["orderStatus", orderId, body.status ?? "", body.dcStatus ?? "", tracking ?? ""]);
    const { inserted, id } = await ingestEvent({
      source: "oto",
      externalEventId,
      eventType,
      orderId: internalOrderId,
      orderNumber: internalOrderNumber,
      shipmentId,
      customerIdentifier,
      payload: {
        ...body,
        carrier_name: body.deliveryCompany,
        tracking_number: tracking,
        tracking_url: body.trackingUrl || body.brandedTrackingURL,
        shipping_status: body.status || body.dcStatus,
      } as Record<string, unknown>,
    });
    if (inserted && id) {
      await processEvent({
        eventId: id,
        eventType,
        orderId: internalOrderId,
        orderNumber: internalOrderNumber,
        shipmentId,
        customerIdentifier,
        payload: {
          ...body,
          carrier_name: body.deliveryCompany,
          tracking_number: tracking,
          tracking_url: body.trackingUrl || body.brandedTrackingURL,
          shipping_status: body.status || body.dcStatus,
        } as Record<string, unknown>,
      });
    }
  }
}

async function handleShipmentError(supabase: ReturnType<typeof createAdminClient>, body: OtoShipmentErrorPayload) {
  await supabase.from("shipping_logs").insert({
    event: "oto.webhook.shipmentError",
    level: "error",
    message: body.errorMessage || "خطأ في إنشاء الشحنة",
    payload: body,
  });

  await emitNotification({
    source: "oto",
    externalEventId: buildEventId("oto", ["shipmentError", body.orderId ?? "", body.errorCode ?? "", body.errorMessage ?? ""]),
    eventType: "shipment.failed",
    orderNumber: body.orderId ? Number(body.orderId) || null : null,
    payload: {
      order_number: body.orderId,
      carrier_name: body.deliveryCompany || "OTO",
      error_message: body.errorMessage || "خطأ غير معروف",
    },
  });
}

function eventTypeFromStatus(status?: string): string | null {
  const s = (status || "").toLowerCase();
  if (s.includes("delivered")) return "shipment.delivered";
  if (s.includes("return") || s.includes("rto")) return "return.received";
  if (s.includes("cancel")) return "shipment.cancelled";
  if (s.includes("onhold") || s.includes("on_hold") || s.includes("suspend")) return "shipment.on_hold";
  if (s.includes("pick")) return "shipment.picked_up";
  if (s.includes("out for delivery") || s.includes("outfordelivery") || s.includes("delivery out")) return "shipment.out_for_delivery";
  if (s.includes("transit") || s.includes("pickedup") || s.includes("picked_up") || s.includes("shipped")) return "shipment.in_transit";
  if (s.includes("fail")) return "shipment.failed";
  return null; // processing / unknown => no notification
}

function mapOrderStatus(status?: string): string {
  const s = (status || "").toLowerCase();
  if (s.includes("delivered")) return "delivered";
  if (s.includes("return")) return "returned";
  if (s.includes("cancel")) return "cancelled";
  if (s.includes("fail")) return "shipping_error";
  return "shipped";
}

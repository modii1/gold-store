import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

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
    }
  } catch (e) {
    await supabase.from("shipping_logs").insert({
      event: "oto.webhook.error",
      level: "error",
      message: (e as Error).message,
      payload: body,
    });
  }

  return NextResponse.json({ success: true });
}

async function handleOrderStatus(supabase: ReturnType<typeof createAdminClient>, body: OtoOrderStatusPayload) {
  const orderId = body.orderId || String(body.otoId || "");
  if (!orderId) return;

  let internalOrderId: string | null = null;
  if (body.orderId) {
    const { data: orders } = await supabase.from("orders")
      .select("id")
      .eq("order_number", Number(body.orderId))
      .limit(1);
    if (orders && orders.length) internalOrderId = orders[0].id;
  }

  let matchFilter: string;
  if (body.trackingNumber) {
    matchFilter = `tracking_number.eq.${body.trackingNumber},dc_tracking_number.eq.${body.trackingNumber}`;
  } else if (body.otoId) {
    matchFilter = `oto_order_id.eq.${body.otoId}`;
  } else if (internalOrderId) {
    matchFilter = `order_id.eq.${internalOrderId}`;
  } else {
    matchFilter = `oto_order_id.eq.${orderId}`;
  }

  const { data: shipments } = await supabase.from("shipments")
    .select("id")
    .or(matchFilter)
    .limit(1);

  const tracking = body.trackingNumber || body.dcTrackingNumber || null;

  if (shipments && shipments.length) {
    await supabase.from("shipments").update({
      tracking_number: tracking || undefined,
      dc_tracking_number: body.dcTrackingNumber || undefined,
      tracking_url: body.trackingUrl || undefined,
      branded_tracking_url: body.brandedTrackingURL || undefined,
      print_awb_url: body.printAWBURL || undefined,
      status: mapStatus(body.status || body.dcStatus),
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
      status: mapStatus(body.status || body.dcStatus),
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
}

async function handleShipmentError(supabase: ReturnType<typeof createAdminClient>, body: OtoShipmentErrorPayload) {
  await supabase.from("shipping_logs").insert({
    event: "oto.webhook.shipmentError",
    level: "error",
    message: body.errorMessage || "خطأ في إنشاء الشحنة",
    payload: body,
  });
}

function mapStatus(status?: string): string {
  const s = (status || "").toLowerCase();
  if (s.includes("delivered")) return "delivered";
  if (s.includes("return") || s.includes("rto")) return "returned";
  if (s.includes("cancel")) return "cancelled";
  if (s.includes("ship") || s.includes("transit") || s.includes("pick")) return "in_transit";
  return "processing";
}

function mapOrderStatus(status?: string): string {
  const s = (status || "").toLowerCase();
  if (s.includes("delivered")) return "delivered";
  if (s.includes("return")) return "returned";
  if (s.includes("cancel")) return "cancelled";
  if (s.includes("ship")) return "shipped";
  return "shipped";
}

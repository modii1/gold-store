"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCustomerSession } from "@/lib/auth";
import { otoCreateReturnShipment, getAccessToken } from "@/lib/oto/client";
import { translateOtoError } from "@/lib/format";
import { emitNotification } from "@/lib/notifications/engine";

export async function saveCustomerAddressAction(formData: FormData) {
  const session = await getCustomerSession();
  const phone = session?.phone || "";
  if (!phone) return { error: "سجلي الدخول أو أدخلي رقم الجوال أولاً" };

  const supabase = createAdminClient();
  const address = {
    customer_identifier: phone,
    full_name: String(formData.get("full_name") || "").trim() || null,
    phone,
    label: String(formData.get("label") || "عنواني").trim(),
    city: String(formData.get("city") || "").trim() || null,
    region: String(formData.get("region") || "").trim() || null,
    address: String(formData.get("address") || "").trim() || null,
    national_address: String(formData.get("national_address") || "").trim() || null,
    latitude: Number(formData.get("latitude")) || null,
    longitude: Number(formData.get("longitude")) || null,
    maps_url: String(formData.get("maps_url") || "").trim() || null,
    is_default: formData.get("is_default") === "on",
  };
  if (address.is_default) await supabase.from("addresses").update({ is_default: false }).eq("customer_identifier", phone);
  const { error } = await supabase.from("addresses").insert(address);
  if (error) return { error: error.message };
  revalidatePath("/account");
  return { success: true };
}

export async function createReturnRequestAction(formData: FormData) {
  const session = await getCustomerSession();
  const orderId = String(formData.get("order_id") || "");
  if (!session || !orderId) return { error: "يجب تسجيل الدخول وتحديد الطلب" };
  const supabase = createAdminClient();
  const { data: order } = await supabase.from("orders").select("id,customer_identifier").eq("id", orderId).eq("customer_identifier", session.phone).maybeSingle();
  if (!order) return { error: "الطلب غير موجود" };
  const { data: existing } = await supabase
    .from("return_requests")
    .select("id")
    .eq("order_id", orderId)
    .eq("customer_identifier", session.phone)
    .in("status", ["pending", "approved", "received"])
    .maybeSingle();
  if (existing) return { error: "لديك طلب استرجاع قائم لهذا الطلب بالفعل — انتظر الرد عليه" };
  const { error } = await supabase.from("return_requests").insert({
    order_id: orderId,
    customer_identifier: session.phone,
    reason: String(formData.get("reason") || "استرجاع").trim(),
    details: String(formData.get("details") || "").trim() || null,
  });
  if (error) return { error: error.message };
  await emitNotification({
    source: "system",
    externalEventId: `return.requested.${orderId}.${Date.now()}`,
    eventType: "return.requested",
    orderId,
    customerIdentifier: session.phone,
    payload: { return_reason: String(formData.get("reason") || "استرجاع").trim() },
  });
  revalidatePath("/account");
  return { success: true };
}

const RETURN_TRANSITIONS: Record<string, string[]> = {
  pending: ["approved", "rejected"],
  approved: ["received", "refunded"],
  received: ["refunded"],
  rejected: ["pending"],
  refunded: [],
};

export async function updateReturnRequestAction(formData: FormData) {
  const id = String(formData.get("id") || "");
  const status = String(formData.get("status") || "pending");
  if (!id) return { error: "معرف الطلب مطلوب" };
  if (status === "approved") return { error: "الموافقة تنشئ شحنة مرتجع عبر OTO — استخدم زر «موافقة وإنشاء شحنة مرتجع»" };
  const supabase = createAdminClient();
  const { data: rr } = await supabase.from("return_requests").select("status, customer_identifier, order_id, reason").eq("id", id).maybeSingle();
  const allowed = RETURN_TRANSITIONS[rr?.status || ""] || [];
  if (!allowed.includes(status)) return { error: "لا يمكن تكرار العملية — هذه الحالة غير مسموحة من الحالة الحالية" };
  const { error } = await supabase.from("return_requests").update({ status, admin_note: String(formData.get("admin_note") || "").trim() || null, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { error: error.message };
  if (rr?.customer_identifier) {
    const eventType = status === "received" ? "return.received" : status === "refunded" ? "return.refunded" : status === "rejected" ? "return.rejected" : null;
    if (eventType) {
      await emitNotification({
        source: "system",
        externalEventId: `return.${status}.${id}.${Date.now()}`,
        eventType,
        orderId: rr.order_id,
        customerIdentifier: rr.customer_identifier,
        payload: { return_reason: rr.reason || "استرجاع" },
      });
    }
  }
  revalidatePath("/admin/returns");
  return { success: true };
}

export async function approveReturnRequestAction(returnRequestId: string) {
  if (!returnRequestId) return { error: "معرف الطلب مطلوب" };
  const supabase = createAdminClient();

  const { data: rr, error: rrErr } = await supabase
    .from("return_requests")
    .select("*, orders(id, order_number, customer_name, customer_phone, customer_city, region, address, items, delivery_option_id, total)")
    .eq("id", returnRequestId)
    .maybeSingle();
  if (rrErr || !rr) return { error: rrErr?.message || "طلب المرتجع غير موجود" };
  if (rr.oto_return_order_id || rr.return_status === "created") return { error: "تم إنشاء شحنة المرتجع مسبقاً — لا يمكن تكرار العملية" };
  const canApprove = rr.status === "pending" || (rr.status === "approved" && rr.return_status === "error");
  if (!canApprove) return { error: "هذا الطلب تمت معالجته مسبقاً" };

  const { data: shipment } = await supabase
    .from("shipments")
    .select("delivery_option_id, delivery_company, delivery_option_name")
    .eq("order_id", rr.order_id)
    .maybeSingle();

  const deliveryOptionId = shipment?.delivery_option_id || rr.orders?.delivery_option_id;
  if (!deliveryOptionId) return { error: "لا يوجد خيار شحن مرتبط بالطلب الأصلي — لا يمكن إنشاء شحنة مرتجع" };

  let otoResult: any = null;
  let otoError: string | null = null;
  try {
    await getAccessToken();
    const { data: cfg } = await supabase.from("oto_config").select("is_connected").eq("id", 1).maybeSingle();
    console.log("[approveReturn] is_connected:", (cfg as any)?.is_connected, "order_number:", rr.orders?.order_number, "deliveryOptionId:", deliveryOptionId);
    if ((cfg as any)?.is_connected) {
      otoResult = await otoCreateReturnShipment({
        orderId: String(rr.orders?.order_number || ""),
        deliveryOptionId: String(deliveryOptionId),
        pickingType: "PICKUP_BY_DC",
      });
      console.log("[approveReturn] otoResult:", JSON.stringify(otoResult));
      if (!otoResult?.success) {
        otoError = translateOtoError(otoResult?.otoErrorMessage) || "فشل إنشاء شحنة المرتجع من OTO";
      }
    } else {
      otoError = "OTO غير متصل — تأكد من ربط الحساب من الإعدادات";
    }
  } catch (e) {
    otoError = translateOtoError((e as Error).message);
    console.error("[approveReturn] OTO error:", otoError);
    await supabase.from("shipping_logs").insert({
      order_id: rr.order_id,
      event: "oto.return.error",
      level: "error",
      message: (e as Error).message,
      payload: { returnRequestId, deliveryOptionId },
    });
  }

  const updateData: Record<string, any> = {
    status: "approved",
    updated_at: new Date().toISOString(),
  };

  if (otoResult?.success) {
    updateData.oto_return_order_id = otoResult.returnOrderId || null;
    updateData.return_delivery_company = shipment?.delivery_company || null;
    updateData.return_delivery_option_name = shipment?.delivery_option_name || null;
    updateData.return_shipped_at = new Date().toISOString();
    updateData.return_status = "created";

    try {
      const { data: otoCfg } = await supabase.from("oto_config").select("origin_city, origin_country").eq("id", 1).maybeSingle();
      const { otoCheckDeliveryFee } = await import("@/lib/oto/client");
      const ratesRes = await otoCheckDeliveryFee({
        originCity: (otoCfg as any)?.origin_city || "Riyadh",
        destinationCity: (otoCfg as any)?.origin_city || "Riyadh",
        originCountry: (otoCfg as any)?.origin_country || "SA",
        destinationCountry: (otoCfg as any)?.origin_country || "SA",
        weight: 0.5,
        totalDue: 0,
      });
      if (ratesRes.deliveryCompany) {
        const matched = ratesRes.deliveryCompany.find((d) => d.deliveryOptionId === deliveryOptionId);
        if (matched) updateData.return_fee = matched.returnFee;
      }
    } catch {
      // ignore — return fee will remain null
    }
  } else if (otoError) {
    updateData.return_error = otoError;
    updateData.return_status = "error";
  }

  const { error: upErr } = await supabase
    .from("return_requests")
    .update(updateData)
    .eq("id", returnRequestId);
  if (upErr) return { error: upErr.message };

  // Notification Engine — return approved / return shipment created
  await emitNotification({
    source: "system",
    externalEventId: `return.approved.${returnRequestId}`,
    eventType: "return.approved",
    orderId: rr.order_id,
    orderNumber: rr.orders?.order_number,
    customerIdentifier: rr.customer_identifier,
    payload: { return_reason: rr.reason || "استرجاع" },
  });
  if (otoResult?.success) {
    await emitNotification({
      source: "oto",
      externalEventId: `return.created.${returnRequestId}`,
      eventType: "return.created",
      orderId: rr.order_id,
      orderNumber: rr.orders?.order_number,
      customerIdentifier: rr.customer_identifier,
      payload: { carrier_name: shipment?.delivery_company || "OTO", return_reason: rr.reason || "استرجاع" },
    });
  }

  if (otoResult?.success) {
    await supabase.from("shipping_logs").insert({
      order_id: rr.order_id,
      event: "oto.return.created",
      level: "info",
      message: `تم إنشاء شحنة المرتجع عبر OTO — رقم الإرجاع: ${otoResult.returnOrderId}`,
      payload: { returnRequestId, returnOrderId: otoResult.returnOrderId, deliveryOptionId },
    });
  }

  revalidatePath("/admin/returns");
  return {
    success: true,
    returnOrderId: otoResult?.returnOrderId || null,
    returnFee: updateData.return_fee || null,
    otoError: otoError || null,
  };
}

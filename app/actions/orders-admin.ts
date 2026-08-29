"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCarrierByCode, getCarriers } from "@/lib/services/carriers";
import { createCarrierShipment } from "@/lib/shipping";
import { otoCreateOrder, getAccessToken } from "@/lib/oto/client";
import { logOrderStatusChange, getOrderStatusLog, getOrderNotes } from "@/lib/orders/status-log";
import { exportOrdersCsv } from "@/lib/orders/query";
import { isTransfer } from "@/lib/orders/order-meta";
import { ORDER_STATUS_META } from "@/lib/orders/order-meta";
import { emitNotification } from "@/lib/notifications/engine";
import type { Order, Carrier, OrdersQueryParams, OrderDetails, OrderStatus } from "@/types";

export async function updateOrderStatusAction(formData: FormData) {
  const id = formData.get("id") as string;
  const status = formData.get("status") as string;
  if (!id || !status) return { error: "بيانات ناقصة" };

  const supabase = createAdminClient();

  const { data: current } = await supabase
    .from("orders")
    .select("id, status, order_number, customer_identifier, customer_name, shipping_method, delivery_option_name, delivery_option_id, total, payment_method")
    .eq("id", id)
    .maybeSingle();
  const oldStatus = current?.status || null;

  const { error } = await supabase.from("orders").update({ status }).eq("id", id);
  if (error) return { error: error.message };

  await logOrderStatusChange(id, oldStatus, status, "admin");

  // عند تفعيل أي حالة شحن: الطلب يدخل قسم «الشحنات» فوراً. إن كان مرتبطاً
  // بخيار توصيل OTO ولم يُرسل إليه سابقاً، يُرسل آلياً إلى OTO مع إشعار للعميل
  // (shipment.created)، ولو فشل نُنشئ صف شحنة محلياً حتى لا يضيع الطلب.
  const shippingStatuses = ["shipped", "picked_up", "in_transit", "out_for_delivery", "delivered"];
  const isShippingStatus = shippingStatuses.includes(status);
  if (isShippingStatus) {
    // التحقق من عدم الإرسال المكرر: لا نرسل إلا إذا لم تكن هناك شحنة مرتبطة بـ OTO من قبل.
    const { data: existingShipRow } = await supabase.from("shipments")
      .select("id, oto_order_id")
      .eq("order_id", id)
      .limit(1)
      .maybeSingle();

    // «تم التسليم» لا يُنشئ شحنة OTO جديدة (الشحنة وُجدت لتصل أصلاً).
    // يُسمح بإعادة الضغط على نفس حالة الشحن للطلبات العالقة: الطلبات التي دخلت
    // حالة الشحن قبل تفعيل الإرسال الآلي تحمل صف شحنة محلياً بلا oto_order_id،
    // فالضغط مرتين مرة أخرى يُرسلها إلى OTO (بالشرط المانع للازدواجية).
    const canAutoOto = status !== "delivered" && !!current?.delivery_option_id && !existingShipRow?.oto_order_id;
    const retryStuckShipping = !!current?.delivery_option_id && existingShipRow && !existingShipRow.oto_order_id;
    if (canAutoOto || retryStuckShipping) {
      try {
        const shipFd = new FormData();
        shipFd.set("id", id);
        const shipRes = await createShipmentAction(shipFd);
        if (!shipRes.error) {
          // createShipmentAction يضبط حالة الطلب على shipped داخلياً — نعيد حالة المدير
          await supabase.from("orders").update({ status }).eq("id", id);
          revalidatePath("/admin/orders");
          revalidatePath(`/admin/orders/${id}`);
          revalidatePath("/admin/shipments");
          revalidatePath("/admin/dashboard");
          return { success: true, message: shipRes.message || "تم إرسال الطلب للشحن" };
        }
        await supabase.from("shipping_logs").insert({
          order_id: id,
          event: "oto.shipment.auto_failed",
          level: "error",
          message: shipRes.error,
        }).then(async (r) => { if (r.error) console.error("shipping_logs insert failed", r.error.message); });
      } catch (e) {
        await supabase.from("shipping_logs").insert({
          order_id: id,
          event: "oto.shipment.auto_error",
          level: "error",
          message: (e as Error)?.message || String(e),
        }).then(async (r) => { if (r.error) console.error("shipping_logs insert failed", r.error.message); });
      }
    }

    // صف شحنة محلي إن لم يوجد مسبقاً (يَظهر في قسم الشحنات حتى لو فشل OTO)
    try {
      if (!existingShipRow) {
        const shipStatus = status === "delivered" ? "delivered" : status === "in_transit" || status === "out_for_delivery" ? "in_transit" : "processing";
        const isCod = (current?.payment_method || "").toLowerCase().includes("cod") || (current?.payment_method || "").toLowerCase().includes("عند الاستلام");
        await supabase.from("shipments").insert({
          order_id: id,
          delivery_company: current?.delivery_option_name || current?.shipping_method || null,
          delivery_option_name: current?.delivery_option_name || current?.shipping_method || null,
          status: shipStatus,
          cod_amount: isCod ? Number(current?.total) || null : null,
        });
        revalidatePath("/admin/shipments");
      }
    } catch {
      // إنشاء صف الشحنة اختياري — تحديث حالة الطلب نجح بالفعل
    }
  }

  if (oldStatus !== status && current) {
    const statusLabel = ORDER_STATUS_META[status as keyof typeof ORDER_STATUS_META]?.label || status;
    await emitNotification({
      source: "admin",
      externalEventId: `order.status_changed.${id}.${status}.${Date.now()}`,
      eventType: "order.status_changed",
      orderId: id,
      orderNumber: current.order_number,
      customerIdentifier: current.customer_identifier,
      payload: {
        customer_name: current.customer_name,
        order_number: current.order_number,
        status_label: statusLabel,
        old_status: oldStatus,
        new_status: status,
      },
    });
  }

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${id}`);
  revalidatePath("/admin/dashboard");
  return { success: true };
}

export async function deleteOrderAction(formData: FormData) {
  const id = formData.get("id") as string;
  if (!id) return { error: "معرف مطلوب" };

  const supabase = createAdminClient();
  const { data: order } = await supabase.from("orders").select("id, status, order_number").eq("id", id).maybeSingle();
  if (!order) return { error: "الطلب غير موجود" };

  if (["paid", "delivered", "returned"].includes(order.status)) {
    return { error: "لا يمكن حذف طلب بحالة مالية أو تسليم مؤكدة — استخدم الإلغاء أو المرتجع بدلاً من الحذف" };
  }
  const { data: shipments } = await supabase.from("shipments").select("id").eq("order_id", id).limit(1);
  if (shipments && shipments.length) {
    return { error: "لا يمكن حذف طلب يحتوي على شحنة مسجلة" };
  }

  const { error } = await supabase.from("orders").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/orders");
  revalidatePath("/admin/dashboard");
  return { success: true };
}

export async function approveTransferAction(formData: FormData) {
  const id = formData.get("id") as string;
  const note = (formData.get("note") as string)?.trim() || "تم اعتماد التحويل البنكي";
  if (!id) return { error: "معرف الطلب مطلوب" };

  const supabase = createAdminClient();
  const { data: order } = await supabase.from("orders").select("*").eq("id", id).maybeSingle();
  if (!order) return { error: "الطلب غير موجود" };
  const o = order as Order;
  if (!isTransfer(o)) return { error: "الطلب ليس تحويلاً بنكياً" };
  if (o.status !== "pending" && o.status !== "confirmed") {
    return { error: "لا يمكن اعتماد التحويل في هذه الحالة" };
  }

  await supabase.from("orders").update({ status: "processing" }).eq("id", id);
  await logOrderStatusChange(id, o.status, "processing", "admin", note);
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${id}`);
  revalidatePath("/admin/dashboard");
  return { success: true };
}

export async function rejectTransferAction(formData: FormData) {
  const id = formData.get("id") as string;
  const note = (formData.get("note") as string)?.trim() || "تم رفض إثبات التحويل";
  if (!id) return { error: "معرف الطلب مطلوب" };

  const supabase = createAdminClient();
  const { data: order } = await supabase.from("orders").select("*").eq("id", id).maybeSingle();
  if (!order) return { error: "الطلب غير موجود" };
  const o = order as Order;
  if (!isTransfer(o)) return { error: "الطلب ليس تحويلاً بنكياً" };
  if (o.status !== "pending" && o.status !== "confirmed") {
    return { error: "لا يمكن رفض التحويل في هذه الحالة" };
  }

  await supabase.from("orders").update({ status: "cancelled" }).eq("id", id);
  await logOrderStatusChange(id, o.status, "cancelled", "admin", note);
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${id}`);
  revalidatePath("/admin/dashboard");
  return { success: true };
}

export async function bulkUpdateOrdersAction(ids: string[], status: string) {
  if (!ids?.length) return { error: "حدد الطلبات أولاً" };
  if (!["pending", "confirmed", "processing", "shipped", "delivered", "paid", "cancelled", "returned"].includes(status)) {
    return { error: "حالة غير صالحة" };
  }

  const supabase = createAdminClient();
  const { data: rows } = await supabase.from("orders").select("id, order_number, status").in("id", ids);

  const results: { orderNumber: number | null; ok: boolean; error?: string }[] = [];
  let updated = 0;

  for (const row of rows || []) {
    if (status === "cancelled" && ["delivered", "paid", "returned"].includes(row.status)) {
      results.push({ orderNumber: row.order_number, ok: false, error: "لا يمكن إلغاء طلب بحالته الحالية" });
      continue;
    }
    const fd = new FormData();
    fd.set("id", row.id);
    fd.set("status", status);
    const res = await updateOrderStatusAction(fd);
    if (res.error) {
      results.push({ orderNumber: row.order_number, ok: false, error: res.error });
    } else {
      updated++;
      results.push({ orderNumber: row.order_number, ok: true });
    }
  }

  revalidatePath("/admin/orders");
  revalidatePath("/admin/dashboard");
  return { updated, failed: results.length - updated, results };
}

export async function getOrderDetailsAction(orderId: string): Promise<{ error?: string } & Partial<OrderDetails>> {
  if (!orderId) return { error: "معرف الطلب مطلوب" };
  const supabase = createAdminClient();
  const { data: order } = await supabase.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (!order) return { error: "الطلب غير موجود" };

  const shipments = await supabase.from("shipments").select("*").eq("order_id", orderId).order("created_at", { ascending: false });
  const [statusLog, notes] = await Promise.all([getOrderStatusLog(orderId), getOrderNotes(orderId)]);

  return {
    order: order as Order,
    statusLog,
    notes,
    shipments: (shipments.data as Record<string, unknown>[]) || [],
  };
}

export async function exportOrdersCsvAction(params: OrdersQueryParams) {
  try {
    const csv = await exportOrdersCsv(params);
    return { csv };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

async function computeWeightGrams(supabase: ReturnType<typeof createAdminClient>, order: Order): Promise<number> {
  let weightGrams = 0;
  const productIds = (order.items || []).map((it) => it.product_id).filter(Boolean);
  if (productIds.length) {
    const { data: products } = await supabase.from("products").select("id, weight_grams").in("id", productIds);
    const map = new Map((products || []).map((p) => [p.id, p.weight_grams ?? 0]));
    for (const it of order.items || []) {
      const unit = map.get(it.product_id) ?? 0;
      weightGrams += (unit || 500) * it.qty;
    }
  }
  return weightGrams > 0 ? weightGrams : 500;
}

export async function createShipmentAction(formData: FormData) {
  const orderId = formData.get("id") as string;
  const carrierId = (formData.get("carrier_id") as string) || "";
  const deliveryOptionId = parseInt((formData.get("delivery_option_id") as string) || "", 10) || null;
  if (!orderId) return { error: "معرف الطلب مطلوب" };

  const supabase = createAdminClient();
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();
  if (orderError || !order) return { error: orderError?.message || "الطلب غير موجود" };
  const o = order as Order;

  // OTO path: order already has a delivery_option_id from checkout
  if (o.delivery_option_id || deliveryOptionId) {
    const optionId = deliveryOptionId || o.delivery_option_id!;
    let otoPayload: Record<string, unknown> | null = null;
    try {
      await getAccessToken();
      const { data: cfg } = await supabase.from("oto_config").select("is_connected").eq("id", 1).maybeSingle();
      if ((cfg as any)?.is_connected) {
        const weightGrams = await computeWeightGrams(supabase, o);
        const pm = (o.payment_method || "").toLowerCase();
        const isCod = pm.includes("cod") || pm.includes("عند الاستلام") || pm.includes("cash on delivery");
        const codAmount = isCod ? Number(o.total) || 0 : 0;

        const customerAddress = (o.address || o.national_address || "").trim();
        const fallbackAddress = [o.customer_city, o.region].filter(Boolean).join("، ") || "الرياض";

        otoPayload = {
          orderId: String(o.order_number),
          ref1: String(o.order_number),
          payment_method: codAmount > 0 ? "cod" : "paid",
          amount: codAmount > 0 ? codAmount : Number(o.total) || 0,
          amount_due: codAmount > 0 ? codAmount : 0,
          currency: "SAR",
          deliveryOptionId: optionId,
          createShipment: true,
          packageCount: (o.items || []).reduce((s: number, it) => s + (it.qty || 1), 0) || 1,
          packageWeight: weightGrams / 1000,
          customer: {
            name: o.customer_name,
            mobile: o.customer_phone,
            address: customerAddress || fallbackAddress,
            city: o.customer_city || "",
            country: "SA",
            refID: String(o.order_number),
          },
          items: (o.items || []).map((it) => ({
            name: it.name,
            price: it.price,
            quantity: it.qty || 1,
          })),
        };

        let created: Awaited<ReturnType<typeof otoCreateOrder>>;
        try {
          created = await otoCreateOrder(otoPayload);
        } catch (e) {
          const msg = (e as Error).message;
          // Idempotency: order already exists in OTO — treat as already shipped
          if (/already exist/i.test(msg) || /OTO1063/.test(msg)) {
            const { data: existing } = await supabase
              .from("shipments")
              .select("id, oto_order_id")
              .eq("order_id", orderId)
              .maybeSingle();
            if (existing) {
        await supabase.from("orders").update({ status: "shipped" }).eq("id", orderId);
        await logOrderStatusChange(orderId, o.status, "shipped", "admin", "إنشاء شحنة عبر OTO");
              await logOrderStatusChange(orderId, o.status, "shipped", "admin", "الطلب موجود مسبقاً في OTO");
              await supabase.from("shipping_logs").insert({
                order_id: orderId,
                event: "oto.shipment.already_existed",
                level: "info",
                message: "الطلب موجود مسبقاً في OTO — تم اعتباره مشحوناً",
                payload: { optionId },
              });
              revalidatePath("/admin/orders");
              revalidatePath("/admin/shipments");
              return { success: true, trackingNumber: null, trackingUrl: null, message: "الطلب مشحون مسبقاً في OTO" };
            }
            created = { success: true, otoId: undefined };
          } else {
            throw e;
          }
        }

        const otoOrderId = created.otoId || null;

        await supabase.from("orders").update({ status: "shipped" }).eq("id", orderId);

        const oWithOption = o as Order & { delivery_option_name?: string | null };
        const optionFallback = oWithOption.delivery_option_name || o.shipping_method;

        const shipRow = {
          order_id: orderId,
          oto_order_id: otoOrderId ? Number(otoOrderId) : null,
          delivery_option_id: optionId,
          delivery_company: created.deliveryCompany || optionFallback || null,
          delivery_option_name: created.deliveryOptionName || optionFallback || null,
          tracking_number: null,
          dc_tracking_number: null,
          tracking_url: null,
          branded_tracking_url: null,
          print_awb_url: null,
          status: "processing",
          price: null,
          cod_amount: codAmount > 0 ? codAmount : null,
          who_pays: null,
        };
        const { data: existingShip } = await supabase
          .from("shipments")
          .select("id")
          .eq("order_id", orderId)
          .maybeSingle();
        if (existingShip) {
          const { error: upErr } = await supabase.from("shipments").update(shipRow).eq("id", existingShip.id);
          if (upErr) {
            await supabase.from("shipping_logs").insert({
              order_id: orderId,
              event: "oto.shipment.error",
              level: "error",
              message: upErr.message,
              payload: { optionId },
            });
          }
        } else {
          const { error: insErr } = await supabase.from("shipments").insert(shipRow);
          if (insErr) {
            await supabase.from("shipping_logs").insert({
              order_id: orderId,
              event: "oto.shipment.error",
              level: "error",
              message: insErr.message,
              payload: { optionId },
            });
          }
        }

        await supabase.from("shipping_logs").insert({
          order_id: orderId,
          event: "oto.shipment.created",
          level: "info",
          message: `تم إنشاء الشحنة عبر OTO (option ${optionId})، رقم OTO: ${otoOrderId}. رقم التتبع سيصل عبر الـ Webhook`,
          payload: { otoOrderId },
        });

        // Notification Engine — shipment created via OTO
        const { data: createdShip } = await supabase.from("shipments").select("id").eq("order_id", orderId).maybeSingle();
        await emitNotification({
          source: "oto",
          externalEventId: `shipment.created.${orderId}.${otoOrderId ?? ""}`,
          eventType: "shipment.created",
          orderId,
          orderNumber: o.order_number,
          shipmentId: createdShip?.id ?? null,
          customerIdentifier: (o as Order & { customer_identifier?: string }).customer_identifier ?? null,
          payload: { carrier_name: created.deliveryCompany || "OTO" },
        });

        revalidatePath("/admin/orders");
        revalidatePath("/admin/shipments");
        revalidatePath("/admin/dashboard");
        return {
          success: true,
          trackingNumber: null,
          trackingUrl: null,
          message: `تم إنشاء الشحنة عبر OTO (رقم ${otoOrderId}). سيظهر رقم التتبع فور تحديث حالة OTO`,
        };
      }
    } catch (e) {
      await supabase.from("shipping_logs").insert({
        order_id: orderId,
        event: "oto.shipment.error",
        level: "error",
        message: (e as Error).message,
        payload: { optionId, payload: otoPayload },
      });
      await emitNotification({
        source: "oto",
        externalEventId: `shipment.failed.${orderId}.${Date.now()}`,
        eventType: "shipment.failed",
        orderId,
        orderNumber: o.order_number,
        customerIdentifier: (o as Order & { customer_identifier?: string }).customer_identifier ?? null,
        payload: { carrier_name: "OTO", error_message: (e as Error).message },
      });
      return { error: `فشل إنشاء الشحنة عبر OTO: ${(e as Error).message}` };
    }
  }

  // Fallback: direct carrier shipment
  let carrier: Carrier | null = null;
  if (carrierId) {
    const { data } = await supabase.from("carriers").select("*").eq("id", carrierId).maybeSingle();
    carrier = (data as Carrier) || null;
  }
  if (!carrier && o.carrier_code) {
    carrier = await getCarrierByCode(o.carrier_code);
  }
  if (!carrier) {
    const all = await getCarriers();
    const api = all.filter((c) => c.mode === "api" && c.provider !== "oto");
    carrier = api[0] || all[0] || null;
  }
  if (!carrier) return { error: "لا توجد شركة شحن مسجلة — أضف شركة من صفحة الشحن" };

  const weightGrams = await computeWeightGrams(supabase, o);
  const description = (o.items || []).map((it) => `${it.name} ×${it.qty}`).join("، ").slice(0, 100) || "طلب متجر";

  // Fixed-price carriers: manual shipment record (no API call)
  if (carrier.mode !== "api") {
    await supabase.from("orders").update({
      carrier_code: carrier.code,
      shipping_method: carrier.name,
      status: "shipped",
    }).eq("id", orderId);

    const { data: existingShip } = await supabase.from("shipments").select("id").eq("order_id", orderId).maybeSingle();
    if (existingShip) {
      await supabase.from("shipments").update({
        delivery_company: carrier.name,
        status: "processing",
        updated_at: new Date().toISOString(),
      }).eq("id", existingShip.id);
    } else {
      await supabase.from("shipments").insert({
        order_id: orderId,
        delivery_company: carrier.name,
        status: "processing",
      });
    }

    await logOrderStatusChange(orderId, o.status, "shipped", "admin", `شحن يدوي عبر ${carrier.name}`);

    await emitNotification({
      source: "system",
      externalEventId: `shipment.created.${orderId}.manual.${Date.now()}`,
      eventType: "shipment.created",
      orderId,
      orderNumber: o.order_number,
      customerIdentifier: (o as Order & { customer_identifier?: string }).customer_identifier ?? null,
      payload: { carrier_name: carrier.name },
    });

    revalidatePath("/admin/orders");
    revalidatePath("/admin/shipments");
    revalidatePath("/admin/dashboard");
    return { success: true, trackingNumber: null, trackingUrl: null, message: `تم تسجيل الشحنة يدوياً عبر ${carrier.name}` };
  }

  try {
    const result = await createCarrierShipment(carrier, {
      reference: `GS-${o.order_number}`,
      customerName: o.customer_name,
      customerPhone: o.customer_phone,
      city: o.customer_city,
      region: o.region,
      address: o.address || o.national_address,
      weightGrams,
      description,
    });

    const { error: updateError } = await supabase
      .from("orders")
      .update({
        tracking_number: result.trackingNumber,
        tracking_url: result.trackingUrl,
        carrier_code: carrier.code,
        shipping_method: carrier.name,
        status: "shipped",
      })
      .eq("id", orderId);
    if (updateError) return { error: updateError.message };

    await emitNotification({
      source: "system",
      externalEventId: `shipment.created.${orderId}.${result.trackingNumber ?? "direct"}`,
      eventType: "shipment.created",
      orderId,
      orderNumber: o.order_number,
      customerIdentifier: (o as Order & { customer_identifier?: string }).customer_identifier ?? null,
      payload: { carrier_name: carrier.name, tracking_number: result.trackingNumber, tracking_url: result.trackingUrl },
    });

    revalidatePath("/admin/orders");
    revalidatePath("/admin/dashboard");
    return { success: true, trackingNumber: result.trackingNumber, trackingUrl: result.trackingUrl };
  } catch (e) {
    await emitNotification({
      source: "system",
      externalEventId: `shipment.failed.${orderId}.${Date.now()}`,
      eventType: "shipment.failed",
      orderId,
      orderNumber: o.order_number,
      customerIdentifier: (o as Order & { customer_identifier?: string }).customer_identifier ?? null,
      payload: { carrier_name: carrier.name, error_message: (e as Error).message },
    });
    return { error: (e as Error).message };
  }
}

export async function addOrderNoteAction(formData: FormData) {
  const orderId = formData.get("order_id") as string;
  const content = formData.get("content") as string;
  if (!orderId || !content?.trim()) return { error: "بيانات ناقصة" };

  const supabase = createAdminClient();
  try {
    const { error } = await supabase.from("order_notes").insert({
      order_id: orderId,
      content: content.trim(),
      author: "admin",
      is_internal: true,
    });
    if (error) {
      if (error.message?.includes("Could not find the table") || (error as any).code === "42P01" || (error as any).code === "PGRST205") {
        return { error: "جدول الملاحظات غير مفعّل — شغّل sql/migration-012.sql في Supabase SQL Editor أولاً" };
      }
      return { error: error.message };
    }
  } catch {
    return { error: "جدول الملاحظات غير مفعّل — شغّل sql/migration-012.sql في Supabase SQL Editor أولاً" };
  }
  revalidatePath(`/admin/orders/${orderId}`);
  return { success: true };
}

export async function deleteOrderNoteAction(noteId: string, orderId: string) {
  if (!noteId) return { error: "معرف الملاحظة مطلوب" };
  const supabase = createAdminClient();
  try {
    const { error } = await supabase.from("order_notes").delete().eq("id", noteId);
    if (error) {
      if (error.message?.includes("Could not find the table") || (error as any).code === "42P01" || (error as any).code === "PGRST205") {
        return { error: "جدول الملاحظات غير مفعّل — شغّل sql/migration-012.sql في Supabase SQL Editor أولاً" };
      }
      return { error: error.message };
    }
  } catch {
    return { error: "جدول الملاحظات غير مفعّل — شغّل sql/migration-012.sql في Supabase SQL Editor أولاً" };
  }
  revalidatePath(`/admin/orders/${orderId}`);
  return { success: true };
}

export async function searchOrdersAction(query: string, status?: string) {
  const supabase = createAdminClient();
  let qb = supabase.from("orders").select("*");

  if (query) {
    const q = `%${query}%`;
    qb = qb.or(`customer_name.ilike.${q},customer_phone.ilike.${q},order_number.eq.${query || 0},email.ilike.${q}`);
  }
  if (status && status !== "all") {
    qb = qb.eq("status", status);
  }

  const { data } = await qb.order("created_at", { ascending: false }).limit(100);
  return data || [];
}

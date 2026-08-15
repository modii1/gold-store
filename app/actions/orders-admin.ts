"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCarrierByCode, getCarriers } from "@/lib/services/carriers";
import { createCarrierShipment } from "@/lib/shipping";
import { otoCreateOrder, getAccessToken } from "@/lib/oto/client";
import { logOrderStatusChange } from "@/lib/orders/status-log";
import type { Order, Carrier } from "@/types";

export async function updateOrderStatusAction(formData: FormData) {
  const id = formData.get("id") as string;
  const status = formData.get("status") as string;
  if (!id || !status) return { error: "بيانات ناقصة" };

  const supabase = createAdminClient();

  const { data: current } = await supabase.from("orders").select("status").eq("id", id).maybeSingle();
  const oldStatus = current?.status || null;

  const { error } = await supabase.from("orders").update({ status }).eq("id", id);
  if (error) return { error: error.message };

  await logOrderStatusChange(id, oldStatus, status, "admin");

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${id}`);
  revalidatePath("/admin/dashboard");
  return { success: true };
}

export async function deleteOrderAction(formData: FormData) {
  const id = formData.get("id") as string;
  if (!id) return { error: "معرف مطلوب" };

  const supabase = createAdminClient();
  const { error } = await supabase.from("orders").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/orders");
  revalidatePath("/admin/dashboard");
  return { success: true };
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

        const shipRow = {
          order_id: orderId,
          oto_order_id: otoOrderId ? Number(otoOrderId) : null,
          delivery_option_id: optionId,
          delivery_company: created.deliveryCompany || null,
          delivery_option_name: created.deliveryOptionName || null,
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
  if (carrier.mode !== "api") return { error: `شركة «${carrier.name}» في وضع السعر الثابت — لا تدعم إنشاء شحنة تلقائية` };

  const weightGrams = await computeWeightGrams(supabase, o);
  const description = (o.items || []).map((it) => `${it.name} ×${it.qty}`).join("، ").slice(0, 100) || "طلب متجر";

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

    revalidatePath("/admin/orders");
    revalidatePath("/admin/dashboard");
    return { success: true, trackingNumber: result.trackingNumber, trackingUrl: result.trackingUrl };
  } catch (e) {
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
    if (error) return { error: error.message };
  } catch {
    return { error: "جدول الملاحظات غير مفعّل — شغّل migration-012 في Supabase" };
  }
  revalidatePath(`/admin/orders/${orderId}`);
  return { success: true };
}

export async function deleteOrderNoteAction(noteId: string, orderId: string) {
  if (!noteId) return { error: "معرف الملاحظة مطلوب" };
  const supabase = createAdminClient();
  try {
    const { error } = await supabase.from("order_notes").delete().eq("id", noteId);
    if (error) return { error: error.message };
  } catch {
    return { error: "جدول الملاحظات غير مفعّل" };
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

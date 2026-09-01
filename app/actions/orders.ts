"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOtoRates } from "@/lib/oto/rates";
import { getCustomerSession, setCustomerSession } from "@/lib/auth";
import { normalizePhoneInternational } from "@/lib/format";
import { emitNotification } from "@/lib/notifications/engine";
import { sendCustomerWhatsApp } from "@/lib/customer-messaging";
import type { Coupon, Carrier, PaymentMethod, Order } from "@/types";

export async function getCheckoutData() {
  const supabase = await createClient();
  const [{ data: payment }] = await Promise.all([
    supabase.from("payment_methods").select("*").eq("is_active", true).order("sort_order"),
  ]);
  let shipping: Carrier[] = [];
  try {
    const { data: carriers, error } = await supabase
      .from("carriers").select("*").eq("is_active", true).order("sort_order", { ascending: true });
    if (!error && (carriers as Carrier[] | null)?.length) shipping = carriers as Carrier[];
  } catch {
    // ignore
  }
  if (!shipping.length) {
    const { data: legacy, error } = await supabase
      .from("shipping_methods").select("*").eq("is_active", true).order("sort_order");
    if (!error && legacy?.length) {
      shipping = (legacy as any[]).map((s) => ({
        ...s,
        code: s.code || "manual",
        mode: "flat" as const,
        config: null,
        free_above: s.free_above ?? null,
        estimated_days: null,
      }));
    }
  }

  // Default store city (from OTO origin) used to show shipping options immediately
  // when the customer picks a spot on the map, without waiting for a full address lookup.
  let defaultCity = "بريدة";
  try {
    const { data: otoCfg } = await createAdminClient().from("oto_config").select("origin_city").eq("id", 1).maybeSingle();
    if ((otoCfg as { origin_city?: string } | null)?.origin_city) defaultCity = (otoCfg as { origin_city: string }).origin_city;
  } catch {
    // ignore
  }

  return {
    shipping,
    payment: (payment as PaymentMethod[]) || [],
    defaultCity,
  };
}

export async function getOrdersByPhoneAction(phone: string): Promise<Order[]> {
  const trimmed = phone.trim();
  if (!trimmed) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("orders")
    .select("*")
    .eq("customer_identifier", trimmed)
    .order("created_at", { ascending: false })
    .limit(20);
  return (data as Order[]) || [];
}

export async function validateCouponAction(code: string, subtotal: number): Promise<Coupon | { error: string }> {
  const trimmed = code.trim();
  if (!trimmed) return { error: "أدخلي كود الخصم" };
  const supabase = createAdminClient();
  const { data } = await supabase.from("coupons").select("*").eq("code", trimmed).maybeSingle();
  if (!data) return { error: "كود الخصم غير صحيح" };
  const c = data as Coupon;
  if (!c.is_active) return { error: "كود الخصم غير فعال" };
  if (c.ends_at && new Date(c.ends_at) < new Date()) return { error: "انتهت صلاحية الكود" };
  if (c.usage_limit !== null && c.used_count >= c.usage_limit) return { error: "استُهلك الكود" };
  if (c.min_order > 0 && subtotal < c.min_order) return { error: `الحد الأدنى للطلب ${c.min_order.toLocaleString("en-US")}` };
  return c;
}

export async function createOrderAction(formData: FormData) {
  const name = (formData.get("name") as string).trim();
  const rawPhone = (formData.get("phone") as string).trim();
  const email = (formData.get("email") as string).trim() || null;
  const city = (formData.get("city") as string).trim() || null;
  const region = (formData.get("region") as string).trim() || null;
  const address = (formData.get("address") as string).trim() || null;
  const nationalAddress = (formData.get("national_address") as string).trim() || null;
  const buildingNumberRaw = (formData.get("building_number") as string).trim() || "";
  // Saudi National Address building number is exactly 4 digits (e.g. 1234).
  // Reject anything that isn't exactly 4 digits; empty is allowed.
  const buildingNumber = buildingNumberRaw ? (/^\d{4}$/.test(buildingNumberRaw) ? buildingNumberRaw : null) : null;
  if (buildingNumberRaw && !buildingNumber) return { error: "رقم المبنى يجب أن يكون 4 أرقام فقط" };
  const latitude = Number(formData.get("latitude")) || null;
  const longitude = Number(formData.get("longitude")) || null;
  const mapsUrl = (formData.get("maps_url") as string)?.trim() || null;
  const notes = (formData.get("notes") as string).trim() || null;
  const shippingId = formData.get("shipping_method") as string;
  const paymentName = (formData.get("payment_method") as string) || null;
  const transferReceiptUrl = (formData.get("transfer_receipt_url") as string)?.trim() || null;
  const couponCode = (formData.get("coupon_code") as string)?.trim() || null;

  const items = JSON.parse((formData.get("items") as string) || "[]");
  const subtotal = parseFloat(formData.get("subtotal") as string);
  const shippingCost = parseFloat(formData.get("shipping_cost") as string) || 0;
  const discount = parseFloat(formData.get("discount") as string) || 0;

  if (!name) return { error: "الاسم مطلوب" };

  // رقمٌ موحّد من مصدر واحد: العميل المسجل يحتفظ بمعرّف حسابه (لتبقى طلباته
  // مجمعة مع سجلِّه)، والجوال الجديد يُدوَّن بالصيغة الدولية 9665xxxxxxxx قصراً.
  const session = await getCustomerSession();
  let phone: string;
  if (session) {
    phone = session.phone;
  } else {
    const normalized = normalizePhoneInternational(rawPhone);
    if (!normalized) return { error: "رقم الجوال غير صحيح — الصيغة المسموحة: 9665xxxxxxxx (دولي)" };
    phone = normalized;
  }
  if (!phone) return { error: "رقم الجوال مطلوب" };
  // رقم الاتصال المعروض لشركة الشحن/OTO يبقى كما أدخله العميل (يُوحَّد فقط
  // للعملاء الجدد) حتى لا يتأثر نظام الشحن برقم الحساب.
  const contactPhone = session ? rawPhone : phone;
  if (!items || items.length === 0) return { error: "السلة فارغة" };

  const supabase = await createClient();

  // Resolve shipping by id to get authoritative cost (carriers table, fallback to legacy shipping_methods)
  let finalShipping = shippingCost;
  let shippingName: string | null = null;
  let shippingOptionId: number | null = null;
  if (shippingId) {
    if (shippingId.startsWith("oto:")) {
      const optionId = parseInt(shippingId.split(":")[1], 10);
      if (optionId) {
        // لا نُسقط خيار OTO أبداً: نحتفظ بمعرّفه حتى لو فشل جلب الأسعار لاحقاً،
        // وإلا يُنشأ الطلب بلا خيار توصيل ولا يُرسل إلى OTO من لوحة الشحن.
        shippingOptionId = optionId;
        try {
          const supabaseAdmin = createAdminClient();
          const { data: cfg } = await supabaseAdmin.from("oto_config").select("is_connected, origin_city, origin_country").eq("id", 1).maybeSingle();
          if ((cfg as any)?.is_connected) {
            const rates = await getOtoRates({
              destinationCity: city || "",
              weightKg: (JSON.parse((formData.get("weight_kg") as string) || "0") as number) || 1,
            });
            const match = rates.find((r) => r.optionId === optionId);
            if (match) {
              finalShipping = match.price;
              shippingName = match.optionName;
            }
          }
        } catch {
          // fall back to submitted value
        }
        if (!shippingName) {
          const { data: opt } = await supabase
            .from("carriers")
            .select("delivery_option_id, name, mode, provider")
            .eq("delivery_option_id", optionId)
            .limit(1)
            .maybeSingle();
          shippingName = (opt as { name?: string } | null)?.name || null;
        }
      }
    } else {
      const { data: carrier } = await supabase.from("carriers").select("*").eq("id", shippingId).maybeSingle();
      if (carrier) {
        finalShipping = carrier.free_above && subtotal >= carrier.free_above ? 0 : carrier.cost;
        shippingName = carrier.name;
      } else {
        const { data: sm } = await supabase.from("shipping_methods").select("*").eq("id", shippingId).maybeSingle();
        if (sm) {
          finalShipping = sm.free_above && subtotal >= sm.free_above ? 0 : sm.cost;
          shippingName = sm.name;
        }
      }
    }
  }

  // Validate coupon server-side
  let finalDiscount = 0;
  if (couponCode) {
    const coupon = await validateCouponAction(couponCode, subtotal);
    if ("error" in coupon) return coupon;
    finalDiscount = coupon.type === "percent" ? (subtotal * coupon.value) / 100 : coupon.value;
    finalDiscount = Math.min(finalDiscount, subtotal);
  }

  const total = subtotal + finalShipping - finalDiscount;
  const orderNumber = (crypto.getRandomValues(new Uint32Array(1))[0] % 999999) + 1;

  // Guard against double-submit: if this customer just placed an identical order
  // within the last 20 seconds, return the existing order instead of creating a duplicate.
  const { data: latestOrder } = await supabase
    .from("orders")
    .select("id, order_number, total, items, created_at")
    .eq("customer_identifier", phone)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestOrder) {
    const elapsedMs = Date.now() - new Date(latestOrder.created_at).getTime();
    type LineItem = { product_id?: string | number; qty?: number; price?: number };
    const normalizeItems = (list: LineItem[] | null) =>
      JSON.stringify((list || []).map((i) => [i.product_id, i.qty, i.price]));
    const sameItems = normalizeItems(latestOrder.items as LineItem[] | null) === normalizeItems(items as LineItem[]);
    if (elapsedMs >= 0 && elapsedMs < 20_000 && sameItems && Math.abs((latestOrder.total || 0) - Math.max(0, total)) < 0.01) {
      revalidatePath("/admin/orders");
      revalidatePath("/admin/dashboard");
      return { success: true, orderNumber: latestOrder.order_number };
    }
  }

  const { data: inserted, error } = await supabase
    .from("orders")
    .insert({
      customer_name: name,
      customer_phone: contactPhone,
      customer_identifier: phone,
      email,
      customer_city: city,
      region,
      address,
      building_number: buildingNumber,
      national_address: nationalAddress,
      latitude,
       longitude,
       maps_url: mapsUrl,
      items,
      total: Math.max(0, total),
      shipping_cost: finalShipping,
      discount: finalDiscount,
      coupon_code: couponCode,
      shipping_method: shippingName,
      delivery_option_id: shippingOptionId,
      payment_method: paymentName,
      transfer_receipt_url: transferReceiptUrl,
      notes,
      status: "pending",
      order_number: orderNumber,
    })
    .select()
    .single();

  if (error) return { error: error.message };

  // Notification Engine — order created (non-blocking, never fails checkout)
  await emitNotification({
    source: "system",
    externalEventId: `order.created.${inserted.id}`,
    eventType: "order.created",
    orderId: (inserted as { id: string }).id,
    orderNumber,
    customerIdentifier: phone,
    payload: {
      customer_name: name,
      customer_phone: contactPhone,
      order_number: orderNumber,
      order_total: Math.max(0, total),
    },
  });

  const customer = await autoCreateCustomerAccount(name, phone, email, orderNumber);
  const effectiveSession = customer || session;
  if (effectiveSession && (city || region || address || latitude || longitude)) {
    const admin = createAdminClient();
    const { data: existing } = await admin.from("addresses").select("id").eq("customer_identifier", phone).eq("city", city || null).eq("address", address || null).maybeSingle();
    if (existing?.id) {
      await admin.from("addresses").update({ region: region || null, building_number: buildingNumber, national_address: nationalAddress || null, latitude: latitude || null, longitude: longitude || null, maps_url: mapsUrl || null }).eq("id", existing.id);
    } else {
      const { count } = await admin.from("addresses").select("id", { count: "exact", head: true }).eq("customer_identifier", phone);
      await admin.from("addresses").insert({ customer_identifier: phone, full_name: name, phone, label: "عنوان الطلب", city: city || null, region: region || null, address: address || null, building_number: buildingNumber, national_address: nationalAddress || null, latitude: latitude || null, longitude: longitude || null, maps_url: mapsUrl || null, is_default: !count });
    }
    revalidatePath("/account");
  }

  if (couponCode && finalDiscount > 0) {
    const admin = createAdminClient();
    const { data: c } = await admin.from("coupons").select("used_count").eq("code", couponCode).maybeSingle();
    if (c) {
      await admin.from("coupons").update({ used_count: (c.used_count ?? 0) + 1 }).eq("code", couponCode);
    }
  }

  revalidatePath("/admin/orders");
  revalidatePath("/admin/dashboard");
  return { success: true, orderNumber };
}

/**
 * عند إنشاء طلب من جوال لم يسجل صاحبه الدخول: يُفتح حساب العميل للجلسة
 * تلقائياً ليظهر الطلب ضمن "طلباتي". إن لم يكن للحساب وجود يُنشأ فوراً بكلمة
 * مرور سهلة (آخر 6 أرقام للجوال) ويُرسل "تم إنشاء حسابك" مع كلمة المرور عبر
 * واتساب. لا يمس الحسابات القائمة ولا إعدادات الإشعارات.
 */
async function autoCreateCustomerAccount(
  name: string,
  phone: string,
  email: string | null,
  orderNumber: number
): Promise<{ id: string; name: string; phone: string } | null> {
  if (await getCustomerSession()) return null; // جلسة قائمة = حساب موجود

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("customers")
    .select("id, name, phone")
    .eq("phone", phone)
    .maybeSingle();

  // الحساب موجود مسبقاً لكن العميل لم يسجل الدخول — نفتح الجلسة تلقائياً فقط.
  if (existing) {
    const c = existing as { id: string; name: string; phone: string };
    await setCustomerSession(c);
    return c;
  }

  const easyPassword = phone.slice(-6);
  const { data: created, error } = await admin.rpc("create_customer", {
    p_phone: phone,
    p_name: name,
    p_email: email,
    p_password: easyPassword,
  });

  const newCustomer = Array.isArray(created) ? created[0] : created;

  // سباق محتمل (طلبان متزامنان لأول مرة): الحساب أنشأه الطلب الآخر — نفتح الجلسة
  // فقط دون إرسال رسالة مكررة (منفّذ السباق أرسلها).
  if (!newCustomer && error) {
    const msg = String(error.message || "").toLowerCase();
    if (msg.includes("phone_exists") || msg.includes("duplicate key")) {
      const { data: raced } = await admin
        .from("customers")
        .select("id, name, phone")
        .eq("phone", phone)
        .maybeSingle();
      if (raced) {
        await setCustomerSession({ id: raced.id, name: raced.name, phone: raced.phone });
        return raced as { id: string; name: string; phone: string };
      }
    }
    console.error("[orders] auto-create customer failed:", error.message);
    return null;
  }

  if (!newCustomer) return null;

  await setCustomerSession({ id: newCustomer.id, name: newCustomer.name, phone: newCustomer.phone });

  try {
    const { data: settingsRow } = await admin.from("settings").select("site_name").eq("id", 1).maybeSingle();
    const storeName = (settingsRow as { site_name?: string } | null)?.site_name || "المتجر";
    await sendCustomerWhatsApp({
      phone: newCustomer.phone,
      title: "تم إنشاء حسابك",
      message:
        `مرحباً ${newCustomer.name}، تم إنشاء حسابك في ${storeName} تلقائياً عند استلام طلبك رقم #${orderNumber}.` +
        ` كلمة المرور للدخول لحسابك: ${easyPassword}. أدخلي رقم الجوال وكلمة المرور من صفحة "تسجيل الدخول" وستجدين طلبك ضمن "طلباتي".`,
      orderNumber,
    });
  } catch (e) {
    console.error("[orders] welcome whatsapp failed:", e);
  }

  return newCustomer as { id: string; name: string; phone: string };
}

export async function getCustomerOrderDetailsAction(orderId: string) {
  const session = await getCustomerSession();
  if (!session) return { error: "غير مصرح" };

  const supabase = await createClient();
  const { data: order } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .eq("customer_identifier", session.phone)
    .maybeSingle();

  if (!order) return { error: "الطلب غير موجود" };

  const admin = createAdminClient();
  const shipments = await admin
    .from("shipments")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false });

  const statusLog = await admin
    .from("order_status_log")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });

  return {
    order: order as Order,
    shipments: shipments.data || [],
    statusLog: (statusLog.data || []) as { id: string; order_id: string; old_status: string | null; new_status: string; changed_by: string | null; note: string | null; created_at: string }[],
  };
}

export async function cancelOrderAction(orderId: string) {
  const session = await getCustomerSession();
  if (!session) return { error: "غير مصرح" };

  const customerClient = await createClient();
  const { data: order } = await customerClient
    .from("orders")
    .select("id, status")
    .eq("id", orderId)
    .eq("customer_identifier", session.phone)
    .maybeSingle();

  if (!order) return { error: "الطلب غير موجود" };
  if (!["pending"].includes(order.status)) {
    return { error: "لا يمكن إلغاء الطلب في هذه المرحلة" };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("orders").update({ status: "cancelled" }).eq("id", orderId);
  if (error) return { error: error.message };

  await admin.from("order_status_log").insert({
    order_id: orderId,
    old_status: order.status,
    new_status: "cancelled",
    changed_by: session.phone,
    note: "تم الإلغاء من قبل العميل",
  });

  revalidatePath("/account");
  revalidatePath("/admin/orders");
  return { success: true };
}

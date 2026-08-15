"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOtoRates } from "@/lib/oto/rates";
import { getCustomerSession } from "@/lib/auth";
import type { Coupon, Carrier, PaymentMethod, Order } from "@/types";

export async function getCheckoutData() {
  const supabase = await createClient();
  const [{ data: payment }] = await Promise.all([
    supabase.from("payment_methods").select("*").eq("is_active", true).order("sort_order"),
  ]);

  // Try carriers first; if the table doesn't exist yet, fall back to legacy shipping_methods
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

  return {
    shipping,
    payment: (payment as PaymentMethod[]) || [],
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
  const phone = (formData.get("phone") as string).trim();
  const email = (formData.get("email") as string).trim() || null;
  const city = (formData.get("city") as string).trim() || null;
  const region = (formData.get("region") as string).trim() || null;
  const address = (formData.get("address") as string).trim() || null;
  const nationalAddress = (formData.get("national_address") as string).trim() || null;
  const latitude = Number(formData.get("latitude")) || null;
  const longitude = Number(formData.get("longitude")) || null;
  const mapsUrl = (formData.get("maps_url") as string)?.trim() || null;
  const notes = (formData.get("notes") as string).trim() || null;
  const shippingId = formData.get("shipping_method") as string;
  const paymentName = (formData.get("payment_method") as string) || null;
  const couponCode = (formData.get("coupon_code") as string)?.trim() || null;

  const items = JSON.parse((formData.get("items") as string) || "[]");
  const subtotal = parseFloat(formData.get("subtotal") as string);
  const shippingCost = parseFloat(formData.get("shipping_cost") as string) || 0;
  const discount = parseFloat(formData.get("discount") as string) || 0;

  if (!name) return { error: "الاسم مطلوب" };
  if (!phone) return { error: "رقم الجوال مطلوب" };
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
              shippingOptionId = optionId;
            }
          }
        } catch {
          // fall back to submitted value
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
  const orderNumber = Date.now() % 1000000;

  const { data: inserted, error } = await supabase
    .from("orders")
    .insert({
      customer_name: name,
      customer_phone: phone,
      customer_identifier: phone,
      email,
      customer_city: city,
      region,
      address,
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
      notes,
      status: "pending",
      order_number: orderNumber,
    })
    .select()
    .single();

  if (error) return { error: error.message };

  const customer = await getCustomerSession();
  if (customer && customer.phone === phone && (city || region || address || latitude || longitude)) {
    const admin = createAdminClient();
    const { data: existing } = await admin.from("addresses").select("id").eq("customer_identifier", phone).eq("city", city || null).eq("address", address || null).maybeSingle();
    if (existing?.id) {
      await admin.from("addresses").update({ region: region || null, national_address: nationalAddress || null, latitude: latitude || null, longitude: longitude || null, maps_url: mapsUrl || null }).eq("id", existing.id);
    } else {
      const { count } = await admin.from("addresses").select("id", { count: "exact", head: true }).eq("customer_identifier", phone);
      await admin.from("addresses").insert({ customer_identifier: phone, full_name: name, phone, label: "عنوان الطلب", city: city || null, region: region || null, address: address || null, national_address: nationalAddress || null, latitude: latitude || null, longitude: longitude || null, maps_url: mapsUrl || null, is_default: !count });
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

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOtoRates } from "@/lib/oto/rates";
import { getCustomerSession, setCustomerSession } from "@/lib/auth";
import { normalizePhoneInternational } from "@/lib/format";
import { emitNotification } from "@/lib/notifications/engine";
import { sendCustomerWhatsApp } from "@/lib/customer-messaging";
import { isFreeShippingEligible } from "@/lib/shipping/types";
import { getSettings } from "@/lib/services/settings";
import {
  COUPON_EMPTY_MESSAGE,
  couponRejectMessage,
  discountForCoupon,
  evaluateCoupon,
  normalizeCouponCode,
} from "@/lib/coupons/policy";
import type { BoundCouponRecord } from "@/lib/coupons/policy";
import { redeemCouponForOrder } from "@/lib/coupons/redeem";
import type { AtomicRedeemRow, CouponRedeemStore } from "@/lib/coupons/redeem";
import type { CouponUsageStore } from "@/lib/coupons/usage";
import {
  buildOrderPricing,
  looksLikeUuid,
  PRICING_MESSAGES,
  verifySubmittedSubtotal,
  type CatalogLoader,
  type CatalogProduct,
  type CatalogVariant,
} from "@/lib/orders/pricing";
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

/**
 * G6-B / S2 — كل قراءة `orders` تمرّ بـservice role بعد إفلاس الجوال من التوقيع.
 * `public select orders` (RLS) كان يعني أن أي زائر يمرّر رقم جوال فيACTION
 * يسترجع طلبات غيره كاملة (اسم، عنوان، عنوان وطني، إحداثيات، ملاحظات، كود خصم).
 * السلوك المرئي لم يتغيّر: صفحة الحساب تستدعيها بـsession.phone دائمًا.
 */
export async function getOrdersByPhoneAction(): Promise<Order[]> {
  const session = await getCustomerSession();
  if (!session) return [];

  const admin = createAdminClient();
  const { data } = await admin
    .from("orders")
    .select("*")
    .eq("customer_identifier", session.phone)
    .order("created_at", { ascending: false })
    .limit(20);
  return (data as Order[]) || [];
}

/**
 * فحص الكود على الخادم (المعاينة عند الضغط، ثم يُعاد الفحص نفسه عند الإرسال).
 *
 * G6-A: (1) الكود يُطبَّع (trim + uppercase) فيتصرف gold10 كـ GOLD10؛
 * (2) starts_at صار مفحوصًا (كان عمودًا مهملًا)؛
 * (3) كل أسباب الرفض ترجع للعميل برسالة واحدة — التحقق لم يعد oracle يكشف
 *     وجود الكود أو حالته؛ السبب الدقيق يبقى داخليًا في السجل بلا الكود.
 */
export async function validateCouponAction(
  code: string,
  subtotal: number,
  customerIdentifier?: string | null
): Promise<Coupon | { error: string }> {
  const normalized = normalizeCouponCode(code);
  if (!normalized) return { error: COUPON_EMPTY_MESSAGE };
  const supabase = createAdminClient();
  const { data } = await supabase.from("coupons").select("*").eq("code", normalized).maybeSingle();
  if (!data) {
    console.warn("[coupon] rejected", { reason: "not_found" });
    return { error: couponRejectMessage() };
  }
  const c = data as Coupon & BoundCouponRecord;
  // G6-C: القسيمة المربوطة تُفحص بمالكها المشتق من الخادم. المعاينة في
  // السلة لا تمرّر معرّفًا (فلا تكشف شيئًا)، والنقطة الحاسمة في إنشاء الطلب.
  const result = evaluateCoupon(c, { now: Date.now(), subtotal, customerIdentifier: customerIdentifier ?? null });
  if (!result.ok) {
    console.warn("[coupon] rejected", { reason: result.reason });
    return { error: couponRejectMessage() };
  }
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
  const couponCode = normalizeCouponCode(formData.get("coupon_code") as string) || null;

  const items = parseCartItems(formData.get("items"));
  // G6-B / S6: الرقم المرسل لم يعد مصدرًا للخصم ولا للشحن ولا لعتبة الحد الأدنى —
  // يُستخدم للمقارنة فقط مع ما يحسبه الخادم من `products`/`product_variants`.
  const submittedSubtotal = Number(formData.get("subtotal"));
  const shippingCost = parseFloat(formData.get("shipping_cost") as string) || 0;

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
  if (!Array.isArray(items) || items.length === 0) return { error: "السلة فارغة" };

  const admin = createAdminClient();

  // G6-B / S6 — مصدر الحقيقة الخادم. يفشل مغلقًا: أي عنصر لا يُسعَّر من
  // الكتالوج ⇒ لا طلب (لا رجوع إلى رقم العميل أبدًا). لا migration ولا RPC.
  const pricing = await buildOrderPricing(items, supabaseCatalogLoader(admin));
  if (!pricing.ok) {
    console.warn("[checkout] pricing rejected", { reason: pricing.reason });
    return { error: PRICING_MESSAGES[pricing.reason] };
  }
  // `priceSnapshot` (الأسعار على الخادم) متاح في نفس النتيجة لكنه لا يُكتب في
  // الطلب: جدول orders لا يملك عمودًا له، و`items` المخزَّنة رقم العميل وقد
  // تم التحقق منه ضمن 1 هللة. حفظ snapshot مستقل يحتاج migration.
  const { subtotal } = pricing;
  const submitted = verifySubmittedSubtotal(submittedSubtotal, subtotal);
  if (!submitted.ok) {
    console.warn("[checkout] subtotal mismatch", {
      reason: submitted.reason,
      submitted: Number.isFinite(submittedSubtotal) ? submittedSubtotal : null,
      server: subtotal,
    });
    return { error: PRICING_MESSAGES[submitted.reason] };
  }

  const supabase = await createClient();
  const storeSettings = await getSettings();

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
          const { data: cfg } = await admin.from("oto_config").select("is_connected, origin_city, origin_country").eq("id", 1).maybeSingle();
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
        finalShipping = carrier.cost;
        shippingName = carrier.name;
      } else {
        const { data: sm } = await supabase.from("shipping_methods").select("*").eq("id", shippingId).maybeSingle();
        if (sm) {
          finalShipping = sm.cost;
          shippingName = sm.name;
        }
      }
    }
  }

  if (isFreeShippingEligible(subtotal, storeSettings.free_shipping_threshold)) finalShipping = 0;

  // Validate coupon server-side (re-checked on submit, not trusted from preview).
  // The discount is recomputed here from the coupon row; the client's own
  // discount number is never used.
  // G6-C: `phone` هو المعرّف المشتق من الخادم (جلسة أو جوال مُطبَّع)، وهو
  // الذي تُفحص عليه قسيمة الاسترجاع المربوطة — لا رقم يرسله العميل.
  let finalDiscount = 0;
  if (couponCode) {
    const coupon = await validateCouponAction(couponCode, subtotal, phone);
    if ("error" in coupon) return coupon;
    finalDiscount = discountForCoupon(coupon, subtotal);
  }

  const total = subtotal + finalShipping - finalDiscount;
  const grossTotal = subtotal + finalShipping;
  const orderNumber = (crypto.getRandomValues(new Uint32Array(1))[0] % 999999) + 1;

  // Guard against double-submit: if this customer just placed an identical order
  // within the last 20 seconds, return the existing order instead of creating a duplicate.
  // G6-B / S3: service role — لم يعد يحتاج `public insert orders` ولا `public select orders`.
  const { data: latestOrder } = await admin
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

  const { data: inserted, error } = await admin
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
      // G6-C: يُدرَج الطلب أولًا **بقيمة السلة كاملة** ثم تُستبدل القسيمة
      // وتُحدَّث القيمة بعد نجاح الاستبدال. الترتيب مقصود: لا يوجد في أي
      // لحظة طلبٌ يحمل خصمًا وقسيمةٌ غير مستهلكة. الإدراج بالقيمة المخفَّضة
      // ثم محاولة الاستبدال بعده يخلّف طلبًا بخصم لا تسنده قسيمة إن فشل.
      total: Math.max(0, grossTotal),
      shipping_cost: finalShipping,
      discount: 0,
      coupon_code: null,
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

  // G6-C — استبدال القسيمة بعد حفظ الطلب لا قبله (لا استهلاك مبكر).
  // الترتيب: طلب بقيمته كاملة ← استبدال ← تحديث (الإجمالي، الخصم، الكود).
  //   · فشل الاستبدال        ⇒ الطلب بقيمته كاملة وبلا قسيمة مستهلكة.
  //   · نجاح الاستبدال وفشل التحديث ⇒ قسيمة مستهلكة بلا خصم مطبَّق: ضرر
  //     للعميل لا للمتجر، ويُسجَّل للمراجعة. عكسُه (خصم بلا استبدال) هو
  //     الخلل المالي الحقيقي، ولهذا الترتيب هو المختار.
  //   · الاستهداف النهائي معروف: RPC واحد يدرج الطلب ويستبدل القسيمة في
  //     معاملة واحدة — migration-041 مسودة لم تُنفَّذ بعد.
  if (couponCode && finalDiscount > 0) {
    const redeemed = await redeemCouponForOrder(couponRedeemStore(admin), {
      code: couponCode,
      subtotal,
      customerIdentifier: phone,
      now: Date.now(),
    });
    const orderId = (inserted as { id: string }).id;
    if (!redeemed.ok) {
      // بلا كود ولا PII في السجلّ: السبب الداخلي فقط.
      console.warn("[coupon] redeem failed — order kept at full price", { reason: redeemed.reason, mode: redeemed.mode });
    } else {
      const appliedDiscount = Math.max(0, Math.min(redeemed.discount, finalDiscount));
      if (Math.abs(redeemed.discount - finalDiscount) > 0.01) {
        // تباين بين الفحص المسبق والقاعدة: يُسجَّل بلا كود ولا PII.
        console.warn("[coupon] discount mismatch", { mode: redeemed.mode });
      }
      const { error: updateError } = await admin
        .from("orders")
        .update({ total: Math.max(0, grossTotal - appliedDiscount), discount: appliedDiscount, coupon_code: couponCode })
        .eq("id", orderId);
      if (updateError) {
        // قسيمة مستهلكة وطلب بقيمته كاملة: يُسجَّل للمراجعة اليدوية.
        console.warn("[coupon] order total update failed after redeem", { mode: redeemed.mode });
      }
    }
  }

  // Notification Engine — order created (non-blocking, never fails checkout)
  // G6-C: يُبلَّغ بالقيمة النهائية (بعد الخصم) لا بقيمة الإدراج الأولية.
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
      order_total: Math.max(0, grossTotal - (couponCode && finalDiscount > 0 ? finalDiscount : 0)),
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

  // G6-C: الاستبدال تم أعلاه مباشرة بعد الإدراج (انظر الملاحظة هناك). لا
  // استبدال مكرر هنا ولا تسجيل للكود في السجلّات.

  revalidatePath("/admin/orders");
  revalidatePath("/admin/dashboard");
  return { success: true, orderNumber };
}

/**
 * JSON.parse كان يرمي استثناءً على حمولة تالفة (500 في مسار الطلب). الآن الفشل
 * يُعامَل كسلة فارغة فيُرفض الطلب برسالة واضحة بدل 500.
 */
function parseCartItems(raw: FormDataEntryValue | null): unknown {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * G6-B / S6 — جلب كتالوج السلة عبر service role.
 * `product_variants` و`products` لهما RLS بلا سياسات (service role فقط)، فلا
 * حاجة لأي public policy لهذا الاستعلام. المعرّفات غير المطابقة لشكل UUID
 * تُستبعد من الاستعلام عمدًا حتى لا يُنتج PostgREST خطأ 400 يُربك التشخيص؛
 *عودتها `unknown_product` من التسعير النقي.
 */
function supabaseCatalogLoader(admin: ReturnType<typeof createAdminClient>): CatalogLoader {
  return async ({ productIds, variantIds }) => {
    const products = productIds.filter(looksLikeUuid);
    const variants = variantIds.filter(looksLikeUuid);

    const [productResult, variantResult] = await Promise.all([
      products.length
        ? admin.from("products").select("id, price, sale_price").in("id", products)
        : Promise.resolve({ data: [] as CatalogProduct[], error: null }),
      variants.length
        ? admin.from("product_variants").select("id, product_id, price, sale_price").in("id", variants)
        : Promise.resolve({ data: [] as CatalogVariant[], error: null }),
    ]);

    if (productResult.error) {
      console.warn("[checkout] catalog products query failed", { code: productResult.error.code });
    }
    if (variantResult.error) {
      console.warn("[checkout] catalog variants query failed", { code: variantResult.error.code });
    }

    return {
      products: (productResult.data ?? []) as CatalogProduct[],
      variants: (variantResult.data ?? []) as CatalogVariant[],
    };
  };
}

/**
 * Adaptation of the coupon table to CouponUsageStore: readByCode + a
 * compare-and-set write (`used_count = next` only when the stored value is
 * still `observed`). The WHERE clause is what makes the read→write pair safe
 * against a lost update; no new SQL and no migration involved.
 */
function couponUsageStore(admin: ReturnType<typeof createAdminClient>): CouponUsageStore {
  return {
    async readByCode(code: string) {
      const { data } = await admin
        .from("coupons")
        .select("id, code, usage_limit, used_count")
        .eq("code", code)
        .maybeSingle();
      return (data as Awaited<ReturnType<CouponUsageStore["readByCode"]>>) ?? null;
    },
    async compareAndSet(id: string, observedUsedCount: number, nextUsedCount: number) {
      const { data, error } = await admin
        .from("coupons")
        .update({ used_count: nextUsedCount })
        .eq("id", id)
        .eq("used_count", observedUsedCount)
        .select("id");
      if (error) return false;
      return Array.isArray(data) && data.length > 0;
    },
  };
}

/**
 * G6-C — adapter الاستبدال.
 *
 * `redeem_coupon` تعمل بمعاملات صريحة وتعيد الصف بعد الزيادة في معاملة واحدة
 * (SECURITY DEFINER + FOR UPDATE). غيابها (migration لم تُنفَّذ) يُكتشف مرة
 * واحدة ويُسجَّل كـwarning، ثم يسلك المسار الاحتياطي CAS الموجود أصلًا — مع
 * موسوم `mode: "cas"` حتى لا يُقرأ كتomic.
 */
function couponRedeemStore(admin: ReturnType<typeof createAdminClient>): CouponRedeemStore {
  let atomic: boolean | null = null;
  const usage = couponUsageStore(admin);
  return {
    async atomicAvailable() {
      if (atomic !== null) return atomic;
      const { error } = await admin.rpc("redeem_coupon", {
        p_code: "__probe__",
        p_subtotal: 0,
        p_customer_identifier: "",
        p_now: new Date(0).toISOString(),
      });
      // 404 / PGRST202 = الدالة غير موجودة بعد ⇒ لا atomic.
      const missing =
        error === null
          ? false
          : [404, "PGRST202", "does not exist", "function_not_found"].some((token) =>
              String(error.code ?? "").includes(String(token)) ||
              String(error.message ?? "").includes(String(token)) ||
              String(error.hint ?? "").includes(String(token))
            );
      if (missing) console.warn("[coupon] redeem_coupon unavailable — using CAS fallback");
      atomic = !missing;
      return atomic;
    },
    async redeemAtomic(input) {
      const { data, error } = await admin.rpc("redeem_coupon", {
        p_code: input.code,
        p_subtotal: input.subtotal,
        p_customer_identifier: input.customerIdentifier,
        p_now: new Date(input.now).toISOString(),
      });
      if (error) {
        const reason = error.code === "P0001" ? "invalid" : "unavailable";
        return { ok: false, reason };
      }
      const row = Array.isArray(data) ? (data[0] as AtomicRedeemRow | undefined) : (data as AtomicRedeemRow | null);
      if (!row) return { ok: false, reason: "missing" };
      return { ok: true, row };
    },
    async readByCode(code) {
      const { data } = await admin
        .from("coupons")
        .select("code, type, value, max_discount, min_order, starts_at, ends_at, usage_limit, used_count, is_active, customer_identifier")
        .eq("code", code)
        .maybeSingle();
      return (data as BoundCouponRecord | null) ?? null;
    },
    usage,
  };
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

  // G6-B / S2: service role + تحقق الملكية من الجلسة (كان الرfh العام يجلب أي طلب).
  const admin = createAdminClient();
  const { data: order } = await admin
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .eq("customer_identifier", session.phone)
    .maybeSingle();

  if (!order) return { error: "الطلب غير موجود" };

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

  // G6-B / S2: القراءة بـservice role مع فلتر الملكية (كتابة الإلغاء كانت دائمًا service role).
  const admin = createAdminClient();
  const { data: order } = await admin
    .from("orders")
    .select("id, status")
    .eq("id", orderId)
    .eq("customer_identifier", session.phone)
    .maybeSingle();

  if (!order) return { error: "الطلب غير موجود" };
  if (!["pending"].includes(order.status)) {
    return { error: "لا يمكن إلغاء الطلب في هذه المرحلة" };
  }

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

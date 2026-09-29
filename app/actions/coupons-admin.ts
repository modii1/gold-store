"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAdminSession } from "@/lib/auth";
import { adminEndsAtIso, adminStartsAtIso, normalizeCouponCode } from "@/lib/coupons/policy";

/**
 * نفس النمط الموجود في notifications-admin.ts: صفحة اللوحة محميّة بالـlayout،
 * لكن الـserver action نفسه endpoint مستقل — فالحماية تُفحص هنا لا هناك.
 */
async function requireAdminOrThrow(): Promise<boolean> {
  const isAdmin = await getAdminSession();
  if (!isAdmin) throw new Error("غير مصرح");
  return true;
}

export async function saveCouponAction(formData: FormData) {
  try {
    await requireAdminOrThrow();
  } catch {
    return { error: "غير مصرح" };
  }

  const id = formData.get("id") as string | null;
  const code = normalizeCouponCode(formData.get("code") as string);
  const type = formData.get("type") as "percent" | "fixed";
  const value = parseFloat(formData.get("value") as string) || 0;
  const min_order = parseFloat(formData.get("min_order") as string) || 0;
  const usage_limit_raw = (formData.get("usage_limit") as string)?.trim();
  const usage_limit = usage_limit_raw ? parseInt(usage_limit_raw) || 0 : null;
  // تاريخ من <input type="date"> يعني «صالح حتى آخر اليوم» بتوقيت المتجر،
  // لا منتصف ليل UTC (انحراف يوم كامل كان يجعل الكود ينتهي مبكرًا).
  const ends_at = adminEndsAtIso(formData.get("ends_at") as string);
  const starts_at = adminStartsAtIso(formData.get("starts_at") as string);
  const is_active = formData.get("is_active") === "on";

  if (!code) return { error: "كود الخصم مطلوب" };
  if (!value || value <= 0) return { error: "قيمة الخصم مطلوبة" };

  const supabase = createAdminClient();
  const payload = { code, type, value, min_order, usage_limit: usage_limit || null, starts_at, ends_at, is_active };

  if (id) {
    const { error } = await supabase.from("coupons").update(payload).eq("id", id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("coupons").insert(payload);
    if (error) return { error: error.message };
  }

  revalidatePath("/admin/coupons");
  return { success: true };
}

export async function deleteCouponAction(formData: FormData) {
  try {
    await requireAdminOrThrow();
  } catch {
    return { error: "غير مصرح" };
  }

  const id = formData.get("id") as string;
  if (!id) return { error: "معرف مطلوب" };
  const supabase = createAdminClient();
  // حذف الصف لا يمسّ الطلبات السابقة: orders.coupon_code نص بلا مرجع، فالتاريخ
  // يبقى كما هو ويُقرأ منه اسم الكود فقط.
  const { error } = await supabase.from("coupons").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/coupons");
  return { success: true };
}

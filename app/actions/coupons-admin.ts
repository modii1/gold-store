"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

export async function saveCouponAction(formData: FormData) {
  const id = formData.get("id") as string | null;
  const code = (formData.get("code") as string).trim().toUpperCase();
  const type = formData.get("type") as "percent" | "fixed";
  const value = parseFloat(formData.get("value") as string) || 0;
  const min_order = parseFloat(formData.get("min_order") as string) || 0;
  const usage_limit_raw = (formData.get("usage_limit") as string)?.trim();
  const usage_limit = usage_limit_raw ? parseInt(usage_limit_raw) || 0 : null;
  const starts_at = (formData.get("starts_at") as string)?.trim() || null;
  const ends_at = (formData.get("ends_at") as string)?.trim() || null;
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
  const id = formData.get("id") as string;
  if (!id) return { error: "معرف مطلوب" };
  const supabase = createAdminClient();
  const { error } = await supabase.from("coupons").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/coupons");
  return { success: true };
}

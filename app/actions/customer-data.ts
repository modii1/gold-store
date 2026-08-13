"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCustomerSession } from "@/lib/auth";

export async function saveCustomerAddressAction(formData: FormData) {
  const session = await getCustomerSession();
  const phone = String(formData.get("phone") || session?.phone || "").trim();
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
  if (!address.latitude || !address.longitude) return { error: "حددي موقعك من الخريطة أولاً" };
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
  const { error } = await supabase.from("return_requests").insert({
    order_id: orderId,
    customer_identifier: session.phone,
    reason: String(formData.get("reason") || "استرجاع").trim(),
    details: String(formData.get("details") || "").trim() || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/account");
  return { success: true };
}

export async function updateReturnRequestAction(formData: FormData) {
  const id = String(formData.get("id") || "");
  const status = String(formData.get("status") || "pending");
  if (!id) return { error: "معرف الطلب مطلوب" };
  const { error } = await createAdminClient().from("return_requests").update({ status, admin_note: String(formData.get("admin_note") || "").trim() || null, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/returns");
  return { success: true };
}

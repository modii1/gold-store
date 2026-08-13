"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CarrierConfig } from "@/types";

export async function saveCarrierAction(formData: FormData) {
  const id = formData.get("id") as string | null;
  const name = (formData.get("name") as string).trim();
  const code = (formData.get("code") as string).trim().toLowerCase().replace(/[^a-z0-9_]+/g, "-").replace(/^-|-$/g, "");
  const mode = formData.get("mode") === "api" ? "api" : "flat";
  const cost = parseFloat(formData.get("cost") as string) || 0;
  const freeAboveRaw = formData.get("free_above") as string;
  const free_above = freeAboveRaw && freeAboveRaw.trim() !== "" ? parseFloat(freeAboveRaw) || null : null;
  const estimated_days = (formData.get("estimated_days") as string)?.trim() || null;
  const sort_order = parseInt(formData.get("sort_order") as string) || 0;
  const is_active = formData.get("is_active") === "on";
  const logo_url = (formData.get("logo_url") as string)?.trim() || null;

  if (!name || !code) return { error: "الاسم والرمز مطلوبان" };

  const config: CarrierConfig = {};
  const apiUsername = (formData.get("api_username") as string)?.trim() || "";
  const apiPassword = (formData.get("api_password") as string)?.trim() || "";
  const apiKey = (formData.get("api_key") as string)?.trim() || "";
  const accountNumber = (formData.get("account_number") as string)?.trim() || "";
  const clientCode = (formData.get("client_code") as string)?.trim() || "";
  const endpoint = (formData.get("endpoint") as string)?.trim() || "";
  if (apiUsername) config.username = apiUsername;
  if (apiPassword) config.password = apiPassword;
  if (apiKey) config.apiKey = apiKey;
  if (accountNumber) config.accountNumber = accountNumber;
  if (clientCode) config.clientCode = clientCode;
  if (endpoint) config.endpoint = endpoint;

  const supabase = createAdminClient();
  const provider = (formData.get("provider") as string) || "manual";
  const delivery_option_id = parseInt(formData.get("delivery_option_id") as string) || null;
  const service_type = (formData.get("service_type") as string)?.trim() || null;
  const payload = { name, code, mode, cost, free_above, estimated_days, sort_order, is_active, logo_url, config, provider, delivery_option_id, service_type };

  if (id) {
    const { error } = await supabase.from("carriers").update(payload).eq("id", id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("carriers").insert(payload);
    if (error) return { error: error.message };
  }

  revalidatePath("/admin/shipping");
  revalidatePath("/checkout");
  revalidatePath("/");
  return { success: true };
}

export async function deleteCarrierAction(formData: FormData) {
  const id = formData.get("id") as string;
  if (!id) return { error: "معرف مطلوب" };
  const supabase = createAdminClient();
  const { error } = await supabase.from("carriers").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/shipping");
  revalidatePath("/checkout");
  return { success: true };
}

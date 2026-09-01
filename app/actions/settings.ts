"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

export async function updateSettingsAction(formData: FormData) {
  const fields = [
    "site_name", "store_logo", "hero_image", "hero_image_mobile",
    "hero_title", "hero_subtitle", "hero_cta_text", "hero_cta_link",
    "hero_hide_mobile", "hero_hide_tablet", "hero_hide_desktop",
    "announcement", "whatsapp", "phone", "email", "address",
    "instagram", "tiktok", "snapchat", "twitter",
    "payment_instructions", "bank_name", "iban", "account_name",
    "shipping_fee", "free_shipping_threshold", "shipping_display_mode",
    "commercial_register", "tax_number", "footer_text",
    "font_family", "base_font_size", "heading_scale", "primary_color",
    "accent_color", "background_color", "text_color", "card_radius",
    "header_footer_font_size",
    "currency_mark_url", "show_currency_mark",
  ];

  const data: Record<string, string | number | boolean | null> = {};
  for (const f of fields) {
    const v = (formData.get(f) as string)?.trim() ?? "";
    if (["shipping_fee", "free_shipping_threshold", "base_font_size", "heading_scale", "card_radius", "header_footer_font_size"].includes(f)) {
      data[f] = parseFloat(v) || 0;
    } else if (f === "show_currency_mark" || f === "hero_hide_mobile" || f === "hero_hide_tablet" || f === "hero_hide_desktop") {
      data[f] = v === "on";
    } else {
      data[f] = v === "" ? null : v;
    }
  }
  data.updated_at = new Date().toISOString();

  if (data.shipping_display_mode == null) delete data.shipping_display_mode;

  const supabase = createAdminClient();
  const { error } = await supabase.from("settings").update(data).eq("id", 1);
  if (error) return { error: error.message };

  revalidatePath("/");
  revalidatePath("/admin/settings");
  return { success: true };
}

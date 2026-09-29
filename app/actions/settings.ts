"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

const FIELDS = [
  "site_name", "store_logo", "hero_image", "hero_image_mobile",
  "hero_title", "hero_subtitle", "hero_cta_text", "hero_cta_link",
  "hero_hide_mobile", "hero_hide_tablet", "hero_hide_desktop",
  "hero_width", "hero_height", "hero_show_cta",
  "category_section_width", "category_section_height", "category_item_size", "category_item_gap", "category_item_shape",
  "category_grid_width", "category_grid_height",
  "category_grid_desktop_size", "category_grid_desktop_height", "category_grid_desktop_gap", "category_grid_desktop_cols",
  "category_grid_tablet_cols",
  "category_grid_mobile_size", "category_grid_mobile_height", "category_grid_mobile_gap", "category_grid_mobile_cols",
  "announcement", "whatsapp", "phone", "email", "address",
  "instagram", "tiktok", "snapchat", "twitter",
  "payment_instructions", "bank_name", "iban", "account_name",
  "shipping_fee", "free_shipping_threshold", "shipping_display_mode",
  "commercial_register", "tax_number", "footer_text",
  "font_family", "base_font_size", "heading_scale", "primary_color",
  "accent_color", "background_color", "text_color", "card_radius",
  "header_footer_font_size",
  "currency_mark_url", "show_currency_mark",
  "footer_bg_color", "footer_text_color", "footer_link_color", "footer_link_hover_color",
  "footer_heading_color", "footer_border_color", "footer_bottom_bg_color", "footer_bottom_text_color",
  "footer_show_brand", "footer_show_links", "footer_show_contact",
  "footer_links_json",
  // Brand section
  "footer_brand_bg_color", "footer_brand_padding_y",
  "footer_brand_logo_width", "footer_brand_logo_height", "footer_brand_logo_align", "footer_brand_logo_gap",
  "footer_brand_desc_size", "footer_brand_desc_color", "footer_brand_desc_weight", "footer_brand_desc_align", "footer_brand_desc_max_width",
  // Header
  "header_height", "header_padding_top", "header_padding_bottom", "header_gap",
  "header_logo_width", "header_logo_height", "header_logo_align",
  "header_bg_color", "header_text_color", "header_link_color", "header_link_hover_color", "header_icon_color",
  // Mobile products layout
  "mobile_products_layout",
  "mobile_products_allow_user_toggle",
];

const NUMERIC_FIELDS = new Set([
  "shipping_fee", "free_shipping_threshold", "base_font_size", "heading_scale", "card_radius", "header_footer_font_size",
  "hero_width", "hero_height", "category_section_width", "category_section_height", "category_item_size", "category_item_gap",
  "footer_brand_padding_y", "footer_brand_logo_width", "footer_brand_logo_height", "footer_brand_logo_gap",
  "footer_brand_desc_size", "footer_brand_desc_weight", "footer_brand_desc_max_width",
  "header_height", "header_padding_top", "header_padding_bottom", "header_gap", "header_logo_width", "header_logo_height",
  "category_grid_width", "category_grid_height",
  "category_grid_desktop_size", "category_grid_desktop_height", "category_grid_desktop_gap", "category_grid_desktop_cols",
  "category_grid_tablet_cols",
  "category_grid_mobile_size", "category_grid_mobile_height", "category_grid_mobile_gap", "category_grid_mobile_cols",
]);

const BOOLEAN_FIELDS = new Set([
  "show_currency_mark", "hero_hide_mobile", "hero_hide_tablet", "hero_hide_desktop", "hero_show_cta",
  "footer_show_brand", "footer_show_links", "footer_show_contact", "mobile_products_allow_user_toggle",
]);

export type SettingsPatch = Record<string, string | number | boolean | null>;

export async function buildSettingsUpdateData(formData: FormData): Promise<SettingsPatch> {
  const data: SettingsPatch = {};
  for (const f of FIELDS) {
    // فقط الحقول الموجودة فعلًا في FormData — الحقل الغائب لا يتغير في قاعدة البيانات.
    if (!formData.has(f)) continue;
    const v = (formData.get(f) as string)?.trim() ?? "";
    if (NUMERIC_FIELDS.has(f)) {
      data[f] = parseFloat(v) || 0;
    } else if (BOOLEAN_FIELDS.has(f)) {
      data[f] = v === "on";
    } else {
      data[f] = v === "" ? null : v;
    }
  }
  return data;
}

export async function updateSettingsAction(formData: FormData) {
  const data: SettingsPatch = await buildSettingsUpdateData(formData);

  if (data.shipping_display_mode == null) delete data.shipping_display_mode;
  data.updated_at = new Date().toISOString();

  const supabase = createAdminClient();
  const { error } = await supabase.from("settings").update(data).eq("id", 1);
  if (error) return { error: error.message };

  revalidatePath("/");
  revalidatePath("/admin/settings");
  return { success: true };
}
import { createClient } from "@/lib/supabase/server";
import type { Settings } from "@/types";

const defaults: Settings = {
  id: 1,
  site_name: "لمعة للاكسسوارات المطلية",
  store_logo: null,
  hero_image: null,
  hero_image_mobile: null,
  hero_title: "اكتشفي تشكيلتنا الجديدة",
  hero_subtitle: "قطع مختارة بتفاصيل تليق بك",
  hero_cta_text: "تسوقي الآن",
  hero_cta_link: "/shop",
  announcement: null,
  whatsapp: null,
  phone: null,
  email: null,
  address: null,
  instagram: null,
  tiktok: null,
  snapchat: null,
  twitter: null,
  payment_instructions: "يرجى تحويل المبلغ إلى الحساب البنكي ثم إرسال إثبات التحويل عبر واتساب أو رفعه في الطلب.",
  bank_name: null,
  iban: null,
  account_name: null,
  shipping_fee: 25,
  free_shipping_threshold: 300,
  shipping_display_mode: "pickup",
  commercial_register: null,
  tax_number: null,
  footer_text: null,
  font_family: "cairo",
  base_font_size: 16,
  heading_scale: 1,
  primary_color: "#B08D57",
  accent_color: "#111111",
  background_color: "#F8F6F1",
  text_color: "#111111",
  card_radius: 16,
  header_footer_font_size: 13,
  currency_mark_url: "/currency-mark.svg",
  show_currency_mark: true,
};

export async function getSettings(): Promise<Settings> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("settings").select("*").eq("id", 1).maybeSingle();
    if (data) return { ...defaults, ...data } as Settings;
  } catch {}
  return defaults;
}

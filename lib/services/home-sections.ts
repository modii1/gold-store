import { createClient } from "@/lib/supabase/server";
import type { HomeSection } from "@/types";

// القائمة الافتراضية للأقسام المدمجة (تُعرض عندما لا يوجد ترتيب/أقسام محفوظة،
// أو عند فشل قراءة الجدول — حتى لا تختفي أقسام الصفحة الرئيسية أبداً).
// الميزات (features) موضوعة أسفل «أحدث المنتجات» مباشرةً على الرئيسية.
const DEFAULT_SECTIONS: HomeSection[] = [
  { id: "builtin-hero", type: "hero", code: "hero", title: null, subtitle: null, image_url: null, icon: null, content: null, config: {}, sort_order: 1, is_active: true, created_at: "", updated_at: "" },
  { id: "builtin-categories", type: "categories", code: "categories", title: null, subtitle: null, image_url: null, icon: null, content: null, config: {}, sort_order: 2, is_active: true, created_at: "", updated_at: "" },
  { id: "builtin-products_latest", type: "products_latest", code: "products_latest", title: "أحدث المنتجات", subtitle: "وصل حديثاً من تشكيلتنا", image_url: null, icon: null, content: null, config: { viewAll: "/shop" }, sort_order: 3, is_active: true, created_at: "", updated_at: "" },
  { id: "builtin-features", type: "features", code: "features", title: null, subtitle: null, image_url: null, icon: null, content: null, config: {}, sort_order: 4, is_active: true, created_at: "", updated_at: "" },
  { id: "builtin-products_best", type: "products_best", code: "products_best", title: "الأكثر مبيعاً", subtitle: "القطع التي أحبتها عميلاتنا", image_url: null, icon: null, content: null, config: { viewAll: "/shop?sort=best", dark: true }, sort_order: 5, is_active: true, created_at: "", updated_at: "" },
  { id: "builtin-products_featured", type: "products_featured", code: "products_featured", title: "قطع مميزة", subtitle: "اختياراتنا المفضلة من التشكيلة", image_url: null, icon: null, content: null, config: { viewAll: "/shop?featured=1" }, sort_order: 6, is_active: true, created_at: "", updated_at: "" },
  { id: "builtin-products_sale", type: "products_sale", code: "products_sale", title: "العروض", subtitle: "خصومات حصرية لفترة محدودة", image_url: null, icon: null, content: null, config: { viewAll: "/shop?sale=1" }, sort_order: 7, is_active: true, created_at: "", updated_at: "" },
];

// يُرجع أقسام الصفحة الرئيسية النشطة مرتبة حسب ترتيب المستخدم.
// إذا لم تُخزَّن أقسام بعد (جدول فارغ/غير موجود/فشل القراءة) تُرجع القائمة
// الافتراضية المدمجة حتى لا تختفي الأقسام أبداً.
export async function getHomeSections(): Promise<HomeSection[]> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("home_sections")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    const rows = (data || []) as HomeSection[];
    if (!rows || rows.length === 0) return DEFAULT_SECTIONS;
    return rows.map((s) => {
      const rawConfig = typeof s.config === "string" ? safeJson(s.config) : s.config;
      return {
        ...s,
        config: (rawConfig && typeof rawConfig === "object" ? rawConfig : null) as HomeSection["config"],
      };
    });
  } catch {
    return DEFAULT_SECTIONS;
  }
}

function safeJson(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// أسماء الأقسام المعروفة منقولة إلى ملف مستقل خالٍ من تبعيات السيرفر
// حتى تُستورد بأمان من Client Components. يُعاد التصدير هنا للتوافق.
export { BUILTIN_SECTION_LABELS } from "./home-section-labels";

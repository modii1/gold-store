import { createAdminClient } from "@/lib/supabase/admin";
import type { HomeSection } from "@/types";

// القائمة الافتراضية للأقسام المدمجة
const DEFAULT_SECTIONS: HomeSection[] = [
  { id: "builtin-hero", type: "hero", code: "hero", title: null, subtitle: null, image_url: null, icon: null, content: null, config: {}, sort_order: 1, is_active: true, created_at: "", updated_at: "" },
  { id: "builtin-categories", type: "categories", code: "categories", title: null, subtitle: null, image_url: null, icon: null, content: null, config: {}, sort_order: 2, is_active: true, created_at: "", updated_at: "" },
  { id: "builtin-products_latest", type: "products_latest", code: "products_latest", title: "أحدث المنتجات", subtitle: "وصل حديثاً من تشكيلتنا", image_url: null, icon: null, content: null, config: { viewAll: "/shop" }, sort_order: 3, is_active: true, created_at: "", updated_at: "" },
  { id: "builtin-features", type: "features", code: "features", title: null, subtitle: null, image_url: null, icon: null, content: null, config: {}, sort_order: 4, is_active: true, created_at: "", updated_at: "" },
  { id: "builtin-products_best", type: "products_best", code: "products_best", title: "الأكثر مبيعاً", subtitle: "القطع التي أحبتها عميلاتنا", image_url: null, icon: null, content: null, config: { viewAll: "/shop?sort=best", dark: true }, sort_order: 5, is_active: true, created_at: "", updated_at: "" },
  { id: "builtin-products_featured", type: "products_featured", code: "products_featured", title: "قطع مميزة", subtitle: "اختياراتنا المفضلة من التشكيلة", image_url: null, icon: null, content: null, config: { viewAll: "/shop?featured=1" }, sort_order: 6, is_active: true, created_at: "", updated_at: "" },
  { id: "builtin-products_sale", type: "products_sale", code: "products_sale", title: "العروض", subtitle: "خصومات حصرية لفترة محدودة", image_url: null, icon: null, content: null, config: { viewAll: "/shop?sale=1" }, sort_order: 7, is_active: true, created_at: "", updated_at: "" },
];

const SEED_DATA = DEFAULT_SECTIONS.map((s) => ({
  type: s.type,
  code: s.code,
  title: s.title,
  subtitle: s.subtitle,
  image_url: s.image_url,
  icon: s.icon,
  content: s.content,
  config: s.config,
  sort_order: s.sort_order,
  is_active: s.is_active,
}));

export async function getHomeSections(): Promise<HomeSection[]> {
  try {
    // نستخدم service role client مباشرةً بدلاً من anon client
    // لأن جدول home_sections محاط بـ RLS لا يسمح للـ anon بقراءة البيانات
    // المحفوظة في لوحة التحكم. هذه بيانات عامة للواجهة ولا تشكل خطورة أمنية.
    const admin = createAdminClient();
    const { data } = await admin
      .from("home_sections")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    const rows = (data || []) as HomeSection[];

    if (rows.length === 0) {
      try {
        await admin.from("home_sections").insert(SEED_DATA);
        const { data: seeded } = await admin
          .from("home_sections")
          .select("*")
          .eq("is_active", true)
          .order("sort_order", { ascending: true });
        if (seeded && seeded.length > 0) {
          return seeded.map((s) => ({
            ...s,
            config: parseConfig(s.config),
          })) as HomeSection[];
        }
      } catch {}
      return DEFAULT_SECTIONS;
    }

    return rows.map((s) => ({
      ...s,
      config: parseConfig(s.config),
    })) as HomeSection[];
  } catch {
    return DEFAULT_SECTIONS;
  }
}

function parseConfig(raw: unknown): HomeSection["config"] {
  const parsed = typeof raw === "string" ? safeJson(raw) : raw;
  return (parsed && typeof parsed === "object" ? parsed : null) as HomeSection["config"];
}

function safeJson(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

export { BUILTIN_SECTION_LABELS } from "./home-section-labels";

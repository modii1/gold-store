import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { SectionsManager } from "./sections-manager";
import type { HomeSection } from "@/types";

const SEED_SECTIONS = [
  { type: "hero", code: "hero", sort_order: 1, is_active: true },
  { type: "categories", code: "categories", sort_order: 2, is_active: true },
  { type: "products_latest", code: "products_latest", title: "أحدث المنتجات", subtitle: "وصل حديثاً من تشكيلتنا", sort_order: 3, is_active: true, config: { viewAll: "/shop" } },
  { type: "features", code: "features", sort_order: 4, is_active: true },
  { type: "products_best", code: "products_best", title: "الأكثر مبيعاً", subtitle: "القطع التي أحبتها عميلاتنا", sort_order: 5, is_active: true, config: { viewAll: "/shop?sort=best", dark: true } },
  { type: "products_featured", code: "products_featured", title: "قطع مميزة", subtitle: "اختياراتنا المفضلة من التشكيلة", sort_order: 6, is_active: true, config: { viewAll: "/shop?featured=1" } },
  { type: "products_sale", code: "products_sale", title: "العروض", subtitle: "خصومات حصرية لفترة محدودة", sort_order: 7, is_active: true, config: { viewAll: "/shop?sale=1" } },
];

export default async function AdminSectionsPage() {
  if (!(await getAdminSession())) redirect("/admin");

  const supabase = createAdminClient();
  let sections: HomeSection[] = [];
  try {
    const { data } = await supabase.from("home_sections").select("*").order("sort_order", { ascending: true });
    sections = (data || []) as HomeSection[];
  } catch {}

  // If table is empty, seed default sections so admin can see and reorder them
  if (sections.length === 0) {
    try {
      await supabase.from("home_sections").insert(SEED_SECTIONS);
      const { data } = await supabase.from("home_sections").select("*").order("sort_order", { ascending: true });
      sections = (data || []) as HomeSection[];
    } catch {}
  }

  return <SectionsManager sections={sections} />;
}

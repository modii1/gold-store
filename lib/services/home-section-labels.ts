// أسماء الأقسام المعروفة (للواجهة والإظهار في اللوحة).
// ملف منفصل خالٍ من أي تبعية على supabase/server حتى يمكن استيراده من
// Client Components دون جلب `next/headers`.
export const BUILTIN_SECTION_LABELS: Record<string, { name: string; icon?: string; desc?: string }> = {
  hero: { name: "الواجهة (Hero)", icon: "Sparkles" },
  categories: { name: "التصنيفات", icon: "FolderOpen" },
  features: { name: "المميزات", icon: "BadgeCheck" },
  products_latest: { name: "أحدث المنتجات", icon: "Package" },
  products_best: { name: "الأكثر مبيعاً", icon: "Star" },
  products_featured: { name: "قطع مميزة", icon: "Gem" },
  products_sale: { name: "العروض", icon: "Percent" },
  custom: { name: "قسم مخصص", icon: "LayoutTemplate" },
};

import { StoreHeader } from "@/components/storefront/header";
import { StoreFooter } from "@/components/storefront/footer";
import { Hero } from "@/components/storefront/hero";
import { CategoryStrip } from "@/components/storefront/category-strip";
import { FeaturesStrip } from "@/components/storefront/features-strip";
import { ProductSection } from "@/components/storefront/product-section";
import { CustomSection } from "@/components/storefront/custom-section";
import { getSettings } from "@/lib/services/settings";
import { getHomeSections } from "@/lib/services/home-sections";
import { getCategoriesList, getLatestProducts, getBestSellers, getFeaturedProducts, getOnSaleProducts } from "@/lib/services/products";
import type { HomeSection } from "@/types";

type ProductArray = Awaited<ReturnType<typeof getLatestProducts>>;

// تضمن قراءة أحدث ترتيب/إظهار للأقسام في كل طلب (لا تُخزَّن نسخة ثابتة قديمة
// بعد حفظ الترتيب من لوحة التحكم).
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [settings, categories, latest, bestSellers, featured, onSale, sections] = await Promise.all([
    getSettings(),
    getCategoriesList(),
    getLatestProducts(8),
    getBestSellers(8),
    getFeaturedProducts(8),
    getOnSaleProducts(8),
    getHomeSections(),
  ]);

  const productFeeds: Record<string, ProductArray> = {
    products_latest: latest,
    products_best: bestSellers,
    products_featured: featured,
    products_sale: onSale,
  };
  const defaultFeedMeta: Record<string, { title: string; subtitle: string; viewAll: string; dark?: boolean }> = {
    products_latest: { title: "أحدث المنتجات", subtitle: "وصل حديثاً من تشكيلتنا", viewAll: "/shop" },
    products_best: { title: "الأكثر مبيعاً", subtitle: "القطع التي أحبتها عميلاتنا", viewAll: "/shop?sort=best", dark: true },
    products_featured: { title: "قطع مميزة", subtitle: "اختياراتنا المفضلة من التشكيلة", viewAll: "/shop?featured=1" },
    products_sale: { title: "العروض", subtitle: "خصومات حصرية لفترة محدودة", viewAll: "/shop?sale=1" },
  };

  return (
    <>
      <StoreHeader settings={settings} categories={categories} />
      <main className="flex-1">
        {orderSectionsForDisplay(sections).map((section) => renderSectionSafe(section, settings, categories, productFeeds, defaultFeedMeta))}
      </main>
      <StoreFooter settings={settings} />
    </>
  );
}

// يضع قسم الميزات (features) أسفل أول قسم منتجات مباشرةً على الصفحة الرئيسية
// (بدل موضعه العلوي السابق)، دون التأثير على باقي الترتيب المختار في لوحة التحكم.
function orderSectionsForDisplay(sections: HomeSection[]): HomeSection[] {
  const featuresIdx = sections.findIndex((s) => s.type === "features");
  if (featuresIdx === -1) return sections;
  const features = sections[featuresIdx];
  const rest = sections.filter((s) => s.type !== "features");
  const firstProductIdx = rest.findIndex((s) => s.type.startsWith("products_"));
  if (firstProductIdx === -1) return sections;
  rest.splice(firstProductIdx + 1, 0, features);
  return rest;
}

// يرند قسماً منعزلاً: فشل قسم واحد لا يُسقط بقية الأقسام ولا الصفحة نفسها.
function renderSectionSafe(
  section: HomeSection,
  settings: Awaited<ReturnType<typeof getSettings>>,
  categories: Awaited<ReturnType<typeof getCategoriesList>>,
  productFeeds: Record<string, ProductArray>,
  defaultFeedMeta: Record<string, { title: string; subtitle: string; viewAll: string; dark?: boolean }>,
) {
  try {
    return (
      <div key={section.id} data-section-code={section.code}>
        <SectionRenderer section={section} settings={settings} categories={categories} productFeeds={productFeeds} defaultFeedMeta={defaultFeedMeta} />
      </div>
    );
  } catch {
    return null;
  }
}

function SectionRenderer({
  section,
  settings,
  categories,
  productFeeds,
  defaultFeedMeta,
}: {
  section: HomeSection;
  settings: Awaited<ReturnType<typeof getSettings>>;
  categories: Awaited<ReturnType<typeof getCategoriesList>>;
  productFeeds: Record<string, ProductArray>;
  defaultFeedMeta: Record<string, { title: string; subtitle: string; viewAll: string; dark?: boolean }>;
}) {
  const type = section.type;
  const cfg = section.config || {};

  if (type === "hero") return <Hero settings={settings} />;
  if (type === "categories") return <CategoryStrip categories={categories} />;
  if (type === "features") return <FeaturesStrip />;

  if (type.startsWith("products_")) {
    const feed = productFeeds[type] || [];
    const meta = defaultFeedMeta[type] || { title: section.title || "منتجاتنا", subtitle: section.subtitle || "", viewAll: "/shop" };
    return (
      <ProductSection
        title={section.title || meta.title}
        subtitle={section.subtitle || meta.subtitle}
        viewAll={(section.config?.viewAll as string) || meta.viewAll}
        products={feed}
        dark={cfg.dark ?? meta.dark}
      />
    );
  }

  // قسم مخصص
  return (
    <CustomSection
      title={section.title}
      subtitle={section.subtitle}
      imageUrl={section.image_url}
      icon={section.icon}
      content={section.content}
    />
  );
}

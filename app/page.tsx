import { StoreHeader } from "@/components/storefront/header";
import { StoreFooter } from "@/components/storefront/footer";
import { Hero } from "@/components/storefront/hero";
import { CategoryStrip } from "@/components/storefront/category-strip";
import { FeaturesStrip } from "@/components/storefront/features-strip";
import { ProductSection } from "@/components/storefront/product-section";
import { getSettings } from "@/lib/services/settings";
import { getCategoriesList, getLatestProducts, getBestSellers, getFeaturedProducts, getOnSaleProducts } from "@/lib/services/products";

export default async function HomePage() {
  const [settings, categories, latest, bestSellers, featured, onSale] = await Promise.all([
    getSettings(),
    getCategoriesList(),
    getLatestProducts(8),
    getBestSellers(8),
    getFeaturedProducts(8),
    getOnSaleProducts(8),
  ]);

  return (
    <>
      <StoreHeader settings={settings} categories={categories} />
      <main className="flex-1">
        <Hero settings={settings} />
        <CategoryStrip categories={categories} />
        <FeaturesStrip />

        <ProductSection
          title="أحدث المنتجات"
          subtitle="وصل حديثاً من تشكيلتنا"
          viewAll="/shop"
          products={latest}
        />

        {bestSellers.length > 0 && (
          <ProductSection
            title="الأكثر مبيعاً"
            subtitle="القطع التي أحبتها عميلاتنا"
            viewAll="/shop?sort=best"
            products={bestSellers}
            dark
          />
        )}

        {featured.length > 0 && (
          <ProductSection
            title="قطع مميزة"
            subtitle="اختياراتنا المفضلة من التشكيلة"
            viewAll="/shop?featured=1"
            products={featured}
          />
        )}

        {onSale.length > 0 && (
          <ProductSection
            title="العروض"
            subtitle="خصومات حصرية لفترة محدودة"
            viewAll="/shop?sale=1"
            products={onSale}
          />
        )}
      </main>
      <StoreFooter settings={settings} />
    </>
  );
}

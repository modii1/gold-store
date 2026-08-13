import { notFound } from "next/navigation";
import { StoreHeader } from "@/components/storefront/header";
import { StoreFooter } from "@/components/storefront/footer";
import { ShopContent } from "@/components/storefront/shop-content";
import { getSettings } from "@/lib/services/settings";
import { getProducts, getCategoriesList, getFacetValues } from "@/lib/services/products";

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const val = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]);

  const [settings, categories] = await Promise.all([getSettings(), getCategoriesList()]);
  const category = categories.find((c) => c.slug === slug);
  if (!category) notFound();

  const [products, karat, material, color, brand] = await Promise.all([
    getProducts({
      category: category.name,
      brand: sp.brand as string | string[] | undefined,
      karat: sp.karat as string | string[] | undefined,
      material: sp.material as string | string[] | undefined,
      color: sp.color as string | string[] | undefined,
      minPrice: val("min") ? parseFloat(val("min")!) : undefined,
      maxPrice: val("max") ? parseFloat(val("max")!) : undefined,
      inStock: val("in_stock") === "1",
      onSale: val("sale") === "1",
      featured: val("featured") === "1",
      q: val("q"),
      sort: (val("sort") as any) || undefined,
      page: val("page") ? parseInt(val("page")!) : 1,
    }),
    getFacetValues("karat"),
    getFacetValues("material"),
    getFacetValues("color"),
    getFacetValues("brand"),
  ]);

  return (
    <>
      <StoreHeader settings={settings} categories={categories} />
      <main className="flex-1">
        <ShopContent
          init={{ products: products.products, total: products.total, categories, facets: { karat, material, color, brand }, perPage: 24 }}
          fixedCategory={category.name}
          basePath={`/category/${slug}`}
        />
      </main>
      <StoreFooter settings={settings} />
    </>
  );
}

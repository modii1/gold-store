import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StoreHeader } from "@/components/storefront/header";
import { StoreFooter } from "@/components/storefront/footer";
import { ProductSection } from "@/components/storefront/product-section";
import { ProductGallery } from "./product-gallery";
import { BuyPanel } from "./buy-panel";
import { getSettings } from "@/lib/services/settings";
import { getProduct, getProductStats, getRelatedProducts } from "@/lib/services/products";
import { getCategoriesList } from "@/lib/services/products";
import { effectivePrice, discountPercent, formatCurrency } from "@/lib/format";
import { Currency } from "@/components/storefront/currency";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug: raw } = await params;
  const slug = decodeURIComponent(raw);
  const product = await getProduct(slug);
  if (!product) return { title: "منتج غير موجود" };
  const price = effectivePrice(product);
  return {
    title: product.seo_title || product.name,
    description: product.seo_description || product.description || product.name,
    alternates: { canonical: `/product/${product.slug}` },
    openGraph: {
      title: product.name,
      description: product.seo_description || product.description || undefined,
      images: product.images?.[0]?.url ? [product.images[0].url] : [],
    },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug: raw } = await params;
  const slug = decodeURIComponent(raw);
  const [settings, product, categories] = await Promise.all([getSettings(), getProduct(slug), getCategoriesList()]);
  if (!product) notFound();

  const [stats, related] = await Promise.all([getProductStats(product.id), getRelatedProducts(product)]);
  const price = effectivePrice(product);
  const disc = discountPercent(product);
  const outOfStock = product.stock <= 0;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    sku: product.sku || undefined,
    description: product.description || undefined,
    image: product.images?.map((i) => i.url) || undefined,
    brand: product.brand ? { "@type": "Brand", name: product.brand } : undefined,
    offers: {
      "@type": "Offer",
      price: price,
      priceCurrency: "SAR",
      availability: outOfStock ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
    },
    aggregateRating: stats.count > 0 ? { "@type": "AggregateRating", ratingValue: stats.rating, reviewCount: stats.count } : undefined,
  };

  const specs: { label: string; value: string }[] = [];
  if (product.sku) specs.push({ label: "SKU", value: product.sku });
  if (product.weight) specs.push({ label: "الوزن", value: product.weight });
  if (product.karat) specs.push({ label: "العيار", value: product.karat });
  if (product.material) specs.push({ label: "المادة", value: product.material });
  if (product.color) specs.push({ label: "اللون", value: product.color });
  if (product.brand) specs.push({ label: "العلامة", value: product.brand });

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <StoreHeader settings={settings} categories={categories} />
      <main className="flex-1 mx-auto max-w-7xl px-4 md:px-6 py-8">
        {/* Breadcrumbs */}
        <nav className="flex flex-wrap items-center gap-1.5 text-xs text-stone-400 mb-6">
          <a href="/" className="hover:text-gold transition">الرئيسية</a>
          <span>/</span>
          {product.category && (
            <>
              <a href="/shop" className="hover:text-gold transition">المتجر</a>
              <span>/</span>
              <span>{product.category}</span>
              <span>/</span>
            </>
          )}
          <span className="text-gold font-semibold line-clamp-1">{product.name}</span>
        </nav>

        <div className="grid gap-10 lg:grid-cols-2">
          <ProductGallery product={product} />

          <div className="space-y-6">
            <div>
              {product.brand && <p className="text-xs font-semibold tracking-widest text-gold-dark uppercase">{product.brand}</p>}
              <h1 className="mt-1 text-2xl md:text-3xl font-bold text-ink leading-snug">{product.name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                {stats.count > 0 && (
                  <span className="flex items-center gap-1 text-amber-500 font-semibold">
                    {"★".repeat(Math.round(stats.rating))} <span className="text-stone-400 font-normal">({stats.rating} · {stats.count} تقييم)</span>
                  </span>
                )}
                {product.sku && <span className="text-stone-400">SKU: <span dir="ltr">{product.sku}</span></span>}
                <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${outOfStock ? "bg-stone-100 text-stone-500" : "bg-emerald-50 text-emerald-700"}`}>
                  {outOfStock ? "نفد المخزون" : product.stock > 0 && product.stock < 5 ? "كمية محدودة" : "متوفر"}
                </span>
              </div>

              <div className="mt-4 flex items-end gap-3">
                <Currency value={price} className="text-3xl font-bold text-gold-dark" />
                {disc > 0 && product.sale_price && (
                  <>
                    <Currency value={product.price} className="text-lg text-stone-400 line-through" />
                    <span className="rounded-full bg-gold/10 text-gold-dark px-2.5 py-0.5 text-xs font-bold">خصم {disc}%</span>
                  </>
                )}
              </div>
            </div>

            <BuyPanel product={product} settings={settings} />

            {product.description && (
              <div className="rounded-2xl border border-sand bg-white p-5">
                <h2 className="font-bold text-ink mb-2">الوصف</h2>
                <p className="text-sm text-stone-600 leading-relaxed whitespace-pre-line">{product.description}</p>
              </div>
            )}

            {specs.length > 0 && (
              <div className="rounded-2xl border border-sand bg-white p-5">
                <h2 className="font-bold text-ink mb-3">المواصفات</h2>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  {specs.map((s) => (
                    <div key={s.label} className="flex justify-between border-b border-sand/60 pb-2">
                      <dt className="text-stone-400">{s.label}</dt>
                      <dd className="font-bold text-ink text-start" dir="ltr">{s.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            {settings.bank_name && (
              <div className="rounded-2xl border border-sand bg-cream/60 p-5">
                <p className="font-bold text-ink mb-2">الحساب البنكي</p>
                <p className="text-sm text-stone-600">البنك: {settings.bank_name}</p>
                <p className="text-sm text-stone-600">المستفيد: {settings.account_name || "-"}</p>
                <p className="text-sm text-stone-600 mt-1" dir="ltr">{settings.iban || "-"}</p>
              </div>
            )}
          </div>
        </div>
      </main>

      {related.length > 0 && (
        <div className="border-t border-sand">
          <ProductSection title="منتجات مشابهة" subtitle="قد تعجبك أيضاً" viewAll="/shop" products={related} />
        </div>
      )}
      <StoreFooter settings={settings} />
    </>
  );
}

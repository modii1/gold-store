import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StoreHeader } from "@/components/storefront/header";
import { StoreFooter } from "@/components/storefront/footer";
import { getPage } from "@/lib/services/pages";
import { getSettings } from "@/lib/services/settings";
import { getCategoriesList } from "@/lib/services/products";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const page = await getPage(slug);
  return {
    title: page ? page.title : "صفحة غير موجودة",
    description: page?.content?.slice(0, 160) || undefined,
  };
}

export default async function PageRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [settings, categories, page] = await Promise.all([getSettings(), getCategoriesList(), getPage(slug)]);
  if (!page) notFound();

  return (
    <>
      <StoreHeader settings={settings} categories={categories} />
      <main className="flex-1 mx-auto max-w-3xl px-4 md:px-6 py-10">
        <h1 className="text-2xl md:text-3xl font-bold text-ink">{page.title}</h1>
        <article className="prose-lux mt-6 text-stone-600 leading-relaxed whitespace-pre-line">{page.content}</article>
      </main>
      <StoreFooter settings={settings} />
    </>
  );
}

import { StoreHeader } from "@/components/storefront/header";
import { StoreFooter } from "@/components/storefront/footer";
import { FavoritesGrid } from "./favorites-grid";
import { getSettings } from "@/lib/services/settings";
import { getCategoriesList } from "@/lib/services/products";

export default async function FavoritesPage() {
  const [settings, categories] = await Promise.all([getSettings(), getCategoriesList()]);

  return (
    <>
      <StoreHeader settings={settings} categories={categories} />
      <main className="flex-1 mx-auto max-w-7xl px-4 md:px-6 py-8">
        <h1 className="text-2xl md:text-3xl font-bold text-ink">المفضلة</h1>
        <p className="mt-1 text-sm text-stone-500">القِطع التي أضفتها لاحقاً — عودي إليها بسهولة</p>
        <FavoritesGrid />
      </main>
      <StoreFooter settings={settings} />
    </>
  );
}

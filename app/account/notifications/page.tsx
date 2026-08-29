import { StoreHeader } from "@/components/storefront/header";
import { StoreFooter } from "@/components/storefront/footer";
import { CustomerNotifications } from "@/components/notifications/customer-notifications";
import { getSettings } from "@/lib/services/settings";
import { getCategoriesList } from "@/lib/services/products";

export const metadata = { title: "الإشعارات | متجر لمعة للاكسسوارات المطلية" };

export default async function CustomerNotificationsPage() {
  const [settings, categories] = await Promise.all([getSettings(), getCategoriesList()]);

  return (
    <>
      <StoreHeader settings={settings} categories={categories} />
      <main className="flex-1 mx-auto w-full max-w-5xl px-4 md:px-6 py-8" style={{ maxWidth: 900 }}>
        <CustomerNotifications />
      </main>
      <StoreFooter settings={settings} />
    </>
  );
}

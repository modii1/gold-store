import { StoreHeader } from "@/components/storefront/header";
import { StoreFooter } from "@/components/storefront/footer";
import { CustomerNotifications } from "@/components/notifications/customer-notifications";
import { getSettings } from "@/lib/services/settings";
import { getCategoriesList } from "@/lib/services/products";

export const metadata = { title: "الإشعارات | لمعة" };

export default async function CustomerNotificationsPage() {
  const [settings, categories] = await Promise.all([getSettings(), getCategoriesList()]);

  return (
    <>
      <StoreHeader settings={settings} categories={categories} />
      <main className="flex-1 mx-auto max-w-4xl px-4 md:px-6 py-8">
        <CustomerNotifications />
      </main>
      <StoreFooter settings={settings} />
    </>
  );
}

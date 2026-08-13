import { StoreHeader } from "@/components/storefront/header";
import { StoreFooter } from "@/components/storefront/footer";
import { CheckoutForm } from "./checkout-form";
import { getSettings } from "@/lib/services/settings";
import { getCategoriesList } from "@/lib/services/products";
import { getCheckoutData } from "@/app/actions/orders";
import { getCustomerSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function CheckoutPage() {
  const customer = await getCustomerSession();
  const [settings, categories, checkout] = await Promise.all([getSettings(), getCategoriesList(), getCheckoutData()]);
  const { data: savedAddresses } = customer
    ? await createAdminClient().from("addresses").select("id,label,city,region,address,national_address,latitude,longitude,maps_url,is_default").eq("customer_identifier", customer.phone).order("is_default", { ascending: false }).order("created_at", { ascending: false })
    : { data: [] };

  return (
    <>
      <StoreHeader settings={settings} categories={categories} />
      <main className="flex-1 mx-auto max-w-5xl px-4 md:px-6 py-8">
        <h1 className="text-2xl md:text-3xl font-bold text-ink">إتمام الطلب</h1>
        <p className="mt-1 text-sm text-stone-500">أدخلي بيانات الشحن واختاري طريقة الدفع</p>
        <CheckoutForm settings={settings} shipping={checkout.shipping} payment={checkout.payment} customer={customer} savedAddresses={savedAddresses || []} />
      </main>
      <StoreFooter settings={settings} />
    </>
  );
}

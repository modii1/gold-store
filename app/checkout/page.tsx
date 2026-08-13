import { StoreHeader } from "@/components/storefront/header";
import { StoreFooter } from "@/components/storefront/footer";
import { CheckoutForm } from "./checkout-form";
import { getSettings } from "@/lib/services/settings";
import { getCategoriesList } from "@/lib/services/products";
import { getCheckoutData } from "@/app/actions/orders";

export default async function CheckoutPage() {
  const [settings, categories, checkout] = await Promise.all([getSettings(), getCategoriesList(), getCheckoutData()]);

  return (
    <>
      <StoreHeader settings={settings} categories={categories} />
      <main className="flex-1 mx-auto max-w-5xl px-4 md:px-6 py-8">
        <h1 className="text-2xl md:text-3xl font-bold text-ink">إتمام الطلب</h1>
        <p className="mt-1 text-sm text-stone-500">أدخلي بيانات الشحن واختاري طريقة الدفع</p>
        <CheckoutForm settings={settings} shipping={checkout.shipping} payment={checkout.payment} />
      </main>
      <StoreFooter settings={settings} />
    </>
  );
}

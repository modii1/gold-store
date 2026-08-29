import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { StoreHeader } from "@/components/storefront/header";
import { StoreFooter } from "@/components/storefront/footer";
import { getSettings } from "@/lib/services/settings";
import { getCategoriesList } from "@/lib/services/products";
import { WhatsappIcon } from "@/components/ui/social-icons";
import { waMeNumber } from "@/lib/format";

export default async function OrderSuccessPage({ searchParams }: { searchParams: Promise<{ num?: string; name?: string; phone?: string }> }) {
  const { num, name, phone } = await searchParams;
  const [settings, categories] = await Promise.all([getSettings(), getCategoriesList()]);

  return (
    <>
      <StoreHeader settings={settings} categories={categories} />
      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="w-full max-w-md rounded-3xl bg-white border border-sand p-8 text-center shadow-sm">
          <CheckCircle2 className="w-16 h-16 mx-auto text-gold" />
          <h1 className="mt-4 text-2xl font-bold text-ink">تم استلام طلبك</h1>
          <p className="mt-2 text-stone-500">
            {name && <>طلب <span className="font-bold text-ink">{name}</span> </>}
            رقم <span className="font-bold text-gold">#{num}</span> قيد المراجعة
          </p>
          <p className="mt-4 text-sm text-stone-400 leading-relaxed whitespace-pre-line">{settings.payment_instructions}</p>

          {settings.bank_name && (
            <div className="mt-4 rounded-2xl bg-cream/70 p-4 text-sm text-end">
              <p className="font-bold text-ink">بيانات التحويل</p>
              <p className="mt-1 text-stone-600">البنك: {settings.bank_name}</p>
              <p className="text-stone-600">المستفيد: {settings.account_name || "-"}</p>
              <p className="text-stone-600 mt-1" dir="ltr">{settings.iban || "-"}</p>
            </div>
          )}

          {settings.whatsapp && (
            <a
              href={`https://wa.me/${waMeNumber(settings.whatsapp)}?text=${encodeURIComponent(`مرحباً، تم تأكيد طلبي رقم #${num}${name ? ` (${name})` : ""}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-emerald-600 py-3.5 font-bold text-white hover:bg-emerald-700 transition"
            >
              <WhatsappIcon className="w-5 h-5" /> إرسال إثبات التحويل عبر واتساب
            </a>
          )}
          <Link href="/" className="mt-4 block w-full rounded-full border-2 border-gold py-3 font-bold text-gold-dark hover:bg-gold/5 transition">
            متابعة التسوق
          </Link>
        </div>
      </main>
      <StoreFooter settings={settings} />
    </>
  );
}

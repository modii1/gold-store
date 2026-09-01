"use client";

import { useRef, useState, useActionState } from "react";
import { Loader2, Upload, X, Save } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { updateSettingsAction } from "@/app/actions/settings";
import { ImageCropperModal } from "@/components/admin/image-cropper";
import type { Settings } from "@/types";
import { DesignSettings } from "@/components/admin/design-settings";

function ImagePicker({ label, name, value, onChange, aspect }: { label: string; name: string; value: string | null; onChange: (url: string | null) => void; aspect?: number }) {
  const supabase = createClient();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [cropSource, setCropSource] = useState<{ url: string; name: string } | null>(null);

  const uploadBlob = async (blob: Blob, baseName: string) => {
    setUploading(true);
    const base = (baseName.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const path = `settings/${name}-${Date.now()}.${base}`;
    const file = new File([blob], `setting-${Date.now()}.${base}`, { type: blob.type || "image/jpeg" });
    const { error } = await supabase.storage.from("products").upload(path, file);
    if (error) { setUploading(false); alert(error.message); return; }
    const { data } = supabase.storage.from("products").getPublicUrl(path);
    onChange(data.publicUrl);
    setUploading(false);
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setCropSource({ url: URL.createObjectURL(file), name: file.name });
  };

  return (
    <div className="space-y-2">
      <label className="block text-sm font-semibold text-stone-700">{label}</label>
      {value ? (
        <div className="relative rounded-xl overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt={label} className="h-28 w-full object-cover" />
          <button type="button" onClick={() => onChange(null)}
            className="absolute top-2 start-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-red-500 transition">
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => input.current?.click()} disabled={uploading}
          className="h-28 w-full rounded-xl border-2 border-dashed border-amber-200 flex flex-col items-center justify-center text-stone-400 hover:border-gold hover:text-gold transition">
          {uploading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Upload className="w-6 h-6" />}
          <span className="mt-1 text-xs font-semibold">{uploading ? "جاري الرفع..." : "ارفع صورة"}</span>
        </button>
      )}
      <input ref={input} type="file" accept="image/*" hidden onChange={onPick} />
      <input type="hidden" name={name} value={value || ""} />
      {cropSource && (
        <ImageCropperModal
          src={cropSource.url}
          aspect={aspect || 1}
          title={`قصّ ${label}`}
          onCancel={() => setCropSource(null)}
          onConfirm={(blob) => {
            const { name } = cropSource;
            setCropSource(null);
            uploadBlob(blob, name);
          }}
        />
      )}
    </div>
  );
}

export function SettingsForm({ settings }: { settings: Settings }) {
  const [state, formAction] = useActionState(
    async (_prev: unknown, formData: FormData) => updateSettingsAction(formData),
    null
  ) as [null | Awaited<ReturnType<typeof updateSettingsAction>>, (fd: FormData) => void, boolean];
  const [logo, setLogo] = useState<string | null>(settings.store_logo);
  const [hero, setHero] = useState<string | null>(settings.hero_image);
  const [heroMobile, setHeroMobile] = useState<string | null>(settings.hero_image_mobile);
  const [currencyMark, setCurrencyMark] = useState<string | null>(settings.currency_mark_url || "/currency-mark.svg");

  return (
    <form action={formAction} className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">الإعدادات</h1>
        <p className="mt-1 text-sm text-stone-500">تخصيص الموقع بالكامل — الاسم، الصور، الإشعارات، التواصل، الروابط</p>
      </div>

      {/* Site identity */}
      <section className="space-y-4 rounded-2xl border border-amber-100 bg-white p-6">
        <h2 className="font-bold text-stone-800">هوية الموقع</h2>
        <div>
          <label className="block text-sm font-semibold text-stone-700 mb-1">اسم الموقع</label>
          <input name="site_name" defaultValue={settings.site_name} placeholder="مثال: متجر لمعة للاكسسوارات المطلية"
            className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20" />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <ImagePicker label="شعار المتجر" name="store_logo" value={logo} onChange={setLogo} aspect={1} />
          <ImagePicker label="صورة الواجهة (Hero)" name="hero_image" value={hero} onChange={setHero} />
          <ImagePicker label="صورة الواجهة للجوال" name="hero_image_mobile" value={heroMobile} onChange={setHeroMobile} />
        </div>
        <div>
          <label className="block text-sm font-semibold text-stone-700 mb-1">عنوان الواجهة</label>
          <input name="hero_title" defaultValue={settings.hero_title}
            className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20" />
        </div>
        <div>
          <label className="block text-sm font-semibold text-stone-700 mb-1">نص الواجهة</label>
          <textarea name="hero_subtitle" rows={2} defaultValue={settings.hero_subtitle}
            className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20 resize-y" />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-semibold text-stone-700 mb-1">نص زر الواجهة</label>
            <input name="hero_cta_text" defaultValue={settings.hero_cta_text || ""} placeholder="تسوقي الآن"
              className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-stone-700 mb-1">رابط زر الواجهة</label>
            <input name="hero_cta_link" defaultValue={settings.hero_cta_link || ""} placeholder="/shop" dir="ltr"
              className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20" />
          </div>
        </div>
        <div className="rounded-xl border border-amber-100 bg-amber-50/40 p-4">
          <p className="text-sm font-semibold text-stone-700">إخفاء نصوص الواجهة (العنوان، النص، زر «تسوقي الآن»)</p>
          <p className="mt-0.5 text-xs text-stone-500">حدّد المقاسات التي تُخفى فيها النصوص فوق الصورة لتظهر نظيفة.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white p-4 text-sm font-semibold text-stone-700">
              <input name="hero_hide_mobile" type="checkbox" defaultChecked={settings.hero_hide_mobile === true} className="h-5 w-5 accent-[#B08D57]" />
              الجوال (أقل من 768px)
            </label>
            <label className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white p-4 text-sm font-semibold text-stone-700">
              <input name="hero_hide_tablet" type="checkbox" defaultChecked={settings.hero_hide_tablet === true} className="h-5 w-5 accent-[#B08D57]" />
              التابلت (768px - 1023px)
            </label>
            <label className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white p-4 text-sm font-semibold text-stone-700">
              <input name="hero_hide_desktop" type="checkbox" defaultChecked={settings.hero_hide_desktop === true} className="h-5 w-5 accent-[#B08D57]" />
              الكمبيوتر (1024px فأكثر)
            </label>
          </div>
        </div>
      </section>

      <DesignSettings
        fontFamily={settings.font_family}
        baseFontSize={settings.base_font_size}
        headingScale={settings.heading_scale}
        primaryColor={settings.primary_color}
        accentColor={settings.accent_color}
        backgroundColor={settings.background_color}
        textColor={settings.text_color}
        cardRadius={settings.card_radius}
        headerFooterFontSize={settings.header_footer_font_size}
      />

      <section className="space-y-4 rounded-2xl border border-amber-100 bg-white p-6">
        <div>
          <h2 className="font-bold text-stone-800">العملة والأسعار</h2>
          <p className="mt-1 text-sm text-stone-500">اختر صورة رمز العملة، وستظهر بجانب الأسعار في المتجر والسلة والدفع والطلبات.</p>
        </div>
        <div className="grid gap-5 md:grid-cols-2 md:items-end">
          <ImagePicker label="صورة العملة" name="currency_mark_url" value={currencyMark} onChange={setCurrencyMark} />
          <label className="flex items-center gap-3 rounded-xl border border-stone-200 p-4 text-sm font-semibold text-stone-700">
            <input name="show_currency_mark" type="checkbox" defaultChecked={settings.show_currency_mark !== false} className="h-5 w-5 accent-[#B08D57]" />
            إظهار صورة العملة بجانب الأسعار
          </label>
        </div>
      </section>

      {/* Notification */}
      <section className="space-y-4 rounded-2xl border border-amber-100 bg-white p-6">
        <h2 className="font-bold text-stone-800">الإشعارات</h2>
        <div>
          <label className="block text-sm font-semibold text-stone-700 mb-1">شريط الإعلان (يظهر أعلى الموقع)</label>
          <input name="announcement" defaultValue={settings.announcement || ""} placeholder="مثال: توصيل لجميع المدن 🚚"
            className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20" />
        </div>
      </section>

      {/* Contact */}
      <section className="space-y-4 rounded-2xl border border-amber-100 bg-white p-6">
        <h2 className="font-bold text-stone-800">بيانات التواصل</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-semibold text-stone-700 mb-1">واتساب (بالرقم بدون +)</label>
            <input name="whatsapp" defaultValue={settings.whatsapp || ""} dir="ltr"
              className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-stone-700 mb-1">الجوال</label>
            <input name="phone" defaultValue={settings.phone || ""} dir="ltr"
              className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-stone-700 mb-1">البريد الإلكتروني</label>
            <input name="email" defaultValue={settings.email || ""} dir="ltr"
              className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-stone-700 mb-1">العنوان</label>
            <input name="address" defaultValue={settings.address || ""}
              className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20" />
          </div>
        </div>
      </section>

      {/* Social links */}
      <section className="space-y-4 rounded-2xl border border-amber-100 bg-white p-6">
        <h2 className="font-bold text-stone-800">الروابط والأيقونات (تظهر في الهيدر والفوتر)</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-semibold text-stone-700 mb-1">انستقرام</label>
            <input name="instagram" defaultValue={settings.instagram || ""} dir="ltr" placeholder="https://instagram.com/..."
              className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-stone-700 mb-1">تيك توك</label>
            <input name="tiktok" defaultValue={settings.tiktok || ""} dir="ltr" placeholder="https://tiktok.com/@..."
              className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-stone-700 mb-1">سناب شات</label>
            <input name="snapchat" defaultValue={settings.snapchat || ""} dir="ltr" placeholder="https://snapchat.com/add/..."
              className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-stone-700 mb-1">تويتر / X</label>
            <input name="twitter" defaultValue={settings.twitter || ""} dir="ltr" placeholder="https://x.com/..."
              className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20" />
          </div>
        </div>
      </section>

      {/* Shipping */}
      <section className="space-y-4 rounded-2xl border border-amber-100 bg-white p-6">
        <h2 className="font-bold text-stone-800">الشحن</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-semibold text-stone-700 mb-1">رسوم الشحن (﷼)</label>
            <input name="shipping_fee" type="number" min="0" step="0.01" defaultValue={settings.shipping_fee || ""}
              className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-stone-700 mb-1">شحن مجاني عند (﷼)</label>
            <input name="free_shipping_threshold" type="number" min="0" step="0.01" defaultValue={settings.free_shipping_threshold || ""}
              className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20" />
          </div>
        </div>
      </section>

      {/* Legal */}
      <section className="space-y-4 rounded-2xl border border-amber-100 bg-white p-6">
        <h2 className="font-bold text-stone-800">البيانات التجارية (تظهر في الفوتر)</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-semibold text-stone-700 mb-1">السجل التجاري</label>
            <input name="commercial_register" defaultValue={settings.commercial_register || ""} dir="ltr"
              className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-stone-700 mb-1">الرقم الضريبي</label>
            <input name="tax_number" defaultValue={settings.tax_number || ""} dir="ltr"
              className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-semibold text-stone-700 mb-1">نص الفوتر</label>
          <textarea name="footer_text" rows={2} defaultValue={settings.footer_text || ""}
            className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20 resize-y" />
        </div>
      </section>

      {/* Payment */}
      <section className="space-y-4 rounded-2xl border border-amber-100 bg-white p-6">
        <h2 className="font-bold text-stone-800">الدفع (تحويل بنكي)</h2>
        <div>
          <label className="block text-sm font-semibold text-stone-700 mb-1">تعليمات الدفع</label>
          <textarea name="payment_instructions" rows={3} defaultValue={settings.payment_instructions}
            className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20 resize-y" />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className="block text-sm font-semibold text-stone-700 mb-1">اسم البنك</label>
            <input name="bank_name" defaultValue={settings.bank_name || ""}
              className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-stone-700 mb-1">رقم الآيبان</label>
            <input name="iban" defaultValue={settings.iban || ""} dir="ltr"
              className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-stone-700 mb-1">اسم المستفيد</label>
            <input name="account_name" defaultValue={settings.account_name || ""}
              className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20" />
          </div>
        </div>
      </section>

      {state && "error" in state && state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state && "success" in state && state.success && <p className="text-sm text-emerald-600">تم حفظ الإعدادات ✓</p>}

      <button type="submit"
        className="w-full flex items-center justify-center gap-2 rounded-xl bg-gold py-3 font-bold text-white hover:bg-gold-light transition">
        <Save className="w-4 h-4" /> حفظ الإعدادات
      </button>
    </form>
  );
}

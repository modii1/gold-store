"use client";

import { useRef, useState, useActionState } from "react";
import { Loader2, Upload, X, Save } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { updateSettingsAction } from "@/app/actions/settings";
import { ImageCropperModal } from "@/components/admin/image-cropper";
import type { Settings } from "@/types";
import { DesignSettings } from "@/components/admin/design-settings";
import { ColorField } from "@/components/admin/color-field";

function ImagePicker({ label, name, value, onChange, aspect }: { label: string; name: string; value: string | null; onChange: (url: string | null) => void; aspect?: number }) {
  const supabase = createClient();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [cropSource, setCropSource] = useState<{ url: string; name: string; type: string } | null>(null);

  const uploadBlob = async (blob: Blob, _baseName: string) => {
    setUploading(true);
    // كشف الصيغة من أول 4 بايت للـ blob actual content
    const header = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    const isPNG = header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47;
    const isWEBP = header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46;
    const ext = isPNG ? "png" : isWEBP ? "webp" : "jpg";
    const mime = isPNG ? "image/png" : isWEBP ? "image/webp" : "image/jpeg";
    const path = `settings/${name}-${Date.now()}.${ext}`;
    const file = new File([blob], `setting-${Date.now()}.${ext}`, { type: mime });
    if (process.env.NODE_ENV !== "production") {
      console.log("[upload] magic ext:", ext, "mime:", mime, "path:", path);
    }
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
    // نقرأ أول 8 بايت للكشف عن الصيغة الحقيقية (وليس الامتداد فقط)
    const reader = new FileReader();
    reader.onload = () => {
      const buf = new Uint8Array(reader.result as ArrayBuffer);
      const isPNG = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
      const isWEBP = buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
      // نoloselyetect the actual file format from magic bytes
      const realType = isPNG ? "image/png" : isWEBP ? "image/webp" : file.type || "image/jpeg";
      if (process.env.NODE_ENV !== "production") {
        console.log("[ImagePicker] file.name:", file.name, "file.type:", file.type, "→ realType:", realType);
      }
      setCropSource({ url: URL.createObjectURL(file), name: file.name, type: realType });
    };
    reader.readAsArrayBuffer(file.slice(0, 16));
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
          fileType={cropSource.type}
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
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label htmlFor="hero_width" className="block text-sm font-semibold text-stone-700 mb-1">عرض الهيرو</label>
            <div className="flex items-center rounded-xl border border-stone-200 focus-within:border-gold focus-within:ring-2 focus-within:ring-gold/20">
              <input id="hero_width" name="hero_width" type="number" min="0"
                defaultValue={settings.hero_width || 1920} dir="ltr"
                className="w-full min-w-0 flex-1 rounded-l-xl px-4 py-2.5 text-sm focus:outline-none" />
              <span className="px-3 text-sm text-stone-400 select-none">px</span>
            </div>
            <p className="mt-1 text-xs text-stone-500">أدخل عرض الهيرو بالبكسل (مثال: 1920).</p>
          </div>
          <div>
            <label htmlFor="hero_height" className="block text-sm font-semibold text-stone-700 mb-1">ارتفاع الهيرو</label>
            <div className="flex items-center rounded-xl border border-stone-200 focus-within:border-gold focus-within:ring-2 focus-within:ring-gold/20">
              <input id="hero_height" name="hero_height" type="number" min="0"
                defaultValue={Number.isFinite(settings.hero_height) ? settings.hero_height : 700} dir="ltr"
                className="w-full min-w-0 flex-1 rounded-l-xl px-4 py-2.5 text-sm focus:outline-none" />
              <span className="px-3 text-sm text-stone-400 select-none">px</span>
            </div>
            <p className="mt-1 text-xs text-stone-500">أدخل ارتفاع الهيرو بالبكسل (مثال: 700).</p>
          </div>
          <label className="flex items-center gap-3 rounded-xl border border-stone-200 p-4 text-sm font-semibold text-stone-700 self-start">
            <input name="hero_show_cta" type="checkbox" defaultChecked={settings.hero_show_cta !== false} className="h-5 w-5 accent-[#B08D57]" />
            إظهار زر «تسوقي الآن»
          </label>
        </div>
      </section>

      {/* Header settings */}
      <section className="space-y-4 rounded-2xl border border-amber-100 bg-white p-6">
        <div>
          <h2 className="font-bold text-stone-800">إعدادات الهيدر</h2>
          <p className="mt-1 text-sm text-stone-500">تحكم مستقل في حجم وألوان الهيدر — لا يؤثر على الفوتر.</p>
        </div>

        {/* Height and spacing */}
        <div>
          <p className="text-sm font-semibold text-stone-700 mb-2">الحجم والمسافات</p>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div>
              <label htmlFor="header_height" className="block text-sm font-semibold text-stone-700 mb-1">ارتفاع الهيدر</label>
              <div className="flex items-center rounded-xl border border-stone-200 focus-within:border-gold focus-within:ring-2 focus-within:ring-gold/20">
                <input id="header_height" name="header_height" type="number" min="40" max="200"
                  defaultValue={settings.header_height ?? 64} dir="ltr"
                  className="w-full min-w-0 flex-1 rounded-l-xl px-4 py-2.5 text-sm focus:outline-none" />
                <span className="px-3 text-sm text-stone-400 select-none">px</span>
              </div>
            </div>
            <div>
              <label htmlFor="header_padding_top" className="block text-sm font-semibold text-stone-700 mb-1">Padding علوي</label>
              <div className="flex items-center rounded-xl border border-stone-200 focus-within:border-gold focus-within:ring-2 focus-within:ring-gold/20">
                <input id="header_padding_top" name="header_padding_top" type="number" min="0" max="50"
                  defaultValue={settings.header_padding_top ?? 0} dir="ltr"
                  className="w-full min-w-0 flex-1 rounded-l-xl px-4 py-2.5 text-sm focus:outline-none" />
                <span className="px-3 text-sm text-stone-400 select-none">px</span>
              </div>
            </div>
            <div>
              <label htmlFor="header_padding_bottom" className="block text-sm font-semibold text-stone-700 mb-1">Padding سفلي</label>
              <div className="flex items-center rounded-xl border border-stone-200 focus-within:border-gold focus-within:ring-2 focus-within:ring-gold/20">
                <input id="header_padding_bottom" name="header_padding_bottom" type="number" min="0" max="50"
                  defaultValue={settings.header_padding_bottom ?? 0} dir="ltr"
                  className="w-full min-w-0 flex-1 rounded-l-xl px-4 py-2.5 text-sm focus:outline-none" />
                <span className="px-3 text-sm text-stone-400 select-none">px</span>
              </div>
            </div>
            <div>
              <label htmlFor="header_gap" className="block text-sm font-semibold text-stone-700 mb-1">المسافة بين العناصر</label>
              <div className="flex items-center rounded-xl border border-stone-200 focus-within:border-gold focus-within:ring-2 focus-within:ring-gold/20">
                <input id="header_gap" name="header_gap" type="number" min="0" max="50"
                  defaultValue={settings.header_gap ?? 8} dir="ltr"
                  className="w-full min-w-0 flex-1 rounded-l-xl px-4 py-2.5 text-sm focus:outline-none" />
                <span className="px-3 text-sm text-stone-400 select-none">px</span>
              </div>
            </div>
          </div>
        </div>

        {/* Logo */}
        <div>
          <p className="text-sm font-semibold text-stone-700 mb-2">الشعار</p>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label htmlFor="header_logo_width" className="block text-sm font-semibold text-stone-700 mb-1">العرض (0 = تلقائي)</label>
              <div className="flex items-center rounded-xl border border-stone-200 focus-within:border-gold focus-within:ring-2 focus-within:ring-gold/20">
                <input id="header_logo_width" name="header_logo_width" type="number" min="0"
                  defaultValue={settings.header_logo_width ?? 0} dir="ltr"
                  className="w-full min-w-0 flex-1 rounded-l-xl px-4 py-2.5 text-sm focus:outline-none" />
                <span className="px-3 text-sm text-stone-400 select-none">px</span>
              </div>
            </div>
            <div>
              <label htmlFor="header_logo_height" className="block text-sm font-semibold text-stone-700 mb-1">الارتفاع (0 = تلقائي)</label>
              <div className="flex items-center rounded-xl border border-stone-200 focus-within:border-gold focus-within:ring-2 focus-within:ring-gold/20">
                <input id="header_logo_height" name="header_logo_height" type="number" min="0"
                  defaultValue={settings.header_logo_height ?? 0} dir="ltr"
                  className="w-full min-w-0 flex-1 rounded-l-xl px-4 py-2.5 text-sm focus:outline-none" />
                <span className="px-3 text-sm text-stone-400 select-none">px</span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-stone-700 mb-2">محاذاة الشعار</label>
              <div className="flex gap-2">
                <label className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white p-3 text-sm font-semibold text-stone-700 cursor-pointer has-[:checked]:border-gold has-[:checked]:bg-gold/5">
                  <input type="radio" name="header_logo_align" value="flex-start" defaultChecked={settings.header_logo_align === "flex-start"} className="h-4 w-4 accent-[#B08D57]" />
                  يمين
                </label>
                <label className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white p-3 text-sm font-semibold text-stone-700 cursor-pointer has-[:checked]:border-gold has-[:checked]:bg-gold/5">
                  <input type="radio" name="header_logo_align" value="center" defaultChecked={(settings.header_logo_align || "start") === "center"} className="h-4 w-4 accent-[#B08D57]" />
                  وسط
                </label>
                <label className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white p-3 text-sm font-semibold text-stone-700 cursor-pointer has-[:checked]:border-gold has-[:checked]:bg-gold/5">
                  <input type="radio" name="header_logo_align" value="flex-end" defaultChecked={settings.header_logo_align === "flex-end"} className="h-4 w-4 accent-[#B08D57]" />
                  يسار
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Colors */}
        <div>
          <p className="text-sm font-semibold text-stone-700 mb-2">الألوان</p>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <ColorField name="header_bg_color" label="خلفية الهيدر" defaultValue={settings.header_bg_color || "#FAFAF9"} />
            <ColorField name="header_text_color" label="لون النصوص" defaultValue={settings.header_text_color || "#111111"} />
            <ColorField name="header_link_color" label="لون الروابط" defaultValue={settings.header_link_color || "#57534e"} />
            <ColorField name="header_link_hover_color" label="لون الروابط عند التمرير" defaultValue={settings.header_link_hover_color || "#B08D57"} />
            <ColorField name="header_icon_color" label="لون الأيقونات" defaultValue={settings.header_icon_color || "#111111"} />
          </div>
        </div>
      </section>

      {/* Categories section settings */}
      <section className="space-y-4 rounded-2xl border border-amber-100 bg-white p-6">
        <div>
          <h2 className="font-bold text-stone-800">قسم التصنيفات</h2>
          <p className="mt-1 text-sm text-stone-500">تخصيص مقاسات وشكل قسم التصنيفات في الصفحة الرئيسية.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="category_section_width" className="block text-sm font-semibold text-stone-700 mb-1">عرض القسم</label>
            <div className="flex items-center rounded-xl border border-stone-200 focus-within:border-gold focus-within:ring-2 focus-within:ring-gold/20">
              <input id="category_section_width" name="category_section_width" type="number" min="0"
                defaultValue={settings.category_section_width || 1200} dir="ltr"
                className="w-full min-w-0 flex-1 rounded-l-xl px-4 py-2.5 text-sm focus:outline-none" />
              <span className="px-3 text-sm text-stone-400 select-none">px</span>
            </div>
          </div>
          <div>
            <label htmlFor="category_section_height" className="block text-sm font-semibold text-stone-700 mb-1">ارتفاع القسم</label>
            <div className="flex items-center rounded-xl border border-stone-200 focus-within:border-gold focus-within:ring-2 focus-within:ring-gold/20">
              <input id="category_section_height" name="category_section_height" type="number" min="0"
                defaultValue={settings.category_section_height || 200} dir="ltr"
                className="w-full min-w-0 flex-1 rounded-l-xl px-4 py-2.5 text-sm focus:outline-none" />
              <span className="px-3 text-sm text-stone-400 select-none">px</span>
            </div>
          </div>
          <div>
            <label htmlFor="category_item_size" className="block text-sm font-semibold text-stone-700 mb-1">حجم الدائرة / المربع</label>
            <div className="flex items-center rounded-xl border border-stone-200 focus-within:border-gold focus-within:ring-2 focus-within:ring-gold/20">
              <input id="category_item_size" name="category_item_size" type="number" min="0"
                defaultValue={settings.category_item_size || 120} dir="ltr"
                className="w-full min-w-0 flex-1 rounded-l-xl px-4 py-2.5 text-sm focus:outline-none" />
              <span className="px-3 text-sm text-stone-400 select-none">px</span>
            </div>
          </div>
          <div>
            <label htmlFor="category_item_gap" className="block text-sm font-semibold text-stone-700 mb-1">المسافة بين العناصر</label>
            <div className="flex items-center rounded-xl border border-stone-200 focus-within:border-gold focus-within:ring-2 focus-within:ring-gold/20">
              <input id="category_item_gap" name="category_item_gap" type="number" min="0"
                defaultValue={settings.category_item_gap || 28} dir="ltr"
                className="w-full min-w-0 flex-1 rounded-l-xl px-4 py-2.5 text-sm focus:outline-none" />
              <span className="px-3 text-sm text-stone-400 select-none">px</span>
            </div>
          </div>
        </div>
        <div>
          <label className="block text-sm font-semibold text-stone-700 mb-2">شكل التصنيفات</label>
          <div className="flex gap-3">
            <label className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white p-4 text-sm font-semibold text-stone-700 cursor-pointer has-[:checked]:border-gold has-[:checked]:bg-gold/5">
              <input type="radio" name="category_item_shape" value="circle" defaultChecked={settings.category_item_shape !== "square"} className="h-5 w-5 accent-[#B08D57]" />
              دائري
            </label>
            <label className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white p-4 text-sm font-semibold text-stone-700 cursor-pointer has-[:checked]:border-gold has-[:checked]:bg-gold/5">
              <input type="radio" name="category_item_shape" value="square" defaultChecked={settings.category_item_shape === "square"} className="h-5 w-5 accent-[#B08D57]" />
              مربع
            </label>
          </div>
        </div>
      </section>

      {/* Mobile Products Layout */}
      <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm space-y-5">
        <h3 className="text-base font-bold text-stone-800">عرض المنتجات على الجوال</h3>
        <div>
          <label className="block text-sm font-semibold text-stone-700 mb-2">السماح للعميل باختيار طريقة العرض</label>
          <div className="flex gap-3">
            <label className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white p-4 text-sm font-semibold text-stone-700 cursor-pointer has-[:checked]:border-gold has-[:checked]:bg-gold/5">
              <input type="radio" name="mobile_products_allow_user_toggle" value="on" defaultChecked={settings.mobile_products_allow_user_toggle === true} className="h-5 w-5 accent-[#B08D57]" />
              تشغيل
            </label>
            <label className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white p-4 text-sm font-semibold text-stone-700 cursor-pointer has-[:checked]:border-gold has-[:checked]:bg-gold/5">
              <input type="radio" name="mobile_products_allow_user_toggle" value="" defaultChecked={settings.mobile_products_allow_user_toggle !== true} className="h-5 w-5 accent-[#B08D57]" />
              إيقاف
            </label>
          </div>
        </div>
        <div>
          <label className="block text-sm font-semibold text-stone-700 mb-2">طريقة العرض الافتراضية</label>
          <div className="flex gap-3">
            <label className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white p-4 text-sm font-semibold text-stone-700 cursor-pointer has-[:checked]:border-gold has-[:checked]:bg-gold/5">
              <input type="radio" name="mobile_products_layout" value="grid" defaultChecked={settings.mobile_products_layout !== "horizontal"} className="h-5 w-5 accent-[#B08D57]" />
              شبكة
            </label>
            <label className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white p-4 text-sm font-semibold text-stone-700 cursor-pointer has-[:checked]:border-gold has-[:checked]:bg-gold/5">
              <input type="radio" name="mobile_products_layout" value="horizontal" defaultChecked={settings.mobile_products_layout === "horizontal"} className="h-5 w-5 accent-[#B08D57]" />
              شريط أفقي
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

      {/* Footer customization */}
      <section className="space-y-4 rounded-2xl border border-amber-100 bg-white p-6">
        <div>
          <h2 className="font-bold text-stone-800">تخصيص الفوتر</h2>
          <p className="mt-1 text-sm text-stone-500">تحكم كامل في ألوان وأقسام الفوتر من هنا.</p>
        </div>

        {/* Visibility toggles */}
        <div>
          <p className="text-sm font-semibold text-stone-700 mb-2">إظهار الأقسام</p>
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white p-4 text-sm font-semibold text-stone-700">
              <input name="footer_show_brand" type="checkbox" defaultChecked={settings.footer_show_brand !== false} className="h-5 w-5 accent-[#B08D57]" />
              الشعار والوصف
            </label>
            <label className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white p-4 text-sm font-semibold text-stone-700">
              <input name="footer_show_links" type="checkbox" defaultChecked={settings.footer_show_links !== false} className="h-5 w-5 accent-[#B08D57]" />
              الروابط
            </label>
            <label className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white p-4 text-sm font-semibold text-stone-700">
              <input name="footer_show_contact" type="checkbox" defaultChecked={settings.footer_show_contact !== false} className="h-5 w-5 accent-[#B08D57]" />
             بيانات التواصل
            </label>
          </div>
        </div>

        {/* Colors */}
        <div>
          <p className="text-sm font-semibold text-stone-700 mb-2">ألوان الفوتر</p>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <ColorField name="footer_bg_color" label="خلفية الفوتر" defaultValue={settings.footer_bg_color || "#1a1a1a"} />
            <ColorField name="footer_text_color" label="لون النصوص" defaultValue={settings.footer_text_color || "#a8a29e"} />
            <ColorField name="footer_link_color" label="لون الروابط" defaultValue={settings.footer_link_color || "#a8a29e"} />
            <ColorField name="footer_link_hover_color" label="لون الروابط عند التمرير" defaultValue={settings.footer_link_hover_color || "#d4af37"} />
            <ColorField name="footer_heading_color" label="لون العناوين" defaultValue={settings.footer_heading_color || "#f5f5f4"} />
            <ColorField name="footer_border_color" label="لون الحدود" defaultValue={settings.footer_border_color || "rgba(255,255,255,0.1)" } />
            <ColorField name="footer_bottom_bg_color" label="خلفية الشريط السفلي" defaultValue={settings.footer_bottom_bg_color || "#1a1a1a"} />
            <ColorField name="footer_bottom_text_color" label="لون نص الشريط السفلي" defaultValue={settings.footer_bottom_text_color || "#78716c"} />
          </div>
        </div>

        {/* Footer links JSON editor */}
        <div>
          <p className="text-sm font-semibold text-stone-700 mb-1">روابط الفوتر (JSON)</p>
          <p className="text-xs text-stone-500 mb-2">حرر روابط الفوتر يدويًا. الصيغة: {"{groups:[{title:'...',links:[{label:'...',href:'...'}]}]}"}</p>
          <textarea name="footer_links_json" rows={6} dir="ltr"
            defaultValue={settings.footer_links_json || ""}
            placeholder='{"groups":[{"title":"المتجر","links":[{"label":"من نحن","href":"/pages/about"}]}]}'
            className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-xs font-mono focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20 resize-y" />
        </div>
      </section>

      {/* Brand section (independent from rest of footer) */}
      <section className="space-y-4 rounded-2xl border border-amber-100 bg-white p-6">
        <div>
          <h2 className="font-bold text-stone-800">قسم الشعار والوصف</h2>
          <p className="mt-1 text-sm text-stone-500">تخصيص مستقل لقسم الشعار والوصف في أسفل الفوتر — خلفية وألوان و أحجام منفصلة عن باقي الفوتر.</p>
        </div>

        {/* Background */}
        <div>
          <p className="text-sm font-semibold text-stone-700 mb-2">الخلفية</p>
          <div className="grid gap-4 md:grid-cols-2">
            <ColorField name="footer_brand_bg_color" label="لون خلفية القسم" defaultValue={settings.footer_brand_bg_color || "#292524"} />
            <div>
              <label htmlFor="footer_brand_padding_y" className="block text-sm font-semibold text-stone-700 mb-1">المسافة العمودية (Padding)</label>
              <div className="flex items-center rounded-xl border border-stone-200 focus-within:border-gold focus-within:ring-2 focus-within:ring-gold/20">
                <input id="footer_brand_padding_y" name="footer_brand_padding_y" type="number" min="0"
                  defaultValue={settings.footer_brand_padding_y ?? 48} dir="ltr"
                  className="w-full min-w-0 flex-1 rounded-l-xl px-4 py-2.5 text-sm focus:outline-none" />
                <span className="px-3 text-sm text-stone-400 select-none">px</span>
              </div>
            </div>
          </div>
        </div>

        {/* Logo */}
        <div>
          <p className="text-sm font-semibold text-stone-700 mb-2">الشعار</p>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div>
              <label htmlFor="footer_brand_logo_width" className="block text-sm font-semibold text-stone-700 mb-1">العرض</label>
              <div className="flex items-center rounded-xl border border-stone-200 focus-within:border-gold focus-within:ring-2 focus-within:ring-gold/20">
                <input id="footer_brand_logo_width" name="footer_brand_logo_width" type="number" min="0"
                  defaultValue={settings.footer_brand_logo_width ?? 120} dir="ltr"
                  className="w-full min-w-0 flex-1 rounded-l-xl px-4 py-2.5 text-sm focus:outline-none" />
                <span className="px-3 text-sm text-stone-400 select-none">px</span>
              </div>
            </div>
            <div>
              <label htmlFor="footer_brand_logo_height" className="block text-sm font-semibold text-stone-700 mb-1">الارتفاع (0 = تلقائي)</label>
              <div className="flex items-center rounded-xl border border-stone-200 focus-within:border-gold focus-within:ring-2 focus-within:ring-gold/20">
                <input id="footer_brand_logo_height" name="footer_brand_logo_height" type="number" min="0"
                  defaultValue={settings.footer_brand_logo_height ?? 0} dir="ltr"
                  className="w-full min-w-0 flex-1 rounded-l-xl px-4 py-2.5 text-sm focus:outline-none" />
                <span className="px-3 text-sm text-stone-400 select-none">px</span>
              </div>
            </div>
            <div>
              <label htmlFor="footer_brand_logo_gap" className="block text-sm font-semibold text-stone-700 mb-1">المسافة عن الوصف</label>
              <div className="flex items-center rounded-xl border border-stone-200 focus-within:border-gold focus-within:ring-2 focus-within:ring-gold/20">
                <input id="footer_brand_logo_gap" name="footer_brand_logo_gap" type="number" min="0"
                  defaultValue={settings.footer_brand_logo_gap ?? 16} dir="ltr"
                  className="w-full min-w-0 flex-1 rounded-l-xl px-4 py-2.5 text-sm focus:outline-none" />
                <span className="px-3 text-sm text-stone-400 select-none">px</span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-stone-700 mb-2">محاذاة الشعار</label>
              <div className="flex gap-2">
                <label className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white p-3 text-sm font-semibold text-stone-700 cursor-pointer has-[:checked]:border-gold has-[:checked]:bg-gold/5">
                  <input type="radio" name="footer_brand_logo_align" value="flex-start" defaultChecked={settings.footer_brand_logo_align === "flex-start"} className="h-4 w-4 accent-[#B08D57]" />
                  يمين
                </label>
                <label className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white p-3 text-sm font-semibold text-stone-700 cursor-pointer has-[:checked]:border-gold has-[:checked]:bg-gold/5">
                  <input type="radio" name="footer_brand_logo_align" value="center" defaultChecked={(settings.footer_brand_logo_align || "center") === "center"} className="h-4 w-4 accent-[#B08D57]" />
                  وسط
                </label>
                <label className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white p-3 text-sm font-semibold text-stone-700 cursor-pointer has-[:checked]:border-gold has-[:checked]:bg-gold/5">
                  <input type="radio" name="footer_brand_logo_align" value="flex-end" defaultChecked={settings.footer_brand_logo_align === "flex-end"} className="h-4 w-4 accent-[#B08D57]" />
                  يسار
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Description */}
        <div>
          <p className="text-sm font-semibold text-stone-700 mb-2">الوصف</p>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div>
              <label htmlFor="footer_brand_desc_size" className="block text-sm font-semibold text-stone-700 mb-1">حجم الخط</label>
              <div className="flex items-center rounded-xl border border-stone-200 focus-within:border-gold focus-within:ring-2 focus-within:ring-gold/20">
                <input id="footer_brand_desc_size" name="footer_brand_desc_size" type="number" min="8" max="40"
                  defaultValue={settings.footer_brand_desc_size ?? 14} dir="ltr"
                  className="w-full min-w-0 flex-1 rounded-l-xl px-4 py-2.5 text-sm focus:outline-none" />
                <span className="px-3 text-sm text-stone-400 select-none">px</span>
              </div>
            </div>
            <ColorField name="footer_brand_desc_color" label="لون النص" defaultValue={settings.footer_brand_desc_color || "#a8a29e"} />
            <div>
              <label htmlFor="footer_brand_desc_weight" className="block text-sm font-semibold text-stone-700 mb-1">وزن الخط</label>
              <div className="flex items-center rounded-xl border border-stone-200 focus-within:border-gold focus-within:ring-2 focus-within:ring-gold/20">
                <input id="footer_brand_desc_weight" name="footer_brand_desc_weight" type="number" min="100" max="900" step="100"
                  defaultValue={settings.footer_brand_desc_weight ?? 400} dir="ltr"
                  className="w-full min-w-0 flex-1 rounded-l-xl px-4 py-2.5 text-sm focus:outline-none" />
                <span className="px-3 text-sm text-stone-400 select-none"></span>
              </div>
            </div>
            <div>
              <label htmlFor="footer_brand_desc_max_width" className="block text-sm font-semibold text-stone-700 mb-1">العرض الأقصى</label>
              <div className="flex items-center rounded-xl border border-stone-200 focus-within:border-gold focus-within:ring-2 focus-within:ring-gold/20">
                <input id="footer_brand_desc_max_width" name="footer_brand_desc_max_width" type="number" min="200"
                  defaultValue={settings.footer_brand_desc_max_width ?? 600} dir="ltr"
                  className="w-full min-w-0 flex-1 rounded-l-xl px-4 py-2.5 text-sm focus:outline-none" />
                <span className="px-3 text-sm text-stone-400 select-none">px</span>
              </div>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-semibold text-stone-700 mb-2">محاذاة النص</label>
              <div className="flex gap-2">
                <label className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white p-3 text-sm font-semibold text-stone-700 cursor-pointer has-[:checked]:border-gold has-[:checked]:bg-gold/5">
                  <input type="radio" name="footer_brand_desc_align" value="right" defaultChecked={(settings.footer_brand_desc_align || "center") === "right"} className="h-4 w-4 accent-[#B08D57]" />
                  يمين
                </label>
                <label className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white p-3 text-sm font-semibold text-stone-700 cursor-pointer has-[:checked]:border-gold has-[:checked]:bg-gold/5">
                  <input type="radio" name="footer_brand_desc_align" value="center" defaultChecked={(settings.footer_brand_desc_align || "center") === "center"} className="h-4 w-4 accent-[#B08D57]" />
                  وسط
                </label>
                <label className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white p-3 text-sm font-semibold text-stone-700 cursor-pointer has-[:checked]:border-gold has-[:checked]:bg-gold/5">
                  <input type="radio" name="footer_brand_desc_align" value="left" defaultChecked={settings.footer_brand_desc_align === "left"} className="h-4 w-4 accent-[#B08D57]" />
                  يسار
                </label>
              </div>
            </div>
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

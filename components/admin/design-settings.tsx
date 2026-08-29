"use client";

import { useState } from "react";

type DesignSettingsProps = {
  fontFamily?: "cairo" | "system";
  baseFontSize?: number;
  headingScale?: number;
  primaryColor?: string;
  accentColor?: string;
  backgroundColor?: string;
  textColor?: string;
  cardRadius?: number;
  headerFooterFontSize?: number;
};

export function DesignSettings({
  fontFamily = "cairo",
  baseFontSize = 16,
  headingScale = 1,
  primaryColor = "#B08D57",
  accentColor = "#111111",
  backgroundColor = "#F8F6F1",
  textColor = "#111111",
  cardRadius = 16,
  headerFooterFontSize = 13,
}: DesignSettingsProps) {
  const [preview, setPreview] = useState({ fontFamily, baseFontSize, headingScale, primaryColor, accentColor, backgroundColor, textColor, cardRadius, headerFooterFontSize });
  const set = (key: keyof typeof preview, value: string | number) => setPreview((current) => ({ ...current, [key]: value }));
  const font = preview.fontFamily === "system" ? "system-ui, sans-serif" : "var(--font-cairo), sans-serif";
  const previewStyle = {
    fontFamily: font,
    fontSize: `${preview.baseFontSize}px`,
    backgroundColor: preview.backgroundColor,
    color: preview.textColor,
    borderRadius: `${preview.cardRadius}px`,
    "--preview-primary": preview.primaryColor,
    "--preview-accent": preview.accentColor,
  } as React.CSSProperties;

  return (
    <section className="space-y-5 rounded-2xl border border-amber-100 bg-white p-6">
      <div>
        <h2 className="font-bold text-stone-800">التصميم والمعاينة</h2>
        <p className="mt-1 text-sm text-stone-500">عدّل الخطوط والألوان والمقاسات وشاهد النتيجة قبل الحفظ.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm font-semibold text-stone-700">نوع الخط<select name="font_family" value={preview.fontFamily} onChange={(e) => set("fontFamily", e.target.value)} className="input-lux mt-1"><option value="cairo">Cairo</option><option value="system">System</option></select></label>
        <label className="text-sm font-semibold text-stone-700">حجم الخط الأساسي<input name="base_font_size" type="number" min="12" max="22" value={preview.baseFontSize} onChange={(e) => set("baseFontSize", Number(e.target.value))} className="input-lux mt-1" /></label>
        <label className="text-sm font-semibold text-stone-700">حجم العناوين<input name="heading_scale" type="number" min="0.8" max="1.4" step="0.05" value={preview.headingScale} onChange={(e) => set("headingScale", Number(e.target.value))} className="input-lux mt-1" /></label>
        <label className="text-sm font-semibold text-stone-700">استدارة البطاقات<input name="card_radius" type="number" min="0" max="32" value={preview.cardRadius} onChange={(e) => set("cardRadius", Number(e.target.value))} className="input-lux mt-1" /></label>
        <label className="text-sm font-semibold text-stone-700">حجم خط الهيدر والفوتر<input name="header_footer_font_size" type="number" min="10" max="22" value={preview.headerFooterFontSize} onChange={(e) => set("headerFooterFontSize", Number(e.target.value))} className="input-lux mt-1" /></label>
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {([['primaryColor', 'اللون الرئيسي', 'primary_color'], ['accentColor', 'لون الأزرار', 'accent_color'], ['backgroundColor', 'خلفية المتجر', 'background_color'], ['textColor', 'لون النص', 'text_color']] as const).map(([key, label, name]) => (
          <label key={key} className="text-sm font-semibold text-stone-700">{label}<span className="mt-1 flex items-center gap-2 rounded-xl border border-stone-200 bg-white p-2"><input name={name} type="color" value={preview[key]} onChange={(e) => set(key, e.target.value)} className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent p-0" /><span dir="ltr" className="text-xs text-stone-500">{preview[key]}</span></span></label>
        ))}
      </div>
      <div className="overflow-hidden border border-stone-200 p-5" style={previewStyle}>
        <p className="text-xs font-bold" style={{ color: "var(--preview-primary)" }}>معاينة مباشرة</p>
        <h3 className="mt-2 font-bold" style={{ fontSize: `${1.5 * preview.headingScale}rem`, color: "var(--preview-accent)" }}>متجر لمعة للاكسسوارات المطلية</h3>
        <p className="mt-1 text-sm opacity-70">هذا مثال يوضح الخط والألوان والمقاسات قبل حفظ الإعدادات.</p>
        <p className="mt-3 border-t border-black/10 pt-2" style={{ fontSize: `${preview.headerFooterFontSize}px` }}>معاينة نص الهيدر والفوتر</p>
        <button type="button" className="mt-4 px-5 py-2 text-sm font-bold text-white" style={{ backgroundColor: "var(--preview-accent)", borderRadius: `${preview.cardRadius}px` }}>زر تجريبي</button>
      </div>
    </section>
  );
}

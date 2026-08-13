import Link from "next/link";
import { Phone, Mail, MapPin, Heart, Lock } from "lucide-react";
import { InstagramIcon, TiktokIcon, SnapchatIcon, XTwitterIcon, WhatsappIcon } from "@/components/ui/social-icons";
import { BrandLogo } from "./brand-logo";
import type { Settings } from "@/types";

export function StoreFooter({ settings }: { settings: Settings }) {
  const socials = [
    { label: "انستقرام", href: settings.instagram, Icon: InstagramIcon },
    { label: "تيك توك", href: settings.tiktok, Icon: TiktokIcon },
    { label: "سناب شات", href: settings.snapchat, Icon: SnapchatIcon },
    { label: "تويتر", href: settings.twitter, Icon: XTwitterIcon },
  ].filter((s) => s.href);

  return (
    <footer className="bg-ink text-stone-300" style={{ fontSize: `${settings.header_footer_font_size || 14}px` }}>
      <div className="mx-auto max-w-7xl px-4 md:px-6 py-12">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-4">
          {/* Brand */}
          <div>
            <BrandLogo settings={settings} size="lg" />
             <p className="mt-3 text-stone-400 leading-relaxed" style={{ fontSize: `${settings.header_footer_font_size || 13}px` }}>
              {settings.footer_text ||
                "متجر متخصص في المجوهرات والإكسسوارات النسائية الفاخرة. قطع مختارة بعناية تجمع بين الأصالة والأناقة."}
            </p>
            {socials.length > 0 && (
              <div className="mt-5 flex items-center gap-2">
                {socials.map((s) => (
                  <a key={s.label} href={s.href!} target="_blank" rel="noopener noreferrer"
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-stone-400 hover:bg-gold hover:text-ivory transition"
                    aria-label={s.label}>
                    <s.Icon className="w-4 h-4" />
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* المتجر */}
          <div>
            <p className="font-bold text-ivory mb-4">المتجر</p>
             <ul className="space-y-2.5" style={{ fontSize: `${settings.header_footer_font_size || 13}px` }}>
              <li><Link href="/pages/about" className="hover:text-gold-light transition">من نحن</Link></li>
              <li><Link href="/shop" className="hover:text-gold-light transition">جميع المنتجات</Link></li>
              <li><Link href="/shop?sort=best" className="hover:text-gold-light transition">الأكثر مبيعاً</Link></li>
              <li><Link href="/shop?sale=1" className="hover:text-gold-light transition">العروض</Link></li>
              <li><Link href="/pages/shipping" className="hover:text-gold-light transition">الشحن والتوصيل</Link></li>
            </ul>
          </div>

          {/* خدمة العملاء */}
          <div>
            <p className="font-bold text-ivory mb-4">خدمة العملاء</p>
             <ul className="space-y-2.5" style={{ fontSize: `${settings.header_footer_font_size || 13}px` }}>
              <li><Link href="/pages/faq" className="hover:text-gold-light transition">الأسئلة الشائعة</Link></li>
              <li><Link href="/pages/returns" className="hover:text-gold-light transition">الاستبدال والاسترجاع</Link></li>
              <li><Link href="/pages/terms" className="hover:text-gold-light transition">الشروط والأحكام</Link></li>
              <li><Link href="/pages/privacy" className="hover:text-gold-light transition">الخصوصية</Link></li>
            </ul>
          </div>

          {/* تواصل معنا */}
          <div>
            <p className="font-bold text-ivory mb-4">تواصل معنا</p>
             <ul className="space-y-2.5" style={{ fontSize: `${settings.header_footer_font_size || 13}px` }}>
              {settings.whatsapp && (
                <li>
                  <a href={`https://wa.me/${settings.whatsapp}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:text-gold-light transition">
                    <WhatsappIcon className="w-4 h-4 text-emerald-400" /> <span dir="ltr">{settings.whatsapp}</span>
                  </a>
                </li>
              )}
              {settings.phone && (
                <li className="flex items-center gap-2"><Phone className="w-4 h-4 text-gold" /> <span dir="ltr">{settings.phone}</span></li>
              )}
              {settings.email && (
                <li className="flex items-center gap-2"><Mail className="w-4 h-4 text-gold" /> {settings.email}</li>
              )}
              {settings.address && (
                <li className="flex items-center gap-2"><MapPin className="w-4 h-4 text-gold" /> {settings.address}</li>
              )}
            </ul>
          </div>
        </div>

        <div className="mt-10 border-t border-white/10 pt-5">
          <div className="flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-stone-500">
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 justify-center">
              <span>© {new Date().getFullYear()} {settings.site_name || "لمعة للاكسسوارات المطلية"} — جميع الحقوق محفوظة</span>
              <Link href="/admin" className="inline-flex items-center gap-1 text-stone-600 hover:text-gold-light transition" title="لوحة التحكم" aria-label="لوحة التحكم">
                <Lock className="h-3 w-3" /> لوحة التحكم
              </Link>
            </p>
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 justify-center">
              {settings.commercial_register && <span>السجل التجاري: {settings.commercial_register}</span>}
              {settings.tax_number && <span>الرقم الضريبي: {settings.tax_number}</span>}
            </p>
            <p className="flex items-center gap-1">
              صُنع بـ <Heart className="w-3 h-3 text-gold fill-gold" /> للمجوهرات الفاخرة
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}

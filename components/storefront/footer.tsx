"use client";

import Link from "next/link";
import { Heart, Lock } from "lucide-react";
import { InstagramIcon, TiktokIcon, SnapchatIcon, XTwitterIcon, WhatsappIcon } from "@/components/ui/social-icons";
import { BrandLogo } from "./brand-logo";
import { waMeNumber } from "@/lib/format";
import type { Settings, Page } from "@/types";

// Static navigation links (not from pages table — these are shop navigation)
const STATIC_LINKS = [
  { label: "جميع المنتجات", href: "/shop" },
  { label: "الأكثر مبيعاً", href: "/shop?sort=best" },
  { label: "العروض", href: "/shop?sale=1" },
];

export function StoreFooter({ settings, pages = [] }: { settings: Settings; pages?: Page[] }) {
  const fontSize = settings.header_footer_font_size || 14;

  // Main footer colors
  const bgColor = settings.footer_bg_color || "#1a1a1a";
  const textColor = settings.footer_text_color || "#a8a29e";
  const linkColor = settings.footer_link_color || "#a8a29e";
  const linkHoverColor = settings.footer_link_hover_color || "#d4af37";
  const headingColor = settings.footer_heading_color || "#f5f5f4";
  const borderColor = settings.footer_border_color || "rgba(255,255,255,0.1)";
  const bottomBg = settings.footer_bottom_bg_color || "#1a1a1a";
  const bottomText = settings.footer_bottom_text_color || "#78716c";

  // Brand section independent colors
  const brandBg = settings.footer_brand_bg_color || "#292524";
  const brandPaddingY = settings.footer_brand_padding_y ?? 48;
  const logoAlign = settings.footer_brand_logo_align || "center";
  const logoGap = settings.footer_brand_logo_gap ?? 16;
  const descSize = settings.footer_brand_desc_size ?? 14;
  const descColor = settings.footer_brand_desc_color || textColor;
  const descWeight = settings.footer_brand_desc_weight ?? 400;
  const descAlign = settings.footer_brand_desc_align || "center";
  const descMaxWidth = settings.footer_brand_desc_max_width ?? 600;

  const showBrand = settings.footer_show_brand !== false;
  const showLinks = settings.footer_show_links !== false;

  // All page links come from the pages table (admin-controlled)
  const pageLinks = pages.map((p) => ({ label: p.title, href: `/pages/${p.slug}` }));

  const footerGroups: { title: string; links: { label: string; href: string }[] }[] = [];

  // Store group: static navigation links
  if (STATIC_LINKS.length > 0) {
    footerGroups.push({ title: "المتجر", links: STATIC_LINKS });
  }

  // Pages group: all active pages from DB (admin-controlled)
  if (pageLinks.length > 0) {
    footerGroups.push({ title: "روابط الموقع", links: pageLinks });
  }

  const socials = [
    { label: "انستقرام", href: settings.instagram, Icon: InstagramIcon },
    { label: "تيك توك", href: settings.tiktok, Icon: TiktokIcon },
    { label: "سناب شات", href: settings.snapchat, Icon: SnapchatIcon },
    { label: "تويتر", href: settings.twitter, Icon: XTwitterIcon },
  ].filter((s) => s.href);

  return (
    <footer className="relative">
      {/* WhatsApp icon — fixed at left edge */}
      {settings.whatsapp && (
        <a
          href={`https://wa.me/${waMeNumber(settings.whatsapp)}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="تواصل معنا عبر واتساب"
          title="تواصل معنا عبر واتساب"
          className="fixed bottom-6 left-4 z-50 flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition hover:scale-110"
          style={{ backgroundColor: "#25D366", color: "#fff" }}
        >
          <WhatsappIcon className="w-6 h-6" />
        </a>
      )}

      {/* === Brand Section (independent background) === */}
      {showBrand && (
        <div style={{ backgroundColor: brandBg, padding: `${brandPaddingY}px 0` }}>
          <div className="mx-auto max-w-7xl px-4 md:px-6">
            <div className="flex flex-col items-center" style={{ justifyContent: logoAlign }}>
              <BrandLogo settings={settings} size="lg" showName={false} />
              <p
                className="mt-3 leading-relaxed text-center"
                style={{
                  color: descColor,
                  fontSize: `${descSize}px`,
                  fontWeight: descWeight,
                  maxWidth: descMaxWidth,
                }}
              >
                {settings.footer_text ||
                  "متجر متخصص في الإكسسوارات المطلية النسائية الفاخرة. قطع مختارة بعناية تجمع بين الأصالة والأناقة."}
              </p>
              {socials.length > 0 && (
                <div className="mt-5 flex items-center gap-2" style={{ justifyContent: logoAlign === "flex-start" ? "flex-end" : logoAlign === "flex-end" ? "flex-start" : "center" }}>
                  {socials.map((s) => (
                    <a key={s.label} href={s.href!} target="_blank" rel="noopener noreferrer"
                      className="flex h-9 w-9 items-center justify-center rounded-full transition"
                      style={{ backgroundColor: "rgba(255,255,255,0.05)", color: descColor }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = linkHoverColor; e.currentTarget.style.color = "#fff"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.05)"; e.currentTarget.style.color = descColor; }}
                      aria-label={s.label}>
                      <s.Icon className="w-4 h-4" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* === Main Footer (links + contact) === */}
      <div style={{ backgroundColor: bgColor, color: textColor, fontSize: `${fontSize}px` }}>
        <div className="mx-auto max-w-7xl px-4 md:px-6 py-12">
          <div className="flex flex-col gap-10 md:flex-row md:flex-wrap lg:flex-nowrap lg:justify-center lg:gap-x-40 lg:gap-y-8">
            {/* Links groups */}
            {showLinks && footerGroups.length > 0 && (
              <div className="flex gap-10 flex-wrap lg:flex-nowrap justify-center lg:justify-start">
                {footerGroups.map((group) => (
                  <div key={group.title} className="text-center min-w-[140px]">
                    <p className="font-bold mb-4" style={{ color: headingColor }}>{group.title}</p>
                    <ul className="space-y-2.5" style={{ fontSize: `${fontSize}px` }}>
                      {group.links.map((link) => (
                        <li key={link.href}>
                          <Link href={link.href}
                            className="transition"
                            style={{ color: linkColor }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = linkHoverColor; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = linkColor; }}>
                            {link.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Bottom bar */}
          <div className="mt-10 pt-5" style={{ borderTop: `1px solid ${borderColor}` }}>
            <div className="flex flex-col md:flex-row items-center justify-between gap-3 text-xs" style={{ color: bottomText, backgroundColor: bottomBg }}>
              <p className="flex flex-wrap items-center gap-x-4 gap-y-1 justify-center">
                <span>© {new Date().getFullYear()} {settings.site_name || "متجر لمعة للاكسسوارات المطلية"} — جميع الحقوق محفوظة</span>
                <Link href="/admin" className="inline-flex items-center gap-1 hover:opacity-80 transition" title="لوحة التحكم" aria-label="لوحة التحكم">
                  <Lock className="h-3 w-3" /> لوحة التحكم
                </Link>
              </p>
              <p className="flex flex-wrap items-center gap-x-4 gap-y-1 justify-center">
                {settings.commercial_register && <span>السجل التجاري: {settings.commercial_register}</span>}
                {settings.tax_number && <span>الرقم الضريبي: {settings.tax_number}</span>}
              </p>
              <p className="flex items-center gap-1">
                صُنع بـ <Heart className="w-3 h-3 text-gold fill-gold" /> للإكسسوارات المطلية الفاخرة
              </p>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

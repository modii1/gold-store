import type { Metadata } from "next";
import { Cairo } from "next/font/google";
import "./globals.css";
import "leaflet/dist/leaflet.css";
import { getSettings } from "@/lib/services/settings";
import { StoreProviders } from "@/components/storefront/providers";
import { PageViewTracker } from "@/components/analytics/page-view-tracker";

const cairo = Cairo({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-cairo",
});

export const metadata: Metadata = {
  title: {
    default: "متجر لمعة للاكسسوارات المطلية | متجر اكسسوارات فاخر",
    template: "%s | متجر لمعة للاكسسوارات المطلية",
  },
  description: "متجر إكسسوارات مطلية نسائية فاخرة — تشكيلة مختارة بعناية من القطع الراقية",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const settings = await getSettings();
  const designStyle = {
    "--brand-primary": settings.primary_color || "#B08D57",
    "--brand-accent": settings.accent_color || "#111111",
    "--brand-background": settings.background_color || "#F8F6F1",
    "--brand-text": settings.text_color || "#111111",
    "--brand-radius": `${settings.card_radius || 16}px`,
    "--brand-font-size": `${settings.base_font_size || 16}px`,
    "--brand-heading-scale": settings.heading_scale || 1,
    "--currency-mark-url": `url(${settings.currency_mark_url || "/currency-mark.svg"})`,
    "--currency-mark-display": settings.show_currency_mark === false ? "none" : "inline-block",
  } as React.CSSProperties;

  return (
    <html lang="ar" dir="rtl" className={`${cairo.variable} h-full antialiased`} style={designStyle}>
      <body className="min-h-full flex flex-col bg-background font-cairo">
        <StoreProviders settings={settings}>
          <PageViewTracker />
          {children}
        </StoreProviders>
      </body>
    </html>
  );
}

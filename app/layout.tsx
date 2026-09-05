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

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  const logo = settings.store_logo || "/icon.svg";
  const siteName = settings.site_name || "متجر لمعة للاكسسوارات المطلية";
  return {
    title: {
      default: `${siteName} | متجر اكسسوارات فاخر`,
      template: `%s | ${siteName}`,
    },
    description: "متجر إكسسوارات مطلية نسائية فاخرة — تشكيلة مختارة بعناية من القطع الراقية",
    icons: {
      icon: [
        { url: "/favicon.png", sizes: "32x32", type: "image/png" },
        { url: "/favicon.png", sizes: "192x192", type: "image/png" },
        { url: "/favicon.png", sizes: "512x512", type: "image/png" },
      ],
      shortcut: "/favicon.png",
      apple: "/favicon.png",
    },
    openGraph: {
      title: siteName,
      description: "متجر إكسسوارات مطلية نسائية فاخرة — تشكيلة مختارة بعناية من القطع الراقية",
      images: [
        {
          url: logo,
          width: 512,
          height: 512,
          alt: siteName,
        },
      ],
      type: "website",
      locale: "ar_SA",
      siteName,
    },
    twitter: {
      card: "summary_large_image",
      title: siteName,
      description: "متجر إكسسوارات مطلية نسائية فاخرة — تشكيلة مختارة بعناية من القطع الراقية",
      images: [logo],
    },
  };
}

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

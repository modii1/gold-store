import Link from "next/link";
import type { CSSProperties } from "react";
import type { Settings } from "@/types";

export function Hero({ settings }: { settings: Settings }) {
  const image = settings.hero_image;
  const mobileImage = settings.hero_image_mobile || image;
  const ctaText = settings.hero_cta_text || "تسوقي الآن";
  const ctaLink = settings.hero_cta_link || "/shop";
  const showCta = settings.hero_show_cta !== false;

  const heroWidth = Number.isFinite(settings.hero_width) && settings.hero_width! > 0
    ? settings.hero_width!
    : 1920;

  const heroStyle: CSSProperties = {
    width: "100%",
    maxWidth: `${heroWidth}px`,
    marginInline: "auto",
  };

  // إخفاء تراكب النص (العنوان/النص/زر تسوقي الآن) على مقاسات محددة
  const hideClasses = [
    settings.hero_hide_mobile && "max-[767px]:hidden",
    settings.hero_hide_tablet && "min-[768px]:max-[1023px]:hidden",
    settings.hero_hide_desktop && "min-[1024px]:hidden",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className="relative w-full overflow-hidden bg-ink" style={heroStyle}>
      {/* Desktop image — flows at its natural aspect ratio (no crop / no zoom) */}
      {image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt={settings.hero_title} className="hidden md:block w-full h-auto" />
      )}
      {/* Mobile image */}
      {mobileImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={mobileImage} alt={settings.hero_title} className="md:hidden w-full h-auto" />
      )}
      {!image && !mobileImage && (
        <div className="block min-h-[50vh] w-full bg-gradient-to-b from-ink via-[#2a241c] to-background" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-ink/60 via-ink/25 to-ink/5 pointer-events-none" />

      <div className={`absolute inset-0 flex items-center justify-center mx-auto w-full max-w-7xl px-4 md:px-6 py-16 md:py-20 text-center text-ivory ${hideClasses}`}>
        <h1 className="text-3xl md:text-6xl font-bold leading-tight text-ivory drop-shadow">
          {settings.hero_title}
        </h1>
        {settings.hero_subtitle && (
          <p className="mt-4 max-w-xl mx-auto text-base md:text-xl text-ivory/80 font-light">
            {settings.hero_subtitle}
          </p>
        )}
        {showCta && (
          <Link
            href={ctaLink}
            className="mt-8 inline-flex items-center justify-center rounded-full bg-ivory px-10 py-3.5 text-sm md:text-base font-bold text-ink hover:bg-gold hover:text-ivory transition shadow-lg"
          >
            {ctaText}
          </Link>
        )}
      </div>
    </section>
  );
}

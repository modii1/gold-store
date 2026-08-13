import Link from "next/link";
import type { Settings } from "@/types";

export function Hero({ settings }: { settings: Settings }) {
  const image = settings.hero_image;
  const mobileImage = settings.hero_image_mobile || image;
  const ctaText = settings.hero_cta_text || "تسوقي الآن";
  const ctaLink = settings.hero_cta_link || "/shop";

  return (
    <section className="relative overflow-hidden bg-ink">
      {/* Desktop image */}
      {image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt={settings.hero_title}
          className="absolute inset-0 h-full w-full object-cover hidden md:block"
        />
      )}
      {/* Mobile image */}
      {mobileImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={mobileImage}
          alt={settings.hero_title}
          className="absolute inset-0 h-full w-full object-cover md:hidden"
        />
      )}
      {!image && !mobileImage && (
        <div className="absolute inset-0 bg-gradient-to-b from-ink via-[#2a241c] to-background" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-ink/80 via-ink/30 to-ink/10" />

      <div className="relative mx-auto max-w-7xl px-4 md:px-6 pt-40 md:pt-56 pb-24 md:pb-32 text-center text-ivory">
        <p className="text-gold-light text-sm md:text-base font-semibold tracking-[0.35em] uppercase mb-4">
          {settings.site_name || "مجوهرات فاخرة"}
        </p>
        <h1 className="text-3xl md:text-6xl font-bold leading-tight text-ivory drop-shadow">
          {settings.hero_title}
        </h1>
        {settings.hero_subtitle && (
          <p className="mt-4 max-w-xl mx-auto text-base md:text-xl text-ivory/80 font-light">
            {settings.hero_subtitle}
          </p>
        )}
        <Link
          href={ctaLink}
          className="mt-8 inline-flex items-center justify-center rounded-full bg-ivory px-10 py-3.5 text-sm md:text-base font-bold text-ink hover:bg-gold hover:text-ivory transition shadow-lg"
        >
          {ctaText}
        </Link>
      </div>
    </section>
  );
}

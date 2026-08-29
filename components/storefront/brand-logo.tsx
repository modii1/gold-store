import Link from "next/link";
import { Gem } from "lucide-react";
import type { Settings } from "@/types";

export function BrandLogo({ settings, size = "md" }: { settings: Settings; size?: "md" | "lg" }) {
  const name = settings.site_name || "متجر لمعة للاكسسوارات المطلية";
  const markCls = size === "lg" ? "h-12 w-12" : "h-9 w-9 md:h-11 md:w-11";
  const iconCls = size === "lg" ? "h-6 w-6" : "h-5 w-5 md:h-6 md:w-6";
  const textCls = "font-bold text-gradient-gold whitespace-nowrap";
  const textStyle = { fontSize: `${settings.header_footer_font_size || 13}px` };

  return (
    <Link href="/" className="inline-flex items-center gap-2.5 min-w-0" aria-label={name}>
      {settings.store_logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={settings.store_logo} alt={name} className="h-9 md:h-11 w-auto object-contain" />
      ) : (
        <span
          className={`flex ${markCls} shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-gold to-gold-dark text-ivory shadow-sm`}
        >
          <Gem className={iconCls} />
        </span>
      )}
      <span className={textCls} style={textStyle}>{name}</span>
    </Link>
  );
}

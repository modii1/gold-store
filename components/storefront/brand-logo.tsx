import Link from "next/link";
import { Gem } from "lucide-react";
import type { CSSProperties } from "react";
import type { Settings } from "@/types";

export function BrandLogo({ settings, size = "md", showName = true, mobileMaxSize, mobileScale }: { settings: Settings; size?: "md" | "lg"; showName?: boolean; mobileMaxSize?: number; mobileScale?: number }) {
  const rawName = settings.site_name || "لمعة للاكسسوارات المطلية";
  const name = rawName.replace(/^متجر\s*/i, "").trim() || "لمعة للاكسسوارات المطلية";

  const isHeader = size === "md";

  // Read user values directly — no fallbacks that override
  const w = isHeader ? settings.header_logo_width : settings.footer_brand_logo_width;
  const h = isHeader ? settings.header_logo_height : settings.footer_brand_logo_height;

  const hasExplicitWidth = typeof w === "number" && w > 0;
  const hasExplicitHeight = typeof h === "number" && h > 0;

  // Build image style: apply exactly what the user set, nothing more
  const imgStyle: CSSProperties = { objectFit: "contain" };
  if (mobileMaxSize) {
    // Mobile: fixed size from header, ignore admin width/height
    imgStyle.width = mobileMaxSize;
    imgStyle.height = mobileMaxSize;
    if (mobileScale) imgStyle.transform = `scale(${mobileScale})`;
  } else if (hasExplicitWidth) {
    // Desktop: read from admin settings
    imgStyle.width = w;
    if (hasExplicitHeight) imgStyle.height = h;
  } else if (hasExplicitHeight) {
    imgStyle.height = h;
  } else {
    if (isHeader) {
      imgStyle.height = 40;
    } else {
      imgStyle.width = 120;
    }
  }

  const markCls = size === "lg" ? "h-12 w-12" : "h-8 w-8 md:h-9 md:w-9";
  const iconCls = size === "lg" ? "h-6 w-6" : "h-4 w-4 md:h-5 md:w-5";
  const textCls = "font-bold text-gradient-gold leading-tight";
  const textStyle = { fontSize: `${settings.header_footer_font_size || 13}px` };

  return (
    <Link href="/" className="inline-flex items-center gap-2 min-w-0 shrink-0" aria-label={name}>
      {settings.store_logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={settings.store_logo} alt={name} className="shrink-0" style={imgStyle} />
      ) : (
        <span
          className={`flex ${markCls} shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-gold to-gold-dark text-ivory shadow-sm`}
        >
          <Gem className={iconCls} />
        </span>
      )}
      {showName && <span className={textCls} style={textStyle}>{name}</span>}
    </Link>
  );
}

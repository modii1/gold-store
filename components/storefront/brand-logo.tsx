import Link from "next/link";
import { Gem } from "lucide-react";
import type { CSSProperties } from "react";
import type { Settings } from "@/types";

export function BrandLogo({ settings, size = "md" }: { settings: Settings; size?: "md" | "lg" }) {
  const rawName = settings.site_name || "لمعة للاكسسوارات المطلية";
  // هوية العرض: نُزيل بادئة «متجر» من الاسم المعروض (تظهر مرة واحدة فقط في الـ Header)
  const name = rawName.replace(/^متجر\s*/i, "").trim() || "لمعة للاكسسوارات المطلية";
  const markCls = size === "lg" ? "h-12 w-12" : "h-9 w-9 md:h-11 md:w-11";
  const iconCls = size === "lg" ? "h-6 w-6" : "h-5 w-5 md:h-6 md:w-6";
  // الاسم يلتف لسطرين بأمان على الشاشات الضيقة بدل قصّه، ويبقى بسطر واحد
  // على الشاشات الأوسع. لا نستخدم truncate/overflow مطلقاً حتى لا يُقصّ النص.
  const textCls = "font-bold text-gradient-gold leading-tight";
  const textStyle = { fontSize: `${settings.header_footer_font_size || 13}px` };

  return (
    <Link href="/" className="inline-flex items-center gap-2.5 min-w-0" aria-label={name}>
      {settings.store_logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={settings.store_logo} alt={name} className="h-9 md:h-11 w-auto object-contain shrink-0" />
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

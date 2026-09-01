import {
  Sparkles,
  BadgeCheck,
  LayoutTemplate,
  Truck,
  ShieldCheck,
  Gem,
  MessagesSquare,
  Star,
  Package,
  Percent,
  Circle,
} from "lucide-react";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Sparkles,
  BadgeCheck,
  LayoutTemplate,
  Truck,
  ShieldCheck,
  Gem,
  MessagesSquare,
  Star,
  Package,
  Percent,
};

export function CustomSection({
  title,
  subtitle,
  imageUrl,
  icon,
  content,
}: {
  title: string | null;
  subtitle?: string | null;
  imageUrl?: string | null;
  icon?: string | null;
  content?: string | null;
}) {
  const Icon = (icon && ICON_MAP[icon]) || Circle;
  const lines = (content || "").split("\n").filter((l) => l.trim().length > 0);

  return (
    <section className="border-b border-sand bg-ivory py-12 md:py-16">
      <div className="mx-auto max-w-7xl px-4 md:px-6">
        <div className="grid items-center gap-8 md:grid-cols-2">
          {imageUrl && (
            <div className="order-2 md:order-1 overflow-hidden rounded-2xl">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl} alt={title || ""} className="h-64 md:h-80 w-full object-cover" />
            </div>
          )}
          <div className={imageUrl ? "order-1 md:order-2" : "text-center mx-auto max-w-2xl"}>
            {icon && (
              <span className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-cream text-gold-dark">
                <Icon className="h-6 w-6" />
              </span>
            )}
            {title && <h2 className="text-2xl md:text-3xl font-bold text-ink">{title}</h2>}
            {subtitle && <p className="mt-2 text-sm md:text-base text-stone-500">{subtitle}</p>}
            {lines.length > 0 && (
              <div className="mt-4 space-y-2">
                {lines.map((line, i) => (
                  <p key={i} className="text-sm md:text-base leading-7 text-stone-700">{line}</p>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

import Link from "next/link";
import type { Category, Settings } from "@/types";

export function CategoryStrip({ categories, settings }: { categories: Category[]; settings: Settings }) {
  const sectionWidth = Number.isFinite(settings.category_section_width) && settings.category_section_width! > 0
    ? settings.category_section_width!
    : 1200;
  const itemSize = Number.isFinite(settings.category_item_size) && settings.category_item_size! > 0
    ? settings.category_item_size!
    : 120;
  const gap = Number.isFinite(settings.category_item_gap) && settings.category_item_gap! > 0
    ? settings.category_item_gap!
    : 28;
  const isSquare = settings.category_item_shape === "square";
  const borderRadius = isSquare ? "12px" : "9999px";

  return (
    <section className="border-b border-sand bg-ivory">
      <div
        className="mx-auto px-4 md:px-6 py-8"
        style={{ maxWidth: `${sectionWidth}px` }}
      >
        {/*
          Category scroll container:
          - Always horizontal, no wrap
          - Mobile: touch scroll, no scrollbar
          - Desktop: hidden scrollbar by default, visible on hover
        */}
        <style>{`
          .cat-scroll::-webkit-scrollbar { display: none; height: 0; }
          .cat-scroll { scrollbar-width: none; }
          @media (min-width: 768px) {
            .cat-scroll-wrap:hover .cat-scroll::-webkit-scrollbar { display: block; height: 8px; }
            .cat-scroll-wrap:hover .cat-scroll { scrollbar-width: thin; }
            .cat-scroll::-webkit-scrollbar-track { background: #e7e5e4; border-radius: 999px; }
            .cat-scroll::-webkit-scrollbar-thumb { background: #a8a29e; border-radius: 999px; }
          }
        `}</style>
        <div className="cat-scroll-wrap relative">
          <div
            className="cat-scroll flex w-full items-start justify-start overflow-x-auto pb-2 scroll-smooth"
            style={{ gap: `${gap}px` }}
          >
            {categories.map((c) => (
              <Link
                key={c.id}
                href={`/category/${c.slug}`}
                className="group flex shrink-0 flex-col items-center"
                style={{ width: `${itemSize}px` }}
              >
                <span
                  className="flex items-center justify-center overflow-hidden bg-cream border border-sand transition group-hover:border-gold shadow-sm group-hover:shadow-md"
                  style={{ width: `${itemSize}px`, height: `${itemSize}px`, borderRadius }}
                >
                  {c.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.image} alt={c.name} loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-gold font-bold" style={{ fontSize: `${Math.round(itemSize * 0.3)}px` }}>{c.name.slice(0, 1)}</span>
                  )}
                </span>
                <span className="mt-2 w-full text-center text-sm md:text-base font-semibold text-stone-600 group-hover:text-gold transition whitespace-nowrap overflow-hidden text-ellipsis">
                  {c.name}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

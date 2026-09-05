import Link from "next/link";
import type { Category, Settings } from "@/types";

export function CategoryStrip({ categories, settings }: { categories: Category[]; settings: Settings }) {
  const sectionWidth = settings.category_grid_width || 1200;
  const sectionHeight = settings.category_grid_height || 0;
  const desktopSize = settings.category_grid_desktop_size || 120;
  const desktopHeight = settings.category_grid_desktop_height || 120;
  const desktopGap = settings.category_grid_desktop_gap || 28;
  const desktopCols = settings.category_grid_desktop_cols || 6;
  const tabletCols = settings.category_grid_tablet_cols || 4;
  const mobileSize = settings.category_grid_mobile_size || 80;
  const mobileHeight = settings.category_grid_mobile_height || 80;
  const mobileGap = settings.category_grid_mobile_gap || 16;
  const mobileCols = settings.category_grid_mobile_cols || 3;
  const isSquare = settings.category_item_shape === "square";
  const borderRadius = isSquare ? "12px" : "9999px";

  const sectionStyle: React.CSSProperties = {};
  if (sectionWidth > 0) sectionStyle.maxWidth = `${sectionWidth}px`;
  if (sectionHeight > 0) sectionStyle.height = `${sectionHeight}px`;

  return (
    <section className="border-b border-sand bg-ivory">
      <style dangerouslySetInnerHTML={{ __html: `
        .cat-grid { grid-template-columns: repeat(${mobileCols}, auto); justify-content: center; gap: ${mobileGap}px; }
        .cat-item { width: ${mobileSize}px; height: ${mobileHeight}px; }
        @media (min-width: 768px) {
          .cat-grid { grid-template-columns: repeat(${tabletCols}, auto); justify-content: center; gap: ${desktopGap}px; }
          .cat-item { width: ${desktopSize}px; height: ${desktopHeight}px; }
        }
        @media (min-width: 1024px) {
          .cat-grid { grid-template-columns: repeat(${desktopCols}, auto); justify-content: center; gap: ${desktopGap}px; }
          .cat-item { width: ${desktopSize}px; height: ${desktopHeight}px; }
        }
      `}} />
      <div
        className="mx-auto px-4 md:px-6 py-8"
        style={sectionStyle}
      >
        <div className="cat-grid grid">
          {categories.map((c) => (
            <Link
              key={c.id}
              href={`/category/${c.slug}`}
              className="group flex flex-col items-center"
            >
              <span
                className="cat-item flex items-center justify-center overflow-hidden bg-cream border border-sand transition group-hover:border-gold shadow-sm group-hover:shadow-md"
                style={{ borderRadius }}
              >
                {c.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.image} alt={c.name} loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-gold font-bold text-3xl">{c.name.slice(0, 1)}</span>
                )}
              </span>
              <span className="mt-2 w-full text-center text-sm md:text-base font-semibold text-stone-600 group-hover:text-gold transition whitespace-nowrap overflow-hidden text-ellipsis">
                {c.name}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

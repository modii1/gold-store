import Link from "next/link";
import type { Category } from "@/types";

export function CategoryStrip({ categories }: { categories: Category[] }) {
  return (
    <section className="border-b border-sand bg-ivory">
      <div className="mx-auto max-w-7xl px-4 md:px-6 py-8">
        {/* شريط أفقي قابل للتمرير يميناً/يساراً (يعمل باللمس و السحب) */}
        <div className="flex w-full items-start justify-start gap-x-4 md:gap-x-7 overflow-x-auto pb-2 scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {categories.map((c) => (
            <Link
              key={c.id}
              href={`/category/${c.slug}`}
              className="group flex w-24 md:w-40 shrink-0 flex-col items-center gap-2.5"
            >
              <span className="flex h-24 w-24 md:h-32 md:w-32 items-center justify-center overflow-hidden rounded-full bg-cream border border-sand transition group-hover:border-gold shadow-sm group-hover:shadow-md">
                {c.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.image} alt={c.name} loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-3xl md:text-4xl text-gold font-bold">{c.name.slice(0, 1)}</span>
                )}
              </span>
              <span className="w-full text-center text-sm md:text-base font-semibold text-stone-600 group-hover:text-gold transition whitespace-nowrap overflow-hidden text-ellipsis">
                {c.name}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

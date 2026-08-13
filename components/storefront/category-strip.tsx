import Link from "next/link";
import type { Category } from "@/types";

export function CategoryStrip({ categories }: { categories: Category[] }) {
  return (
    <section className="border-b border-sand bg-ivory">
      <div className="mx-auto max-w-7xl px-4 md:px-6 py-8">
        <div className="scrollbar-hide flex gap-4 overflow-x-auto pb-2 -mx-4 px-4">
          {categories.map((c) => (
            <Link
              key={c.id}
              href={`/category/${c.slug}`}
              className="group flex shrink-0 flex-col items-center gap-2 w-20 md:w-24"
            >
              <span className="flex h-16 w-16 md:h-20 md:w-20 items-center justify-center overflow-hidden rounded-full bg-cream border border-sand transition group-hover:border-gold">
                {c.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.image} alt={c.name} loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-2xl text-gold font-bold">{c.name.slice(0, 1)}</span>
                )}
              </span>
              <span className="text-xs md:text-sm font-semibold text-stone-600 group-hover:text-gold transition whitespace-nowrap">
                {c.name}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

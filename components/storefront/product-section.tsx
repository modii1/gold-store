import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { ProductCard } from "./product-card";
import type { Product } from "@/types";

export function ProductSection({
  title,
  subtitle,
  viewAll,
  products,
  dark,
}: {
  title: string;
  subtitle?: string;
  viewAll: string;
  products: Product[];
  dark?: boolean;
}) {
  if (products.length === 0) return null;

  return (
    <section className={`py-12 md:py-16 ${dark ? "bg-ink text-ivory" : "bg-ivory"}`}>
      <div className="mx-auto max-w-7xl px-4 md:px-6">
        <div className="flex items-end justify-between mb-8 gap-4">
          <div>
            <h2 className={`text-2xl md:text-3xl font-bold ${dark ? "text-ivory" : "text-ink"}`}>{title}</h2>
            {subtitle && <p className={`mt-1 text-sm md:text-base ${dark ? "text-ivory/60" : "text-stone-500"}`}>{subtitle}</p>}
          </div>
          <Link
            href={viewAll}
            className={`flex items-center gap-1 text-sm font-bold whitespace-nowrap ${dark ? "text-gold-light hover:text-ivory" : "text-gold-dark hover:text-ink"} transition`}
          >
            عرض الكل <ChevronLeft className="w-4 h-4" />
          </Link>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-6">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </div>
    </section>
  );
}

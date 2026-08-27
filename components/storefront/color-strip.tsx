import Link from "next/link";

const hexMap: Record<string, string> = {
  "ذهبي": "#D4AF37", "ذهب": "#D4AF37", "ذهبي فاتح": "#E7C77A", "ذهبي غامق": "#8F6F3F",
  "فضي": "#C0C0C0", "فضة": "#C0C0C0",
  "روز قولد": "#B76E79", "روز": "#B76E79", "روزغولد": "#B76E79",
  "أسود": "#1A1A1A", "اسود": "#1A1A1A",
  "أبيض": "#F5F5F5", "ابيض": "#F5F5F5",
  "أحمر": "#C0392B", "احمر": "#C0392B",
  "أزرق": "#2E86AB", "ازرق": "#2E86AB",
  "أخضر": "#27AE60", "اخضر": "#27AE60",
  "بنفسجي": "#8E44AD", "موف": "#8E44AD",
  "بني": "#8B5A2B", "بيج": "#D8CAB5", "عسلي": "#C9A86A", "نحاسي": "#B87333",
};

function colorHex(name: string): string {
  return hexMap[name.trim()] || "#D4AF37";
}

export function ColorStrip({ colors }: { colors: string[] }) {
  const uniq = Array.from(new Set(colors.flatMap((c) => c.split(/[،,]/).map((s) => s.trim())).filter(Boolean))).slice(0, 12);
  if (uniq.length === 0) return null;
  return (
    <section className="border-b border-sand bg-white">
      <div className="mx-auto max-w-7xl px-4 md:px-6 py-8">
        <h2 className="text-center text-lg md:text-xl font-bold text-ink">تسوقي حسب اللون</h2>
        <p className="mt-1 text-center text-xs text-stone-400">اختاري لونك المفضل</p>
        <div className="mt-6 flex gap-5 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide justify-start md:justify-center">
          {uniq.map((c) => (
            <Link
              key={c}
              href={`/shop?color=${encodeURIComponent(c)}`}
              className="group flex shrink-0 flex-col items-center gap-2"
            >
              <span
                className="flex h-14 w-14 md:h-16 md:w-16 items-center justify-center rounded-full border-2 border-sand shadow-sm transition group-hover:border-gold group-hover:scale-105"
                style={{ background: colorHex(c) }}
              />
              <span className="text-xs md:text-sm font-bold text-stone-600 group-hover:text-gold transition whitespace-nowrap">
                {c}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

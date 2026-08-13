import { formatCurrency } from "@/lib/format";

export function Currency({ value, className = "" }: { value: number | null | undefined; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap ${className}`} dir="ltr">
      <span>{formatCurrency(value)}</span>
      <span className="currency-mark h-[1em] w-[1em]" aria-hidden="true" />
    </span>
  );
}

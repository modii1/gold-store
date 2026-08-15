export function effectivePrice(p: { price: number; sale_price: number | null }) {
  return p.sale_price && p.sale_price > 0 ? p.sale_price : p.price;
}

export function discountPercent(p: { price: number; sale_price: number | null }) {
  if (!p.sale_price || p.sale_price <= 0 || p.sale_price >= p.price) return 0;
  return Math.round(((p.price - p.sale_price) / p.price) * 100);
}

export function formatCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value ?? 0);
}

const DATE_FMT = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });
const DATETIME_FMT = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

export function formatDate(value: string | Date | null | undefined) {
  if (!value) return "";
  try {
    return DATETIME_FMT.format(new Date(value));
  } catch {
    return "";
  }
}

export function formatDateOnly(value: string | Date | null | undefined) {
  if (!value) return "";
  try {
    return DATE_FMT.format(new Date(value));
  } catch {
    return "";
  }
}

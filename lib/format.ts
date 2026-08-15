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

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function pluralizeArabic(count: number, singular: string, dual: string, plural: string) {
  if (count === 1) return singular;
  if (count === 2) return dual;
  if (count >= 3 && count <= 10) return plural;
  return singular;
}

function datePart(d: Date) {
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

export function formatDate(value: string | Date | null | undefined) {
  if (!value) return "";
  try {
    const d = new Date(value);
    return `${datePart(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return "";
  }
}

export function formatDateOnly(value: string | Date | null | undefined) {
  if (!value) return "";
  try {
    return datePart(new Date(value));
  } catch {
    return "";
  }
}

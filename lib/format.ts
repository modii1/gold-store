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

export function formatArabicDateTime(value: string | Date | null | undefined) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString("ar-SA-u-ca-gregory-nu-latn", {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return formatDate(value);
  }
}

export function formatArabicDate(value: string | Date | null | undefined) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return formatDateOnly(value);
  }
}

const OTO_ERROR_TRANSLATIONS: { match: RegExp; arabic: string }[] = [
  { match: /status of the order is not suitable/i, arabic: "حالة الطلب لا تسمح بإنشاء شحنة مرتجع — يجب أن يكون الطلب مُسلَّمًا في OTO أولاً" },
  { match: /already\s*exist/i, arabic: "شحنة مرتجع لهذا الطلب موجودة مسبقاً في OTO" },
  { match: /order\s*not\s*found|invalid\s*order/i, arabic: "الطلب غير موجود في OTO" },
  { match: /delivery\s*option\s*not\s*found|invalid\s*delivery\s*option/i, arabic: "خيار الشحن المرتبط بالطلب غير موجود في OTO" },
  { match: /insufficient\s*balance|no\s*balance|not\s*enough/i, arabic: "رصيد OTO غير كافٍ لإنشاء الشحنة — اشحن رصيدك أولاً" },
  { match: /invalid\s*credentials|unauthorized|token\s*expired/i, arabic: "انتهت صلاحية الاتصال بـ OTO — أعد ربط الحساب من الإعدادات" },
  { match: /customer\s*not\s*found|invalid\s*phone/i, arabic: "بيانات العميل غير موجودة في OTO" },
  { match: /network|timeout|fetch failed/i, arabic: "تعذر الاتصال بخدمة OTO — حاول مرة أخرى" },
];

export function translateOtoError(message: string | null | undefined): string {
  if (!message) return "";
  for (const { match, arabic } of OTO_ERROR_TRANSLATIONS) {
    if (match.test(message)) return arabic;
  }
  return message;
}

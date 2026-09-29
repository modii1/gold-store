import { effectivePrice } from "@/lib/format";

/**
 * G6-B / S6 — مصدر الحقيقة للسعر هو الخادم.
 *
 * هذا الملف نقيّ تمامًا (لا Supabase ولا Request): يستقبل عناصر السلة كما يرسلها
 * المتصفح، ويجلب الأسعار عبر `CatalogLoader` (حاقن من طبقة الإجراء)، ويعيد
 * `{ subtotal, lines, priceSnapshot }`. كل قرار (سعر السطر، الإجمالي، رفض
 * التعارض) هنا حتى لا يوجد منطق تسعير داخل server action ولا يمكن اختباره.
 *
 * قاعدة سعر السطر مطابقة حرفيًا لسلوك الواجهة today
 * (`app/product/[slug]/buy-panel.tsx`):
 *   - سطر بلا متغيّر:            `effectivePrice(product)`  (sale_price > 0 ? sale : price)
 *   - سطر بمتغيّر:               `variant.sale_price ?? variant.price ?? productEffective`
 * الاختلاف المقصود: على الخادم-price يأتي من `products` / `product_variants`
 * في `database`، لا من رقم يرسله العميل.
 */

/** Postgres `numeric` يصل من PostgREST رقمًا أو نصًا حسب السائق. */
type Numeric = number | string | null | undefined;

export type CatalogProduct = { id: string; price: Numeric; sale_price?: Numeric };
export type CatalogVariant = { id: string; product_id: string; price: Numeric; sale_price?: Numeric };

export type CatalogSnapshot = { products: CatalogProduct[]; variants: CatalogVariant[] };

export type CatalogRequest = { productIds: string[]; variantIds: string[] };
export type CatalogLoader = (request: CatalogRequest) => Promise<CatalogSnapshot>;

/** سطر بعد التسعير على الخادم — يصبح الأساس في أي حساسة لاحقة. */
export type PricedLine = {
  product_id: string;
  variant_id: string | null;
  qty: number;
  unit_price: number;
  line_total: number;
};

export type PriceSnapshot = {
  subtotal: number;
  lines: PricedLine[];
};

export type PricingRejection =
  | "empty_cart"
  | "malformed_items"
  | "invalid_qty"
  | "unknown_product"
  | "unknown_variant"
  | "variant_mismatch"
  | "price_unavailable";

export type PricingResult =
  | { ok: true; subtotal: number; lines: PricedLine[]; priceSnapshot: PriceSnapshot }
  | { ok: false; reason: PricingRejection };

export type SubmittedCheckReason = "unpriceable" | "price_mismatch";
export type SubmittedCheck = { ok: true } | { ok: false; reason: SubmittedCheckReason };

/** حد فلس (1 هللة) للسماح لفارق تمثيل الأعداد العشرية فقط. */
export const PRICE_TOLERANCE = 0.01;

/** سقف منطقي لكمية السطر الواحد: يمنع qty ضخمًا مُلفَّقًا بلا معنى. */
export const MAX_QTY_PER_LINE = 999;

/**
 * رسائل العميل. سبب الرفض الداخلي يبقى في السجل فقط؛ ولا تُميَّز الرسالة بين
 * «منتج غير موجود» و«سعر تغيّر» حتى لا يتحوّل التحقق إلى oracle للكتالوج.
 */
export const PRICING_MESSAGES: Record<PricingRejection | SubmittedCheckReason, string> = {
  empty_cart: "السلة فارغة",
  malformed_items: "تعذّر إتمام الطلب. راجعي السلة وأعيدي المحاولة.",
  invalid_qty: "كمية أحد العناصر غير صحيحة. راجعي السلة.",
  unknown_product: "أحد عناصر السلة لم يعد متاحًا. راجعي السلة.",
  unknown_variant: "أحد عناصر السلة لم يعد متاحًا. راجعي السلة.",
  variant_mismatch: "أحد عناصر السلة لم يعد متاحًا. راجعي السلة.",
  price_unavailable: "تعذّر إتمام الطلب. راجعي السلة وأعيدي المحاولة.",
  unpriceable: "تعذّر إتمام الطلب. راجعي السلة وأعيدي المحاولة.",
  price_mismatch: "تغيّرت أسعار أحد المنتجات. راجعي السلة وأعيدي المحاولة.",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function looksLikeUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

/**
 * يحوّل `numeric` إلى رقم موجب صالح، أو null إن كان غير قابل للتسعير.
 * NaN/Infinity/السالب كلها مرفوضة: تسعير صف تالف يجب أن يوقف الطلب لا أن
 * ينتج خصمًا أو إجماليًا سالبًا.
 */
function toMoney(value: Numeric): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** أول قيمة رقمية معرَّفة (تعكس `??` في buy-panel: 0 قيمة صالحة، والسالب مرفوض). */
function firstMoney(...candidates: Numeric[]): number | null {
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || candidate === "") continue;
    return toMoney(candidate);
  }
  return null;
}

/**
 * سعر الوحدة للسطر الواحد من قاعدة البيانات.
 * يعيد null إن كان أي من الشروط غير قابل للتسعير (صف منطوب/محذوف).
 */
export function resolveUnitPrice(
  product: CatalogProduct,
  variant: CatalogVariant | null
): number | null {
  const productPrice = toMoney(product.price);
  if (productPrice === null) return null;

  // نفس helper الواجهة (shared rule) — لا نسخ حرفي.
  const productEffective = effectivePrice({
    price: productPrice,
    sale_price: toMoney(product.sale_price),
  });

  if (!variant) return productEffective;

  const variantSale = firstMoney(variant.sale_price);
  if (variantSale !== null) return variantSale;
  const variantPrice = firstMoney(variant.price);
  if (variantPrice !== null) return variantPrice;
  return productEffective;
}

function parseLine(raw: unknown): { product_id: string; variant_id: string | null; qty: number } | PricingRejection {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "malformed_items";
  const { product_id: rawProductId, variant_id: rawVariantId, qty: rawQty } = raw as {
    product_id?: unknown;
    variant_id?: unknown;
    qty?: unknown;
  };
  if (typeof rawProductId !== "string" || !rawProductId.trim()) return "malformed_items";

  const variantId =
    rawVariantId === null || rawVariantId === undefined || rawVariantId === "" ? null : String(rawVariantId);
  if (variantId !== null && !variantId.trim()) return "malformed_items";

  const qty = typeof rawQty === "number" ? rawQty : Number(rawQty);
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY_PER_LINE) return "invalid_qty";

  return { product_id: rawProductId.trim(), variant_id: variantId?.trim() || null, qty };
}

/**
 * يبني snapshot الأسعار من عناصر السلة + الكتالوج. يفشل مغلقًا (fail-closed):
 * أي عنصر لا يُسعَّر ⇒ لا طلب. لا يوجد مسار يعود فيه إلى رقم العميل.
 */
export async function buildOrderPricing(items: unknown, load: CatalogLoader): Promise<PricingResult> {
  if (!Array.isArray(items) || items.length === 0) return { ok: false, reason: "empty_cart" };

  const parsed: { product_id: string; variant_id: string | null; qty: number }[] = [];
  const productIds = new Set<string>();
  const variantIds = new Set<string>();
  for (const raw of items) {
    const line = parseLine(raw);
    if (typeof line === "string") return { ok: false, reason: line };
    parsed.push(line);
    productIds.add(line.product_id);
    if (line.variant_id) variantIds.add(line.variant_id);
  }

  const catalog = await load({ productIds: [...productIds], variantIds: [...variantIds] });
  const products = new Map((catalog.products || []).map((p) => [String(p.id), p]));
  const variants = new Map((catalog.variants || []).map((v) => [String(v.id), v]));

  const lines: PricedLine[] = [];
  let subtotal = 0;
  for (const line of parsed) {
    const product = products.get(line.product_id);
    if (!product) return { ok: false, reason: "unknown_product" };

    let variant: CatalogVariant | undefined;
    if (line.variant_id) {
      variant = variants.get(line.variant_id);
      if (!variant) return { ok: false, reason: "unknown_variant" };
      if (String(variant.product_id) !== line.product_id) return { ok: false, reason: "variant_mismatch" };
    }

    const unitPrice = resolveUnitPrice(product, variant ?? null);
    if (unitPrice === null) return { ok: false, reason: "price_unavailable" };

    // بلا تقريب: نفس حساب المتصفح بالضبط (price * qty) حتى لا يتجاوز الفارق
    // حد التسامح بسبب التقريب لكل سطر على حدة.
    const lineTotal = unitPrice * line.qty;
    subtotal += lineTotal;
    lines.push({ ...line, unit_price: unitPrice, line_total: lineTotal });
  }

  const priceSnapshot: PriceSnapshot = { subtotal, lines };
  return { ok: true, subtotal, lines, priceSnapshot };
}

/**
 * يقارن الـsubtotal المرسل من العميل بما حسبه الخادم. المرسل **للمقارنة فقط**.
 * NaN يُرفض: `Math.abs(NaN - x) > tol` يُقيَّم false وكان سيمرّ بصمت.
 */
export function verifySubmittedSubtotal(
  submitted: number,
  server: number,
  tolerance: number = PRICE_TOLERANCE
): SubmittedCheck {
  if (!Number.isFinite(submitted) || !Number.isFinite(server)) return { ok: false, reason: "unpriceable" };
  return Math.abs(submitted - server) > tolerance ? { ok: false, reason: "price_mismatch" } : { ok: true };
}

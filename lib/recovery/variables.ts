/**
 * قاموس متغيرات قوالب الاسترجاع (المرحلة 1 من مركز التحكم).
 *
 * ثلاث قواعد لا تُكسر:
 *  1) لا يُرسل رمز متغير أبدًا: أي {{...}} غير معروف أو فارغ يُستبدل
 *     بالبديل الآمن، ويُسجَّل في قائمة unknown/used للمعاينة والتشخيص.
 *  2) المتغيرات الداخلية (discount.*) لا تُرسَل للعميل إطلاقًا في المسار
 *     الافتراضي: تُصيَّر فارغة مع تسجيل تنبيه. السبب: لا يوجد في النظام
 *     أي مسار كوبون، والإعلان عن خصم غير قابل للاستبدال وعد كاذب.
 *     العرض الداخلي (لوحة الإدارة) يمرّر includeInternalOnly=true.
 *  3) لا HTML ولا JavaScript: نصّ عادي يُرسل عبر مسار واتساب القائم.
 *
 * الوحدة خالصة تمامًا: لا Supabase ولا شبكة. قراءة البيانات وربطها
 * بالمصادر (customers/products/orders/settings) مسؤولية الطبقة التي
 * تستدعي buildRecoveryVariables.
 */

import { maskPhone } from "./store";
import { formatCurrency, formatDateOnly, waMeNumber } from "@/lib/format";
import type { RecoveryCase } from "./types";
import type { RecoveryStage } from "./stages";

export type RecoveryVariableGroup =
  | "customer"
  | "cart"
  | "product"
  | "order"
  | "recovery"
  | "message"
  | "store"
  | "links"
  | "dates"
  | "discount";

export type RecoveryVariable = {
  /** اسم المتغير بلا أقواس: "customer.name". */
  name: string;
  group: RecoveryVariableGroup;
  /** اسم عربي للعرض في القاموس. */
  labelAr: string;
  /** شرح عربي: ما هذا ولماذا يُستخدم. */
  descriptionAr: string;
  /** المصدر الحقيقي: جدول.عمود. */
  source: string;
  example: string;
  required: boolean;
  /** البديل الآمن عند غياب القيمة. السلسلة الفارغة = يُحذف الموضع. */
  fallback: string;
  /** داخلي: لا يُرسل للعميل (يُعرض في المعاينة فقط). */
  internalOnly?: boolean;
};

const V = (v: RecoveryVariable): RecoveryVariable => v;

/**
 * القاموس المركزي. كل مدخل مربوط بمصدر حقيقي في قاعدة البيانات
 * (أو بمشتقّ محسوب منه) — لا متغيّر بلا مصدر.
 */
export const RECOVERY_VARIABLES: RecoveryVariable[] = [
  // ---------- العميل ----------
  V({ name: "customer.name", group: "customer", labelAr: "اسم العميل", descriptionAr: "اسم العميل المسجّل كما في حسابه. لا يُطلب من الزائر تحديد هويته.", source: "customers.name", example: "سارة", required: false, fallback: "عميلنا" }),
  V({ name: "customer.phone_masked", group: "customer", labelAr: "الجوال (مخفي)", descriptionAr: "آخر أرقام الجوال فقط — للإدارة، ولا يُرسل كاملًا أبدًا.", source: "recovery_cases.customer_phone", example: "***0646", required: false, fallback: "" }),
  V({ name: "customer.is_registered", group: "customer", labelAr: "له حساب؟", descriptionAr: "نعم إن كانت الحالة مرتبطة بعميل مسجّل؛ لا يُرسل «غير مسجّل» (قد يربك العميل).", source: "recovery_cases.customer_id", example: "نعم", required: false, fallback: "" }),
  V({ name: "customer.email", group: "customer", labelAr: "بريد العميل", descriptionAr: "بريد الحساب إن وُجد. لا يُرسل عبر واتساب.", source: "customers.email", example: "sara@example.com", required: false, fallback: "" }),

  // ---------- السلة ----------
  V({ name: "cart.value", group: "cart", labelAr: "قيمة السلة", descriptionAr: "لقطة قيمة السلة وقت الكشف، تُعرض كقيمة تقريبية لا كسعر نهائي.", source: "recovery_cases.cart_value", example: "349", required: false, fallback: "" }),
  V({ name: "cart.value_formatted", group: "cart", labelAr: "قيمة السلة (منسّقة)", descriptionAr: "قيمة السلة بعملة المتجر.", source: "recovery_cases.cart_value + settings", example: "349 ر.س", required: false, fallback: "" }),
  V({ name: "cart.items_count", group: "cart", labelAr: "عدد منتجات السلة", descriptionAr: "عدد المنتجات المحفوظة في الحالة.", source: "recovery_cases.product_ids", example: "2", required: false, fallback: "" }),

  // ---------- المنتج ----------
  V({ name: "product.name", group: "product", labelAr: "اسم المنتج", descriptionAr: "اسم المنتج المفضّل في السلة.", source: "products.name", example: "حقيبة ميني", required: false, fallback: "قطعتك" }),
  V({ name: "product.slug", group: "product", labelAr: "معرّف المنتج", descriptionAr: "المعرّف النصي للمنتج (يُستخدم في الرابط).", source: "recovery_cases.preferred_product_slug", example: "mini-bag", required: false, fallback: "" }),
  V({ name: "product.price", group: "product", labelAr: "سعر المنتج", descriptionAr: "سعر المنتج في الكتالوج وقت العرض.", source: "products.price", example: "175", required: false, fallback: "" }),
  V({ name: "product.category", group: "product", labelAr: "تصنيف المنتج", descriptionAr: "تصنيف المنتج لتخصيص نبرة الرسالة.", source: "products.category", example: "حقائب", required: false, fallback: "" }),

  // ---------- الطلب ----------
  V({ name: "order.number", group: "order", labelAr: "رقم الطلب", descriptionAr: "رقم الطلب المرتبط بالحالة بعد إغلاقها بالشراء.", source: "orders.order_number", example: "1042", required: false, fallback: "" }),
  V({ name: "order.status", group: "order", labelAr: "حالة الطلب", descriptionAr: "حالة الطلب: pending / paid / delivered / cancelled.", source: "orders.status", example: "paid", required: false, fallback: "" }),
  V({ name: "order.tracking_url", group: "order", labelAr: "رابط التتبّع", descriptionAr: "رابط تتبّع الشحنة إن توفّر. لا يُرسل إن كان الطلب غير مُرسَل.", source: "orders.tracking_url", example: "https://…", required: false, fallback: "" }),

  // ---------- الحالة ----------
  V({ name: "recovery.stage_name", group: "recovery", labelAr: "اسم المرحلة", descriptionAr: "اسم المرحلة الحالية كما هو معرّف في الإعدادات.", source: "recovery_stages.name_ar", example: "تذكير أول", required: false, fallback: "" }),
  V({ name: "recovery.stage_index", group: "recovery", labelAr: "رقم المرحلة", descriptionAr: "ترتيب المرحلة الحالية (يبدأ من 1).", source: "recovery_stages.position", example: "2", required: false, fallback: "" }),
  V({ name: "recovery.stage_total", group: "recovery", labelAr: "عدد المراحل", descriptionAr: "إجمالي مراحل المسار.", source: "count(recovery_stages)", example: "3", required: false, fallback: "" }),
  V({ name: "recovery.hours_since_abandon", group: "recovery", labelAr: "ساعات منذ آخر نشاط", descriptionAr: "كم ساعة مضت على آخر نشاط في السلة.", source: "recovery_cases.last_activity_at", example: "6", required: false, fallback: "" }),
  V({ name: "recovery.next_action_at", group: "recovery", labelAr: "موعد الإجراء التالي", descriptionAr: "متى يُتخذ الإجراء التالي مع هذه الحالة (لو أُرسلت رسالة).", source: "recovery_cases.next_action_at", example: "2026-09-28 18:00", required: false, fallback: "" }),
  V({ name: "recovery.expires_at", group: "recovery", labelAr: "نهاية مهلة الحالة", descriptionAr: "آخر لحظة تُتابَع فيها الحالة قبل الإغلاق التلقائي.", source: "recovery_cases.first_detected_at + expiryHours", example: "2026-10-02 12:00", required: false, fallback: "" }),
  V({ name: "recovery.decision_ar", group: "recovery", labelAr: "القرار بالعربية", descriptionAr: "ترجمة قرار المحرك: تذكير فقط / بلا حافز / مؤهل للخصم.", source: "recovery_cases.decision", example: "تذكير فقط", required: false, fallback: "" }),

  // ---------- الرسائل ----------
  V({ name: "message.is_first", group: "message", labelAr: "أول رسالة؟", descriptionAr: "«نعم» إن لم تُرسل أي رسالة سابقة للحالة.", source: "recovery_cases.message_count", example: "نعم", required: false, fallback: "" }),
  V({ name: "message.count", group: "message", labelAr: "عدد الرسائل السابقة", descriptionAr: "كم رسالة استرجاع سبق إرسالها للحالة.", source: "recovery_cases.message_count", example: "1", required: false, fallback: "" }),
  V({ name: "message.days_since_last", group: "message", labelAr: "أيام منذ آخر رسالة", descriptionAr: "كم يومًا مضى على آخر رسالة للعميل.", source: "recovery_cases.last_message_at", example: "1", required: false, fallback: "" }),

  // ---------- المتجر ----------
  V({ name: "store.name", group: "store", labelAr: "اسم المتجر", descriptionAr: "اسم المتجر كما في الإعدادات.", source: "settings.site_name", example: "لمعة", required: false, fallback: "متجرنا" }),
  V({ name: "store.whatsapp", group: "store", labelAr: "جوال المتجر", descriptionAr: "رقم التواصل الظاهر في المتجر.", source: "settings.whatsapp", example: "+966500000000", required: false, fallback: "" }),
  V({ name: "store.address", group: "store", labelAr: "عنوان المتجر", descriptionAr: "عنوان المتجر كما في الإعدادات.", source: "settings.address", example: "الرياض", required: false, fallback: "" }),

  // ---------- الروابط ----------
  V({ name: "links.cart", group: "links", labelAr: "رابط السلة", descriptionAr: "رابط صفحة السلة في المتجر.", source: "/cart", example: "/cart", required: true, fallback: "/cart" }),
  V({ name: "links.checkout", group: "links", labelAr: "رابط الدفع", descriptionAr: "رابط صفحة إتمام الدفع.", source: "/checkout", example: "/checkout", required: true, fallback: "/cart" }),
  V({ name: "links.product", group: "links", labelAr: "رابط المنتج", descriptionAr: "رابط المنتج المفضّل؛ يعود للسلة إن لم يكن هناك منتج.", source: "/product/{{slug}}", example: "/product/mini-bag", required: false, fallback: "/cart" }),
  V({ name: "links.support", group: "links", labelAr: "رابط تواصل واتساب", descriptionAr: "رابط محادثة مباشرة مع رقم المتجر.", source: "settings.whatsapp → wa.me", example: "https://wa.me/966500000000", required: false, fallback: "" }),

  // ---------- التواريخ ----------
  V({ name: "dates.today", group: "dates", labelAr: "تاريخ اليوم", descriptionAr: "تاريخ عرض الرسالة (yyyy-mm-dd).", source: "التاريخ الحالي", example: "2026-09-28", required: false, fallback: "" }),
  V({ name: "dates.first_detected", group: "dates", labelAr: "تاريخ أول نشاط", descriptionAr: "أول يوم لاحظنا فيه السلة غير المكتملة.", source: "recovery_cases.first_detected_at", example: "2026-09-27", required: false, fallback: "" }),
  V({ name: "dates.last_activity", group: "dates", labelAr: "تاريخ آخر نشاط", descriptionAr: "آخر يوم تفاعل فيه العميل.", source: "recovery_cases.last_activity_at", example: "2026-09-28", required: false, fallback: "" }),

  // ---------- الخصم: داخلي فقط ----------
  V({ name: "discount.percent", group: "discount", labelAr: "نسبة الخصم", descriptionAr: "اقتراح داخلي. لا يوجد مسار كوبون في النظام، فلا يُرسل للعميل ولا يُحتسب.", source: "decisions.discountProposal", example: "10%", required: false, fallback: "", internalOnly: true }),
  V({ name: "discount.value", group: "discount", labelAr: "قيمة الخصم", descriptionAr: "اقتراح داخلي. لا يُرسل للعميل ولا يُحتسب.", source: "decisions.discountProposal", example: "34.90", required: false, fallback: "", internalOnly: true }),
  V({ name: "discount.cap", group: "discount", labelAr: "سقف الخصم", descriptionAr: "السقف الأعلى المسموح به في الاقتراح (للمراجعة الداخلية فقط).", source: "config.maxRecoveryDiscountAmount", example: "50", required: false, fallback: "", internalOnly: true }),
];

/** خريطة سريعة: الاسم ⇒ التعريف. */
const BY_NAME = new Map(RECOVERY_VARIABLES.map((v) => [v.name, v]));

export function findVariable(name: string): RecoveryVariable | null {
  return BY_NAME.get(name) ?? null;
}

/** أسماء المتغيرات مجمّعة بالمجموعة — لبناء العرض في اللوحة. */
export function variablesByGroup(): { group: RecoveryVariableGroup; items: RecoveryVariable[] }[] {
  const groups: RecoveryVariableGroup[] = [
    "customer", "cart", "product", "order", "recovery", "message", "store", "links", "dates", "discount",
  ];
  return groups
    .map((group) => ({ group, items: RECOVERY_VARIABLES.filter((v) => v.group === group) }))
    .filter((g) => g.items.length > 0);
}

// ---------------------------------------------------------------
// التصيير الآمن
// ---------------------------------------------------------------

/** رمز متغير صارم: `{{ اسم }}` بأحرف لاتينية وأرقام وشرطة سفلية ونقطة. */
const TOKEN_RE = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g;

export type RenderOptions = {
  /**
   * تضمين المتغيرات الداخلية (discount.*). الافتراضي false = مسار العميل.
   * لا تُفعّله إلا في المعاينة داخل لوحة الإدارة.
   */
  includeInternalOnly?: boolean;
};

export type TokenUse = {
  name: string;
  /** القيمة النهائية التي ستظهر في الرسالة. */
  rendered: string;
  /** true إن استُخدمت قيمة حقيقية، false إن استُخدم البديل. */
  fromData: boolean;
  internalOnly: boolean;
};

export type RenderResult = {
  text: string;
  /** كل رمز ظهر في القالب بترتيب وروده. */
  used: TokenUse[];
  /** رموز غير معروفة في القاموس. */
  unknown: string[];
  /** متغيرات داخلية حُذفت من النص (internalOnly). */
  blockedInternal: string[];
};

/**
 * تصيير قالب: يستبدل كل رمز بقيمة أو بديل آمن.
 *
 * لا يرمي، ولا يترك أي رمز في الناتج. القيم الفارغة/null/undefined ⇒
 * البديل. المتغير الداخلي ⇒ حذف (فارغ) + تسجيل، إلا إذا طُلب تضمينه.
 */
export function renderTemplate(
  template: string,
  values: Record<string, string | number | null | undefined>,
  options: RenderOptions = {},
): RenderResult {
  const includeInternalOnly = options.includeInternalOnly === true;
  const used: TokenUse[] = [];
  const unknown: string[] = [];
  const blockedInternal: string[] = [];

  const text = String(template ?? "").replace(TOKEN_RE, (_match, rawName: string) => {
    const name = rawName.trim();
    const def = findVariable(name);
    if (!def) {
      unknown.push(name);
      return "";
    }
    const internal = def.internalOnly === true;
    if (internal && !includeInternalOnly) {
      blockedInternal.push(name);
      used.push({ name, rendered: "", fromData: false, internalOnly: true });
      return "";
    }
    const raw = values[name];
    const hasValue = raw !== undefined && raw !== null && String(raw) !== "";
    const rendered = hasValue ? String(raw) : def.fallback;
    used.push({ name, rendered, fromData: hasValue, internalOnly: internal });
    return rendered;
  });

  // تنظيف أخير: أي بقايا `{{...}}` غير صالحة (رموز مشوّهة) لا تصل للعميل
  // أبدًا، ويُنشَر النص منها. ثم إزالة أي قوس متبقٍ لضمان خلوّ الناتج.
  const clean = text.replace(/\{\{[^{}]*\}\}/g, "").replace(/[{}]/g, "");

  return { text: clean, used, unknown, blockedInternal };
}

/** كل الرموز في قالب (بترتيب وروده، بلا تكرار). */
export function listTemplateTokens(template: string): string[] {
  const out: string[] = [];
  const re = new RegExp(TOKEN_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(template ?? ""))) !== null) {
    const name = m[1].trim();
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

export type TemplateValidation = {
  ok: boolean;
  unknown: string[];
  blockedInternal: string[];
  tokens: string[];
};

/**
 * فحص قالب قبل الحفظ: رموز غير معروفة، ورموز داخلية ستُحذف عند الإرسال،
 * ومتغيرات مطلوبة غائبة عن القالب (للتنبيه فقط — لا يمنع الحفظ).
 */
export function validateTemplate(template: string): TemplateValidation {
  const tokens = listTemplateTokens(template);
  const unknown: string[] = [];
  const blockedInternal: string[] = [];
  for (const name of tokens) {
    const def = findVariable(name);
    if (!def) {
      unknown.push(name);
      continue;
    }
    if (def.internalOnly) blockedInternal.push(name);
  }
  return { ok: unknown.length === 0, unknown, blockedInternal, tokens };
}

// ---------------------------------------------------------------
// بناء القيم من حالة واحدة (خالص — بلا استعلامات)
// ---------------------------------------------------------------

/** مصادر اختيارية تُدمج من جداول أخرى عند توفّرها. */
export type RecoveryVariableSources = {
  customer?: { name?: string | null; email?: string | null } | null;
  product?: { name?: string | null; price?: number | null; category?: string | null } | null;
  order?: { number?: number | string | null; status?: string | null; trackingUrl?: string | null } | null;
  store?: { name?: string | null; whatsapp?: string | null; address?: string | null } | null;
};

export type RecoveryVariableInput = {
  case: RecoveryCase;
  stage?: RecoveryStage | null;
  stageIndex?: number | null;
  stageTotal?: number | null;
  discount?: { percent: number; value: number; cap: number } | null;
  sources?: RecoveryVariableSources;
  now?: number;
  expiryHours?: number;
  decisionAr?: string | null;
};

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const HOURS = (n: number): string => String(Math.max(0, Math.floor(n)));

/**
 * بناء خريطة قيم من حالة الاسترجاع + مصادرها.
 *
 * القيم الفارغة تُترك للمصنّف (تُملأ قيمة فارغة) فيستبدلها
 * renderTemplate بالبديل الآمن. لا نخمّن ولا نخترع أرقامًا.
 */
export function buildRecoveryVariables(input: RecoveryVariableInput): Record<string, string> {
  const c = input.case;
  const now = input.now ?? Date.now();
  const stage = input.stage ?? null;
  const sources = input.sources ?? {};
  const discount = input.discount ?? null;

  const productSlug = c.preferredProductSlug ?? "";
  const waNumber = sources.store?.whatsapp ? waMeNumber(sources.store.whatsapp) : null;

  return {
    "customer.name": sources.customer?.name ?? "",
    "customer.phone_masked": maskPhone(c.customerPhone) ?? "",
    "customer.is_registered": c.customerId ? "نعم" : "",
    "customer.email": sources.customer?.email ?? "",

    "cart.value": c.cartValue === null ? "" : String(c.cartValue),
    "cart.value_formatted": c.cartValue === null ? "" : formatCurrency(c.cartValue),
    "cart.items_count": String(c.productIds.length),

    "product.name": sources.product?.name ?? productSlug,
    "product.slug": productSlug,
    "product.price":
      sources.product?.price === null || sources.product?.price === undefined ? "" : String(sources.product.price),
    "product.category": sources.product?.category ?? "",

    "order.number": sources.order?.number === null || sources.order?.number === undefined ? "" : String(sources.order.number),
    "order.status": sources.order?.status ?? "",
    "order.tracking_url": sources.order?.trackingUrl ?? "",

    "recovery.stage_name": stage?.nameAr ?? "",
    "recovery.stage_index": input.stageIndex === null || input.stageIndex === undefined ? "" : String(input.stageIndex),
    "recovery.stage_total": input.stageTotal === null || input.stageTotal === undefined ? "" : String(input.stageTotal),
    "recovery.hours_since_abandon": HOURS((now - c.lastActivityAt) / HOUR_MS),
    "recovery.next_action_at": c.nextActionAt ? formatDateOnly(new Date(c.nextActionAt)) : "",
    "recovery.expires_at": c.firstDetectedAt ? formatDateOnly(new Date(c.firstDetectedAt + (input.expiryHours ?? 0) * HOUR_MS)) : "",
    "recovery.decision_ar": input.decisionAr ?? "",

    "message.is_first": c.messageCount === 0 ? "نعم" : "",
    "message.count": String(c.messageCount),
    "message.days_since_last": c.lastMessageAt ? String(Math.max(0, Math.floor((now - c.lastMessageAt) / DAY_MS))) : "",

    "store.name": sources.store?.name ?? "",
    "store.whatsapp": sources.store?.whatsapp ?? "",
    "store.address": sources.store?.address ?? "",

    "links.cart": "/cart",
    "links.checkout": "/checkout",
    "links.product": productSlug ? `/product/${productSlug}` : "",
    "links.support": waNumber ? `https://wa.me/${waNumber}` : "",

    "dates.today": formatDateOnly(new Date(now)),
    "dates.first_detected": c.firstDetectedAt ? formatDateOnly(new Date(c.firstDetectedAt)) : "",
    "dates.last_activity": c.lastActivityAt ? formatDateOnly(new Date(c.lastActivityAt)) : "",

    "discount.percent": discount ? `${discount.percent}%` : "",
    "discount.value": discount ? String(discount.value) : "",
    "discount.cap": discount ? String(discount.cap) : "",
  };
}

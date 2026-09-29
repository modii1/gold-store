/**
 * Coupon policy — pure logic only (no DB, no I/O, no side effects).
 *
 * لماذا هذا الملف منفصل عن app/actions/*: ملفات "use server" لا تصدّر إلا
 * دوال async، فالمنطق القابل للاختبار لا مكان له هناك. كل ما هنا يُستدعى
 * من الـactions ويُختبر بلا أي اتصال بقاعدة البيانات.
 *
 * قواعد ثابتة (G6-A):
 *  - رسالة الرفض الخارجية واحدة لكل الأسباب ⇒ لا يتحوّل التحقق إلى oracle
 *    لكشف وجود الكود أو حالته (كود غير موجود / غير فعال / لم يبدأ / منتهي /
 *    مستهلك / تحت الحد الأدنى / مربوط بعميل آخر).
 *  - السبب التفصيلي يبقى داخليًا فقط، ولا يُسجَّل معه الكود (الكود سر).
 *
 * G6-C: القسيمة المربوطة بعميل (Recovery) لها قيود تمثَّل في صفها نفسه:
 *  - `customer_identifier` = المالك الوحيد؛ أي جوال آخر يُرفض.
 *  - `max_discount` = سقف مبلغ الخصم (null = بلا سقف) — تمثيل صريح لسياسة
 *    سقف الاسترجاع بدل الاعتماد على نسبة مئوية وحدها.
 */

import { normalizePhoneInternational } from "@/lib/format";

/** الرسالة الوحيدة التي يرىها العميل لأي رفض. */
export const COUPON_REJECT_MESSAGE = "كود الخصم غير صالح أو لم يعد متاحًا.";

/** رسالة الإدخال الفارغ (ليست oracle: لا كود أصلًا). */
export const COUPON_EMPTY_MESSAGE = "أدخلي كود الخصم";

export type CouponRejectReason =
  | "empty"
  | "not_found"
  | "inactive"
  | "not_started"
  | "expired"
  | "exhausted"
  | "min_order"
  /** G6-C: القسيمة مربوطة بجوال عميلآخر — نفس الرسالة الخارجية دائمًا. */
  | "wrong_customer";

export type CouponRecord = {
  code: string;
  type: "percent" | "fixed";
  value: number | string | null;
  min_order: number | string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  usage_limit?: number | string | null;
  used_count?: number | string | null;
  is_active?: boolean | null;
  /** G6-C: سقف مبلغ الخصم (null/غير موجود = بلا سقف). */
  max_discount?: number | string | null;
  /** G6-C: معرّف المالك الوحيد للجوال (لا يُملأ إلا من الخادم). */
  customer_identifier?: string | null;
  /** G6-C: معرّف حالة الاسترجاع (uuid) عند قسيمة الاسترجاع. */
  recovery_case_id?: string | null;
  /** G6-C: نطاق الاستخدام. */
  scope?: string | null;
  /** G6-C: مصدر الإنشاء. */
  source?: string | null;
  /** G6-C: معرّف الصف (uuid) — لا يُستخدم إلا للتحقق الذاتي داخل الخادم. */
  id?: string | null;
};

/** كائن الصف كما قد تقرؤه المخازن — حقول G6-C اختيارية (migration لم تُنفَّذ). */
export type BoundCouponRecord = CouponRecord;

export type CouponEvaluation =
  | { ok: true; discount: number }
  | { ok: false; reason: CouponRejectReason };

/**
 * الصيغة المرجعية للكود: أحرف كبيرة بلا فراغات (نفس ما كانت تحفظه لوحة
 * الإدارة). يُطبَّق على الإدخال قبل البحث في orders وcoupons معًا حتى تتصرف
 * ‎gold10 وGOLD10 و Gold10 ‎بالمثل، ويبقى الشكل المخزَّن واحدًا.
 */
export function normalizeCouponCode(raw: string | null | undefined): string {
  return String(raw ?? "").trim().toUpperCase();
}

/** numeric من Postgres قد يعود نصًّا: نحوّله مرة واحدة عند الحد. */
function num(value: unknown): number {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : 0;
}

function time(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * قيمة الخصم: نسبة من السلة أو مبلغ ثابت، ولا تتجاوز قيمة السلة أبدًا،
 * ولا تتجاوز `max_discount` إن وُجد. المصدر الوحيد للرقم — تُستخدم في
 * المعاينة وفي إنشاء الطلب وفي حساب redeem وفي `computedDiscount` داخل
 * Recovery، ولذلك السقف يُطبَّق هنا بالشكل نفسه هناك: `0` سقف حقيقي ⇒
 * خصم صفر (لا يُقرأ كـ«بلا سقف»)، وقيمة تالفة ⇒ صفر (fail-closed).
 */
export function discountForCoupon(
  coupon: Pick<CouponRecord, "type" | "value"> & { max_discount?: number | string | null },
  subtotal: number
): number {
  const base = Number.isFinite(subtotal) && subtotal > 0 ? subtotal : 0;
  const value = num(coupon.value);
  if (value <= 0 || base <= 0) return 0;
  const raw = coupon.type === "fixed" ? value : (base * value) / 100;
  const hasCap = coupon.max_discount !== null && coupon.max_discount !== undefined;
  const limited = hasCap ? Math.min(raw, Math.max(0, num(coupon.max_discount))) : raw;
  return Math.max(0, Math.min(limited, base));
}

/**
 * G6-C: هل هذه القسيمة لهذا العميل؟
 *
 * القاعدة: القسيمة بلا `customer_identifier` عامة (سلوك G6-A كما هو)،
 * والمربوطة تُستخدم بمالكها وحده. المقارنة بعد تطبيع الجوال في الطرفين،
 * وعند تعذّر تطبيع أحدهما ⇒ رفض (لا نخمّن أن رقمين متشابهين).
 */
export function couponBelongsToCustomer(
  coupon: Pick<CouponRecord, "customer_identifier">,
  customerIdentifier: string | null | undefined
): boolean {
  const owner = String(coupon.customer_identifier ?? "").trim();
  if (!owner) return true; // قسيمة عامة: لا binding
  const requester = String(customerIdentifier ?? "").trim();
  if (!requester) return false;
  const a = normalizePhoneInternational(owner);
  const b = normalizePhoneInternational(requester);
  // التطبيع فشل لأحد الطرفين ⇒ لا إثبات للملكية ⇒ رفض.
  if (a === null || b === null) return owner === requester;
  return a === b;
}

/**
 * فحص الكود عند لحظة معيّنة. ترتيب الفحوص لا يُكشف (كل الأسباب تُقرأ
 * خارجيًا كرسالة واحدة)، لكنه منطقي: التفعيل قبل الصلاحية قبل الاستهلاك.
 * `now < starts_at` ⇒ لم يبدأ بعد (كان عمودًا مهملًا قبل G6-A).
 *
 * `customerIdentifier` مطلوب فقط للقسائم المربوطة؛ تمريره صريح لا استنتاج.
 */
export function evaluateCoupon(
  coupon: CouponRecord,
  input: { now: number; subtotal: number; customerIdentifier?: string | null }
): CouponEvaluation {
  if (!coupon.is_active) return { ok: false, reason: "inactive" };

  const startsAt = time(coupon.starts_at);
  if (startsAt !== null && input.now < startsAt) return { ok: false, reason: "not_started" };

  const endsAt = time(coupon.ends_at);
  if (endsAt !== null && input.now >= endsAt) return { ok: false, reason: "expired" };

  const limit = coupon.usage_limit === null || coupon.usage_limit === undefined ? null : num(coupon.usage_limit);
  if (limit !== null && num(coupon.used_count) >= limit) return { ok: false, reason: "exhausted" };

  const minOrder = num(coupon.min_order);
  if (minOrder > 0 && input.subtotal < minOrder) return { ok: false, reason: "min_order" };

  // G6-C: بعد كل فحوص generality (حتى لا تكشف رسالة الرفض أي شرط سبقه).
  if (!couponBelongsToCustomer(coupon, input.customerIdentifier)) {
    return { ok: false, reason: "wrong_customer" };
  }

  return { ok: true, discount: discountForCoupon(coupon, input.subtotal) };
}

/**
 * الرسالة الخارجية لأي سبب رفض — بلا استثناء. نقطة واحدة تُراجَع قبل أي
 * إضافة: أي تمييز بين الأسباب هنا يعيد التحقق إلى دور oracle يكشف وجود
 * الكود وحالته.
 */
export function couponRejectMessage(): string {
  return COUPON_REJECT_MESSAGE;
}

/**
 * الرسائل الخارجية واحدة لكل الأسباب (انظر `couponRejectMessage`). هذا
 * التحويل للسبب **الداخلي** فقط — للسجلّات والعدّادات، لا للعرض للعميل.
 */
export type InternalRejectReason = "missing" | "unavailable" | "exhausted" | "wrong_customer";

export function internalRejectReason(reason: CouponRejectReason): InternalRejectReason {
  switch (reason) {
    case "empty":
    case "not_found":
      return "missing";
    case "exhausted":
      return "exhausted";
    case "wrong_customer":
      return "wrong_customer";
    default:
      return "unavailable";
  }
}

/** التواريخ في لوحة الإدارة */

/**
 * توقيت المتجر: السعودية (الرياض) = UTC+3 بدون تغيير صيفي. لا يوجد إعداد
 * timezone في المشروع، لكن كل بيانات المتجر سعودية (OTO/Bureaud origin = Riyadh،
 * عناوين سعودية، جوالات 9665)، فالسلوك المقصود لتاريخ الانتهاء هو نهاية اليوم
 * بتوقيت المتجر لا منتصف ليل UTC.
 */
export const STORE_TIMEZONE_OFFSET_MINUTES = 180;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function offsetIso(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}

/**
 * تاريخ «input type=date» = "2026-09-30" يعني عند المستخدم «صالح حتى آخر هذا
 * اليوم». قبل G6-A كان يُخزَّن كمنتصف ليل UTC فينتهي الكود عند 00:00 من نفس
 * اليوم (يوم كامل أبكر). نحوّله إلى 23:59:59 بتوقيت المتجر.
 * أي قيمة contain وقتًا (ISO كامل) تمرّ كما هي — لا نلمس ما قد يكتبه Recovery.
 */
export function adminEndsAtIso(
  raw: string | null | undefined,
  offsetMinutes: number = STORE_TIMEZONE_OFFSET_MINUTES
): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  if (DATE_ONLY.test(value)) return `${value}T23:59:59${offsetIso(offsetMinutes)}`;
  return value;
}

/** نظيرها لبداية اليوم (يُستعمل لـ starts_at إن أُضيف للواجهة لاحقًا). */
export function adminStartsAtIso(
  raw: string | null | undefined,
  offsetMinutes: number = STORE_TIMEZONE_OFFSET_MINUTES
): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  if (DATE_ONLY.test(value)) return `${value}T00:00:00${offsetIso(offsetMinutes)}`;
  return value;
}

/**
 * G6-C — استبدال قسيمة عند إنشاء الطلب.
 *
 * القواعد التي لا تُكسر هنا:
 *  1) لا استبدال قبل وجود طلب. الطلب يُنشأ أولًا (الخادم يحسب المجموع)،
 *     ثم يُستبدل القسيمة. فشل الاستبدال = طلب بلا خصم (صحيح وآمن)، لا طلب
 *     بخصم غير مثبَّت.
 *  2) الاستبدال ذرّي: `redeem_coupon` (SECURITY DEFINER + `FOR UPDATE` +
 *     `search_path` مثبّت) يقرأ ويقيّد ويزيد `used_count` في معاملة واحدة.
 *     `service_role` وحده يأخذ إذن التنفيذ؛ لا anon ولا authenticated.
 *  3) إن لم تكن الدالة موجودة (migration لم تُنفَّذ بعد) نستخدم CAS الموجود
 *     في `./usage` — وهو يمنع lost update لكنه **ليس** ذرّيًا مع
 *     insert الطلب. لذلك يُعلَن الفشل صراحةً ولا يُعاد ولا يُخفى.
 *  4) كل الفحوص (الصلاحية، السقف، الحد الأدنى، ملكية العميل) تُعاد داخل
 *     الدالة من صف القسيمة نفسه — لا قيم يمررها العميل ولا حساب التطبيق.
 *
 * الوحدة خالصة: منطق القرار والاتصال بواجهة `CouponRedeemStore`.
 */

import {
  discountForCoupon,
  evaluateCoupon,
  internalRejectReason,
  normalizeCouponCode,
} from "./policy";
import type { BoundCouponRecord } from "./policy";
import { incrementCouponUsage } from "./usage";
import type { CouponUsageStore } from "./usage";

export type CouponRedeemResult =
  | { ok: true; discount: number; mode: "atomic" | "cas" }
  | { ok: false; reason: RedeemRejectReason; mode: "none" };

export type RedeemRejectReason =
  | "missing"
  | "invalid"
  | "unavailable"
  | "wrong_customer"
  | "exhausted";

/** نتيجة الدالة الذرّية في القاعدة. */
export type AtomicRedeemRow = {
  id: string;
  code: string;
  type: "percent" | "fixed";
  value: number | string | null;
  max_discount: number | string | null;
  min_order: number | string | null;
  starts_at: string | null;
  ends_at: string | null;
  usage_limit: number | string | null;
  used_count: number | string | null;
  is_active: boolean;
  customer_identifier: string | null;
};

export type CouponRedeemStore = {
  /** هل دالة `redeem_coupon` موجودة؟ (تُفحص مرة واحدة لكل عملية) */
  atomicAvailable(): Promise<boolean>;
  /** استبدال ذرّي: يفحص ويزيد في معاملة واحدة ويعيد الصف أو سبب الرفض. */
  redeemAtomic(input: {
    code: string;
    subtotal: number;
    customerIdentifier: string;
    now: number;
  }): Promise<{ ok: true; row: AtomicRedeemRow } | { ok: false; reason: RedeemRejectReason }>;
  /** قراءة الصف للفحص المسبق ولبناء قيمة الخصم محليًا. */
  readByCode(code: string): Promise<BoundCouponRecord | null>;
  /** مسار CAS الاحتياطي (نفس counter المستخدم في checkout الحالي). */
  usage: CouponUsageStore;
};

/**
 * استبدال القسيمة بعد إنشاء الطلب.
 *
 * `now` يُمرَّر من الراوت (بلا وقت نظام داخل الوحدة) ليبقى المسار حتميًا
 * في الاختبار، ولأن `redeem_coupon` تستخدم معاملًا صريحًا.
 */
export async function redeemCouponForOrder(
  store: CouponRedeemStore,
  input: {
    code: string | null | undefined;
    subtotal: number;
    /** معرّف العميل المشتق من الخادم (جلسة أو جوال مُطبَّع). */
    customerIdentifier: string | null | undefined;
    now: number;
  }
): Promise<CouponRedeemResult> {
  const code = normalizeCouponCode(input.code ?? "");
  if (!code) return { ok: false, reason: "missing", mode: "none" };

  const identifier = String(input.customerIdentifier ?? "").trim();
  if (!identifier) return { ok: false, reason: "wrong_customer", mode: "none" };

  // 1) المسار الذرّي إن كان migration مطبَّقًا.
  if (await store.atomicAvailable()) {
    const res = await store.redeemAtomic({
      code,
      subtotal: input.subtotal,
      customerIdentifier: identifier,
      now: input.now,
    });
    if (!res.ok) return { ok: false, reason: res.reason, mode: "none" };
    return { ok: true, discount: discountForCoupon(res.row, input.subtotal), mode: "atomic" };
  }

  // 2) الاحتياطي: فحص كامل في التطبيق ثم CAS. غير ذرّي عبر حدّ الطلب،
  //    وموسوم بوضوح في النتيجة.
  const row = await store.readByCode(code);
  if (!row) return { ok: false, reason: "missing", mode: "none" };
  const check = evaluateCoupon(row, {
    now: input.now,
    subtotal: input.subtotal,
    customerIdentifier: identifier,
  });
  if (!check.ok) {
    return { ok: false, reason: internalRejectReason(check.reason), mode: "none" };
  }
  const outcome = await incrementCouponUsage(store.usage, code);
  switch (outcome) {
    case "incremented":
      return { ok: true, discount: check.discount, mode: "cas" };
    case "exhausted":
      return { ok: false, reason: "exhausted", mode: "none" };
    case "raced":
      // سباق لم يُحسم بعد ⇒ لا خصم (لا وعد غير مثبَّت).
      return { ok: false, reason: "invalid", mode: "none" };
    default:
      return { ok: false, reason: "missing", mode: "none" };
  }
}

/** فحص مالك مُعاد استخدامه في مراجعة الكود — يبقى مربوطًا بملف واحد. */
export { discountForCoupon, internalRejectReason };

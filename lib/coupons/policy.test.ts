import { describe, expect, it } from "vitest";
import {
  COUPON_EMPTY_MESSAGE,
  COUPON_REJECT_MESSAGE,
  adminEndsAtIso,
  adminStartsAtIso,
  couponRejectMessage,
  discountForCoupon,
  evaluateCoupon,
  normalizeCouponCode,
  type CouponRecord,
} from "./policy";
// G6-C: نتحقق أن حساب العرض داخل Recovery يطابق حساب checkout، فالمقارنة
// تحتاج الطرف الآخر — وهو مصدر الحقيقة الوحيد (`discountForCoupon`).
import { computedDiscount } from "@/lib/recovery/incentive";

const NOW = Date.UTC(2026, 8, 15, 12, 0, 0);
const HOUR = 3600_000;

function coupon(over: Partial<CouponRecord> = {}): CouponRecord {
  return {
    code: "GOLD10",
    type: "percent",
    value: 10,
    min_order: 0,
    starts_at: null,
    ends_at: null,
    usage_limit: null,
    used_count: 0,
    is_active: true,
    ...over,
  };
}

const evaluate = (c: CouponRecord, subtotal = 500) => evaluateCoupon(c, { now: NOW, subtotal });

describe("normalizeCouponCode — gold10 / GOLD10 / Gold10", () => {
  it("trim + uppercase لكل صيغ الحروف", () => {
    expect(normalizeCouponCode("gold10")).toBe("GOLD10");
    expect(normalizeCouponCode("GOLD10")).toBe("GOLD10");
    expect(normalizeCouponCode("Gold10")).toBe("GOLD10");
    expect(normalizeCouponCode("  gold10  ")).toBe("GOLD10");
  });

  it("فارغ/غير موجود ⇒ سلسلة فارغة (لا استثناء)", () => {
    expect(normalizeCouponCode("")).toBe("");
    expect(normalizeCouponCode("   ")).toBe("");
    expect(normalizeCouponCode(null)).toBe("");
    expect(normalizeCouponCode(undefined)).toBe("");
  });
});

describe("evaluateCoupon — التحقق (G6-A)", () => {
  it("كود صالح ⇒ مسموح مع الخصم المحسوب", () => {
    const r = evaluate(coupon(), 500);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.discount).toBe(50);
  });

  it("inactive ⇒ مرفوض", () => {
    expect(evaluate(coupon({ is_active: false }))).toEqual({ ok: false, reason: "inactive" });
  });

  it("starts_at مستقبلي ⇒ مرفوض (كان عمودًا مهملًا)", () => {
    const r = evaluate(coupon({ starts_at: new Date(NOW + HOUR).toISOString() }));
    expect(r).toEqual({ ok: false, reason: "not_started" });
  });

  it("starts_at = الآن ⇒ مسموح (الحد مت inclusi)", () => {
    expect(evaluate(coupon({ starts_at: new Date(NOW).toISOString() })).ok).toBe(true);
  });

  it("starts_at في الماضي ⇒ مسموح (سلوك سابق محفوظ)", () => {
    expect(evaluate(coupon({ starts_at: new Date(NOW - HOUR).toISOString() })).ok).toBe(true);
  });

  it("starts_at null ⇒ يُتجاهل السلوك الحالي (سلوك قديم محفوظ)", () => {
    const r = evaluate(coupon({ starts_at: null }));
    expect(r.ok).toBe(true);
  });

  it("ends_at ماضٍ ⇒ مرفوض", () => {
    const r = evaluate(coupon({ ends_at: new Date(NOW - 1000).toISOString() }));
    expect(r).toEqual({ ok: false, reason: "expired" });
  });

  it("ends_at مستقبلي ⇒ مسموح", () => {
    expect(evaluate(coupon({ ends_at: new Date(NOW + HOUR).toISOString() })).ok).toBe(true);
  });

  it("ends_at = الآن ⇒ منتهٍ (نفس دلالة «< new Date()» القديمة)", () => {
    expect(evaluate(coupon({ ends_at: new Date(NOW).toISOString() }))).toEqual({ ok: false, reason: "expired" });
  });

  it("usage_limit مستنفد ⇒ مرفوض", () => {
    const r = evaluate(coupon({ usage_limit: 1, used_count: 1 }));
    expect(r).toEqual({ ok: false, reason: "exhausted" });
  });

  it("usage_limit = null ⇒ غير محدود (سلوك قديم محفوظ)", () => {
    expect(evaluate(coupon({ usage_limit: null, used_count: 999 })).ok).toBe(true);
  });

  it("تحت الحد الأدنى ⇒ مرفوض", () => {
    expect(evaluate(coupon({ min_order: 200 }), 150)).toEqual({ ok: false, reason: "min_order" });
  });

  it("عند الحد الأدنى بالضبط ⇒ مسموح", () => {
    expect(evaluate(coupon({ min_order: 200 }), 200).ok).toBe(true);
  });

  it("min_order = 0 ⇒ لا فحص (سلوك قديم محفوظ)", () => {
    expect(evaluate(coupon({ min_order: 0 }), 1).ok).toBe(true);
  });

  it("أولوية الرفض: غير فعال يسبق منتهيًا ومستهلكًا (شروط مستقلة)", () => {
    const r = evaluate(coupon({ is_active: false, ends_at: new Date(NOW - HOUR).toISOString(), usage_limit: 1, used_count: 5 }));
    expect(r).toEqual({ ok: false, reason: "inactive" });
  });
});

describe("رسالة الرفض الخارجية الموحدة (S4)", () => {
  it("كل رفض فعلي في الكوبون ينتج نفس الرسالة بلا استثناء", () => {
    const rejected: CouponRecord[] = [
      coupon({ is_active: false }),
      coupon({ starts_at: new Date(NOW + HOUR).toISOString() }),
      coupon({ ends_at: new Date(NOW - HOUR).toISOString() }),
      coupon({ usage_limit: 1, used_count: 1 }),
      coupon({ min_order: 5000 }),
    ];
    const messages = rejected.map((c) => {
      const r = evaluate(c, 100);
      expect(r.ok).toBe(false);
      return couponRejectMessage();
    });
    // كل سبب رفض فعلي (not_found لا وجود صف له أصلًا) يُقرأ خارجيًا بالنص نفسه.
    expect(new Set(messages).size).toBe(1);
    expect(messages[0]).toBe(COUPON_REJECT_MESSAGE);
  });

  it("الرسالة الموحدة لا تحوي أي تفصيل حسّاس", () => {
    expect(COUPON_REJECT_MESSAGE).not.toMatch(/الحد الأدنى|منتهي|غير فعال|استُهلك/);
    expect(COUPON_REJECT_MESSAGE).toBe("كود الخصم غير صالح أو لم يعد متاحًا.");
  });

  it("رسالة الإدخال الفارغ منفصلة ولا تكشف شيئًا", () => {
    expect(COUPON_EMPTY_MESSAGE).toBe("أدخلي كود الخصم");
  });
});

describe("discountForCoupon — حساب الخصم", () => {
  it("نسبة: 10% من 500 = 50", () => {
    expect(discountForCoupon({ type: "percent", value: 10 }, 500)).toBe(50);
  });

  it("مبلغ ثابت: 50 من 500 = 50", () => {
    expect(discountForCoupon({ type: "fixed", value: 50 }, 500)).toBe(50);
  });

  it("لا يتجاوز قيمة السلة أبدًا (fixed أكبر من السلة)", () => {
    expect(discountForCoupon({ type: "fixed", value: 900 }, 500)).toBe(500);
  });

  it("لا يتجاوز قيمة السلة أبدًا (نسبة تعطي أكثر من السلة)", () => {
    expect(discountForCoupon({ type: "percent", value: 150 }, 500)).toBe(500);
  });

  it("لا خصم سالب ولا NaN لقيم تالفة أو سلة صفرية", () => {
    expect(discountForCoupon({ type: "fixed", value: -10 }, 500)).toBe(0);
    expect(discountForCoupon({ type: "percent", value: null }, 500)).toBe(0);
    expect(discountForCoupon({ type: "percent", value: 10 }, 0)).toBe(0);
    expect(Number.isFinite(discountForCoupon({ type: "percent", value: "10" }, 500))).toBe(true);
  });

  it("numeric القادم من Postgres كنص يُحسب صحيحًا", () => {
    expect(discountForCoupon({ type: "fixed", value: "50" }, 500)).toBe(50);
    expect(discountForCoupon({ type: "percent", value: "10" }, 900)).toBe(90);
  });

  it("G6-C: max_discount سقف حقيقي — null بلا سقف، والقيمة تُقصّ", () => {
    // null (قبل G6-C) = بلا سقف: السلوك القديم محفوظ.
    expect(discountForCoupon({ type: "percent", value: 10, max_discount: null }, 1000)).toBe(100);
    expect(discountForCoupon({ type: "percent", value: 10 }, 1000)).toBe(100);
    // 10% من 1000 = 100 ⇒ يُقصّ إلى 50.
    expect(discountForCoupon({ type: "percent", value: 10, max_discount: 50 }, 1000)).toBe(50);
    // السقف الأكبر من الخام لا يرفع شيئًا.
    expect(discountForCoupon({ type: "percent", value: 10, max_discount: 500 }, 1000)).toBe(100);
    // fixed أيضًا.
    expect(discountForCoupon({ type: "fixed", value: 200, max_discount: 50 }, 1000)).toBe(50);
  });

  it("G6-C: max_discount = 0 يعني خصمًا صفرًا لا «بلا سقف»", () => {
    // قسمة على صفر: 0 كسقف ⇒ min(100, 0) = 0. الخلط بين 0 و null كان
    // يجعل recovery يعرض قيمة ويطبّق checkout قيمة أخرى.
    expect(discountForCoupon({ type: "percent", value: 10, max_discount: 0 }, 1000)).toBe(0);
    expect(discountForCoupon({ type: "fixed", value: 50, max_discount: 0 }, 500)).toBe(0);
    // قيمة تالفة ⇒ صفر (fail-closed)، لا خصم مفتوح.
    expect(discountForCoupon({ type: "percent", value: 10, max_discount: "abc" }, 1000)).toBe(0);
    expect(discountForCoupon({ type: "percent", value: 10, max_discount: -5 }, 1000)).toBe(0);
  });

  it("G6-C: نفس الحساب داخل Recovery يطابق checkout بالضبط", () => {
    // مصدر الحقيقة واحد: أي اختلاف بينهما يظهر كخصم يُعلن في الرسالة ولا
    // يُطبَّق في الطلب.
    const row: CouponRecord = {
      code: "R50",
      type: "percent",
      value: 10,
      min_order: 100,
      starts_at: null,
      ends_at: null,
      usage_limit: 1,
      used_count: 0,
      is_active: true,
      max_discount: 50,
    };
    const cap = typeof row.max_discount === "number" ? row.max_discount : null;
    expect(computedDiscount(Number(row.value), 1000, cap)).toBe(discountForCoupon(row, 1000));
    expect(computedDiscount(Number(row.value), 300, cap)).toBe(discountForCoupon(row, 300));
    expect(computedDiscount(Number(row.value), 1000, 0)).toBe(discountForCoupon({ ...row, max_discount: 0 }, 1000));
  });
});

describe("لوحة الإدارة — نهاية اليوم بدل منتصف ليل UTC (S9)", () => {
  it("ends_at تاريخ فقط ⇒ 23:59:59 بتوقيت المتجر (+03:00)", () => {
    expect(adminEndsAtIso("2026-09-30")).toBe("2026-09-30T23:59:59+03:00");
  });

  it("قيمة فيها وقت تمرّ كما هي (لا نلمس طوابع ISO مثل ما قد يكتبه Recovery)", () => {
    expect(adminEndsAtIso("2026-09-30T21:00:00.000Z")).toBe("2026-09-30T21:00:00.000Z");
  });

  it("فارغ ⇒ null (بلا صلاحية)", () => {
    expect(adminEndsAtIso("")).toBeNull();
    expect(adminEndsAtIso(null)).toBeNull();
    expect(adminEndsAtIso("   ")).toBeNull();
  });

  it("الإزاحة قابلة للتخصيص (اختبار بحالة أخرى)", () => {
    expect(adminEndsAtIso("2026-09-30", -300)).toBe("2026-09-30T23:59:59-05:00");
  });

  it("starts_at تاريخ فقط ⇒ بداية اليوم بنفس الإزاحة", () => {
    expect(adminStartsAtIso("2026-09-30")).toBe("2026-09-30T00:00:00+03:00");
    expect(adminStartsAtIso("")).toBeNull();
  });

  it("النتيجة تبقى داخل اليوم المقصود عند العرض (.slice(0,10))", () => {
    // Postgres يُعيد timestamptz بتوقيت UTC: 2026-09-30T20:59:59+00:00
    const asUtc = new Date(adminEndsAtIso("2026-09-30")!).toISOString();
    expect(asUtc.slice(0, 10)).toBe("2026-09-30");
  });

  it("كوبون ساعة واحدة: صالح الآن وغير صالح بعده بالضبط", () => {
    const endsAt = new Date(NOW + HOUR).toISOString();
    expect(evaluate(coupon({ ends_at: endsAt }), 500).ok).toBe(true);
    expect(evaluate(coupon({ ends_at: endsAt }), 500).ok).toBe(true);
    const later = evaluateCoupon(coupon({ ends_at: endsAt }), { now: NOW + HOUR, subtotal: 500 });
    expect(later.ok).toBe(false);
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  COUPON_CODE_ALPHABET,
  couponCodeEntropyBits,
  DEFAULT_CODE_LENGTH,
  generateCouponCode,
  isGeneratedCouponCodeFormat,
  MIN_CODE_LENGTH,
  randomCouponCode,
  type RandomBytes,
} from "@/lib/coupons/code";
import { normalizeCouponCode } from "@/lib/coupons/policy";

/** مصدر بايتات حتمي للاختبار: كل القيم 0 ⇒ ينتج '2' دائمًا (حرف منخفض من الألبجدية). */
const fixedBytes: RandomBytes = (n) => new Uint8Array(n);

describe("BLOCKER 5 — شكل الكود وentropy", () => {
  it("الأبجدية بلا محارف متشابهة (0/O, 1/I/L)", () => {
    for (const forbidden of ["0", "1", "I", "L", "O"]) {
      expect(COUPON_CODE_ALPHABET).not.toContain(forbidden);
    }
    expect(COUPON_CODE_ALPHABET).toHaveLength(30);
  });

  it("الطول الافتراضي 16 محرفًا", () => {
    expect(DEFAULT_CODE_LENGTH).toBe(16);
  });

  it("entropy الافتراضي ≥ 78 بت (غير قابل للتخمين عمليًا)", () => {
    expect(couponCodeEntropyBits()).toBeGreaterThanOrEqual(78);
    expect(couponCodeEntropyBits(MIN_CODE_LENGTH)).toBeGreaterThanOrEqual(49);
  });

  it("يرفض الأطوال القصيرة السهلة (أقل من 10 محارف)", () => {
    for (const length of [1, 4, 6, 9]) {
      expect(() => randomCouponCode(length)).toThrow();
    }
    expect(randomCouponCode(MIN_CODE_LENGTH)).toHaveLength(MIN_CODE_LENGTH);
  });

  it("يرفض طولًا غير صحيح", () => {
    expect(() => randomCouponCode(16.5)).toThrow();
    expect(() => randomCouponCode(Number.NaN)).toThrow();
  });

  it("رمز عشوائي حقيقي يطابق الشكل ولا يتكرر (1000 عيّنة)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const code = randomCouponCode();
      expect(code).toHaveLength(DEFAULT_CODE_LENGTH);
      expect(isGeneratedCouponCodeFormat(code)).toBe(true);
      expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{16}$/);
      seen.add(code);
    }
    expect(seen.size).toBe(1000);
  });

  it("التوزيع يغطّي الأبجدية كلها (بلا محرف يتعطّل)", () => {
    const chars = new Set<string>();
    for (let i = 0; i < 200; i++) for (const c of randomCouponCode(20)) chars.add(c);
    expect(chars.size).toBe(COUPON_CODE_ALPHABET.length);
  });

  it("رفض rejection sampling: البايتات ≥240 تُهمَل ولا تُنتج انحيازًا", () => {
    // 239 مقبول (وهو آخر بايت مقبول ⇒ 'Z' = الفهرس 29) و240 مرفوض.
    const bytes = new Uint8Array(2);
    bytes[0] = 239;
    bytes[1] = 240;
    let index = 0;
    const source: RandomBytes = (n) => {
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i++) out[i] = bytes[index++ % 2];
      return out;
    };
    const code = randomCouponCode(10, source);
    expect(code).toBe("ZZZZZZZZZZ");
  });

  it("لا ينهار إن أعاد المزوّد بايتات مرفوضة كلها (يفشل بوضوح)", () => {
    let calls = 0;
    const source: RandomBytes = (n) => {
      calls++;
      return new Uint8Array(n).fill(255); // كل البايتات مرفوضة
    };
    expect(() => randomCouponCode(10, source)).toThrow();
    expect(calls).toBeGreaterThan(1);
  });

  it("رقم الجوال لا يمكن أن يكون كودًا مولَّدًا (بنية لا احتمالية)", () => {
    // الأبجدية بلا 0/1 ⇒ أي رقم جوال سعودي (يحتوي 1) أو صفر غير ممكن
    // كمولَّد: الفحص حتمي لا إحصائي، فلا flaky.
    expect(isGeneratedCouponCodeFormat("966512345678")).toBe(false);
    expect(isGeneratedCouponCodeFormat("0501234567")).toBe(false);
    for (const char of ["0", "1"]) {
      expect(COUPON_CODE_ALPHABET.includes(char)).toBe(false);
    }
  });
});

describe("BLOCKER 5 — التصادم", () => {
  it("يعيد السحب عند وجود الكود مسبقًا", async () => {
    const draws: string[] = [];
    const source: RandomBytes = (n) => {
      const out = new Uint8Array(n);
      // كل جولة رقم جولة مختلف ⇒ أكواد مختلفة
      const round = draws.length;
      out.fill(round % 240);
      draws.push(String(round));
      return out;
    };
    const exists = vi.fn(async (code: string) => code === "2222222222222222");
    const code = await generateCouponCode({ exists, randomBytes: source });
    expect(exists).toHaveBeenCalledTimes(2);
    expect(code).toBe("3333333333333333");
  });

  it("يتوقف بوضوح بعد استنفاد المحاولات (لا كود مكرر ولا صمت)", async () => {
    const exists = async () => true;
    await expect(generateCouponCode({ exists, maxAttempts: 3 })).rejects.toThrow(/collision/);
  });

  it("يرفض maxAttempts غير صالح", async () => {
    await expect(generateCouponCode({ maxAttempts: 0 })).rejects.toThrow();
  });

  it("بدون exists يُعيد أول كود (حرية الاستخدام للاختبارات فقط)", async () => {
    const code = await generateCouponCode({ randomBytes: fixedBytes });
    expect(code).toBe("2222222222222222");
  });
});

describe("BLOCKER 5 — التوافق مع تطبيع الكود (S10)", () => {
  it("الكود المولَّد يمرّ عبر normalizeCouponCode دون تغيير", () => {
    for (let i = 0; i < 50; i++) {
      const code = randomCouponCode();
      expect(normalizeCouponCode(` ${code.toLowerCase()} `)).toBe(code);
    }
  });

  it("بلا فواصل: لا مسافة إضافية مطلوبة من العميل", () => {
    const code = randomCouponCode();
    expect(code).not.toMatch(/[^23456789ABCDEFGHJKMNPQRSTVWXYZ]/);
  });
});

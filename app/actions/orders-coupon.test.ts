import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateCouponAction } from "./orders";
import { COUPON_EMPTY_MESSAGE, COUPON_REJECT_MESSAGE } from "@/lib/coupons/policy";

const h = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  eq: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: (...args: unknown[]) => {
          h.eq(...args);
          return { maybeSingle: async () => ({ data: h.row }) };
        },
      }),
    }),
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

function row(over: Record<string, unknown> = {}) {
  return {
    id: "cp-1",
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

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.row = null;
  h.eq.mockReset();
  // السجل الداخلي متوقّع هنا: نمسكه بدل أن يمرّر إلى stderr أثناء الاختبار.
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe("S4/S8/S10 — validateCouponAction عند حدّ الطلب", () => {
  it("كود صالح ⇒ يُعاد الصف كما هو (المعاينة تحتفظ بسلوكها)", async () => {
    h.row = row();
    const res = await validateCouponAction("gold10", 500);
    expect(res).not.toHaveProperty("error");
    expect(res).toMatchObject({ code: "GOLD10", type: "percent", value: 10 });
  });

  it("الإدخال يُطبَّع قبل البحث: gold10 / GOLD10 / Gold10 ⇒ استعلام واحد", async () => {
    h.row = row();
    await validateCouponAction(" gold10 ", 500);
    await validateCouponAction("GOLD10", 500);
    await validateCouponAction("Gold10", 500);
    expect(h.eq).toHaveBeenCalledTimes(3);
    for (const call of h.eq.mock.calls) expect(call).toEqual(["code", "GOLD10"]);
  });

  it("كود غير موجود ⇒ الرسالة الموحدة (لا تفاصيل)", async () => {
    h.row = null;
    expect(await validateCouponAction("GHOST", 500)).toEqual({ error: COUPON_REJECT_MESSAGE });
  });

  it("إدخال فارغ ⇒ رسالة الإدخال فقط (بلا استعلام)", async () => {
    expect(await validateCouponAction("   ", 500)).toEqual({ error: COUPON_EMPTY_MESSAGE });
    expect(h.eq).not.toHaveBeenCalled();
  });
});

describe("S4 — لا oracle: كل أسباب الرفض متطابقة خارجيًا", () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["غير فعّال", { is_active: false }],
    ["لم يبدأ بعد", { starts_at: new Date(Date.now() + 3600_000).toISOString() }],
    ["منتهي", { ends_at: new Date(Date.now() - 3600_000).toISOString() }],
    ["مستهلك", { usage_limit: 1, used_count: 1 }],
    ["تحت الحد الأدنى", { min_order: 100_000 }],
  ];

  for (const [label, over] of cases) {
    it(`${label} ⇒ نفس الرسالة الموحدة`, async () => {
      h.row = row(over);
      const res = await validateCouponAction("GOLD10", 100);
      expect(res).toEqual({ error: COUPON_REJECT_MESSAGE });
    });
  }

  it("لا تسرّب: الرسالة لا تحوي سببًا ولا حدًّا ولا حالة", () => {
    expect(COUPON_REJECT_MESSAGE).not.toMatch(/الحد الأدنى|منته|فعّال|فعّالة|استُهلك|غير صحيح/);
    expect(COUPON_REJECT_MESSAGE).not.toMatch(/\d/);
  });
});

describe("S8 — starts_at صار مُطبَّقًا عند حدّ الطلب", () => {
  it("starts_at في المستقبل ⇒ مرفوض", async () => {
    h.row = row({ starts_at: new Date(Date.now() + 60_000).toISOString() });
    expect(await validateCouponAction("GOLD10", 500)).toEqual({ error: COUPON_REJECT_MESSAGE });
  });

  it("starts_at = الآن ⇒ مسموح", async () => {
    h.row = row({ starts_at: new Date(Date.now() - 1000).toISOString() });
    expect(await validateCouponAction("GOLD10", 500)).not.toHaveProperty("error");
  });

  it("starts_at null ⇒ سلوك قديم محفوظ (يُتجاهل)", async () => {
    h.row = row({ starts_at: null });
    expect(await validateCouponAction("GOLD10", 500)).not.toHaveProperty("error");
  });
});

describe("السجل الداخلي بلا أسرار (S4)", () => {
  it("يسجّل السبب فقط — لا الكود ولا أي PII", async () => {
    h.row = null;
    await validateCouponAction("SECRET-CODE-123", 500);
    expect(warnSpy).toHaveBeenCalledWith("[coupon] rejected", { reason: "not_found" });
    const serialized = JSON.stringify(warnSpy.mock.calls);
    expect(serialized).not.toContain("SECRET-CODE-123");
  });
});

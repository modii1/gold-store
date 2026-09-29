import { describe, expect, it } from "vitest";
import {
  buildOrderPricing,
  MAX_QTY_PER_LINE,
  PRICE_TOLERANCE,
  PRICING_MESSAGES,
  resolveUnitPrice,
  verifySubmittedSubtotal,
  type CatalogLoader,
  type CatalogSnapshot,
} from "@/lib/orders/pricing";
import { discountForCoupon, evaluateCoupon } from "@/lib/coupons/policy";
import type { Coupon } from "@/types";

const CATALOG: CatalogSnapshot = {
  products: [
    { id: "p1", price: 200, sale_price: null },
    { id: "p2", price: 300, sale_price: 250 },
    { id: "p3", price: 400, sale_price: 0 },
    { id: "p4", price: "150.5", sale_price: "99.25" },
    { id: "p5", price: -5, sale_price: null },
  ],
  variants: [
    { id: "v1", product_id: "p1", price: 210, sale_price: 199 },
    { id: "v2", product_id: "p1", price: 210, sale_price: null },
    { id: "v3", product_id: "p1", price: null, sale_price: null },
    { id: "v4", product_id: "p1", price: 210, sale_price: 0 },
    { id: "v5", product_id: "p2", price: null, sale_price: null },
  ],
};

const load: CatalogLoader = async () => CATALOG;

async function price(items: unknown) {
  const result = await buildOrderPricing(items, load);
  if (!result.ok) throw new Error(`unexpected rejection: ${result.reason}`);
  return result;
}

async function reason(items: unknown) {
  const result = await buildOrderPricing(items, load);
  if (result.ok) throw new Error("expected rejection");
  return result.reason;
}

/** نفس حساب المتصفح: sum(price * qty) — يُستخدم كـsubtotal مرسل. */
function browserSubtotal(items: { price: number; qty: number }[]) {
  return items.reduce((s, i) => s + i.price * i.qty, 0);
}

describe("S6 — سعر الوحدة من قاعدة البيانات", () => {
  it("سعر المنتج بلا متغيّر ومن بلا sale", () => {
    expect(resolveUnitPrice(CATALOG.products[0], null)).toBe(200);
  });

  it("يستخدم sale_price للمنتج عندما يكون أكبر من صفر", () => {
    expect(resolveUnitPrice(CATALOG.products[1], null)).toBe(250);
  });

  it("sale_price = 0 لا يُلغي السعر (effectivePrice > 0)", () => {
    expect(resolveUnitPrice(CATALOG.products[2], null)).toBe(400);
  });

  it("يقرأ numeric كنص (سلوك PostgREST)", () => {
    expect(resolveUnitPrice(CATALOG.products[3], null)).toBe(99.25);
  });

  it("متغيّر له sale_price خاص", () => {
    expect(resolveUnitPrice(CATALOG.products[0], CATALOG.variants[0])).toBe(199);
  });

  it("متغيّر بلا sale_price يستخدم سعره", () => {
    expect(resolveUnitPrice(CATALOG.products[0], CATALOG.variants[1])).toBe(210);
  });

  it("متغيّر بلا أي سعر يعود لسعر المنتج", () => {
    expect(resolveUnitPrice(CATALOG.products[0], CATALOG.variants[2])).toBe(200);
  });

  it("sale_price = 0 على المتغيّر يُحترم (كما في buy-panel مع ??)", () => {
    expect(resolveUnitPrice(CATALOG.products[0], CATALOG.variants[3])).toBe(0);
  });

  it("متغيّر لنتج آخر يعود لسعر المنتج (يُستدعى فقط مع variant_id)", () => {
    expect(resolveUnitPrice(CATALOG.products[1], CATALOG.variants[4])).toBe(250);
  });

  it("سعر منتج تالف (سالب) غير قابل للتسعير", () => {
    expect(resolveUnitPrice(CATALOG.products[4], null)).toBeNull();
  });
});

describe("S6 — subtotal على الخادم", () => {
  it("يجمع سطرًا واحدًا", async () => {
    const pricing = await price([{ product_id: "p1", variant_id: null, qty: 2 }]);
    expect(pricing.subtotal).toBe(400);
    expect(pricing.lines).toEqual([
      { product_id: "p1", variant_id: null, qty: 2, unit_price: 200, line_total: 400 },
    ]);
  });

  it("يجمع عدة أسطر بأسعار ومتغيّرات مختلفة", async () => {
    const pricing = await price([
      { product_id: "p1", variant_id: null, qty: 1 },
      { product_id: "p2", variant_id: "v5", qty: 3 },
      { product_id: "p1", variant_id: "v1", qty: 2 },
    ]);
    // 200 + (250*3) + (199*2)
    expect(pricing.subtotal).toBe(200 + 750 + 398);
    expect(pricing.lines).toHaveLength(3);
  });

  it("الكمية تضرب سعر الوحدة", async () => {
    const one = await price([{ product_id: "p1", variant_id: null, qty: 1 }]);
    const three = await price([{ product_id: "p1", variant_id: null, qty: 3 }]);
    expect(three.subtotal).toBe(one.subtotal * 3);
  });

  it("يطابق حساب المتصفح تمامًا عندما came السعر من الكتالوج (فارق < 0.01)", async () => {
    const items = [
      { product_id: "p1", variant_id: null, qty: 2, price: 200 },
      { product_id: "p4", variant_id: null, qty: 3, price: 99.25 },
    ];
    const pricing = await price(items);
    expect(verifySubmittedSubtotal(browserSubtotal(items), pricing.subtotal).ok).toBe(true);
  });

  it("snapshot يحمل subtotal وlines، والنتيجة تكرّرهما صراحة", async () => {
    const result = await price([{ product_id: "p1", variant_id: "v1", qty: 1 }]);
    expect(Object.keys(result).sort()).toEqual(["lines", "ok", "priceSnapshot", "subtotal"]);
    expect(result.priceSnapshot).toEqual({ subtotal: 199, lines: result.lines });
    expect(result.lines[0]).toMatchObject({ product_id: "p1", variant_id: "v1", unit_price: 199 });
  });
});

describe("S6 — رفض المحتوى غير القابل للتسعير (fail-closed)", () => {
  it("سلة فارغة", async () => {
    expect(await reason([])).toBe("empty_cart");
    expect(await reason(null)).toBe("empty_cart");
    expect(await reason({})).toBe("empty_cart");
  });

  it("عناصر ليست كائنات", async () => {
    expect(await reason(["p1"])).toBe("malformed_items");
    expect(await reason([null])).toBe("malformed_items");
  });

  it("سطر بلا product_id", async () => {
    expect(await reason([{ qty: 1 }])).toBe("malformed_items");
    expect(await reason([{ product_id: "", qty: 1 }])).toBe("malformed_items");
  });

  it("كمية غير صحيحة", async () => {
    expect(await reason([{ product_id: "p1", qty: 0 }])).toBe("invalid_qty");
    expect(await reason([{ product_id: "p1", qty: -2 }])).toBe("invalid_qty");
    expect(await reason([{ product_id: "p1", qty: 1.5 }])).toBe("invalid_qty");
    expect(await reason([{ product_id: "p1", qty: MAX_QTY_PER_LINE + 1 }])).toBe("invalid_qty");
    expect(await reason([{ product_id: "p1" }])).toBe("invalid_qty");
  });

  it("كمية تُرسل كنص صحيح تُقبل (checkout يمرر أرقامًا لكن الحذر أرخص)", async () => {
    const pricing = await price([{ product_id: "p1", qty: "2" }]);
    expect(pricing.subtotal).toBe(400);
  });

  it("منتج غير موجود", async () => {
    expect(await reason([{ product_id: "ghost", qty: 1 }])).toBe("unknown_product");
  });

  it("متغيّر غير موجود", async () => {
    expect(await reason([{ product_id: "p1", variant_id: "ghost", qty: 1 }])).toBe("unknown_variant");
  });

  it("متغيّر لا ينتمي للمنتج المحدد", async () => {
    expect(await reason([{ product_id: "p1", variant_id: "v5", qty: 1 }])).toBe("variant_mismatch");
  });

  it("سعر منتج غير صالح", async () => {
    expect(await reason([{ product_id: "p5", qty: 1 }])).toBe("price_unavailable");
  });

  it("سطر واحد غير قابل للتسعير يُلغي الطلب كله", async () => {
    expect(await reason([{ product_id: "p1", qty: 1 }, { product_id: "ghost", qty: 1 }])).toBe("unknown_product");
  });
});

describe("S6 — submitted subtotal للمقارنة فقط", () => {
  it("السعر نفسه يمر", () => {
    expect(verifySubmittedSubtotal(400, 400).ok).toBe(true);
  });

  it("فارق ضمن حد التسامح يمر", () => {
    expect(verifySubmittedSubtotal(400 + PRICE_TOLERANCE, 400).ok).toBe(true);
  });

  it("فارق أكبر من حد التسامح يُرفض", () => {
    expect(verifySubmittedSubtotal(400.02, 400)).toEqual({ ok: false, reason: "price_mismatch" });
  });

  it("تخفيض الـsubtotal من العميل يُرفض (لا تلاعب لتجاوز min_order)", () => {
    expect(verifySubmittedSubtotal(1, 400)).toEqual({ ok: false, reason: "price_mismatch" });
  });

  it("رفع الـsubtotal من العميل يُرفض أيضاً", () => {
    expect(verifySubmittedSubtotal(9999, 400)).toEqual({ ok: false, reason: "price_mismatch" });
  });

  it("NaN / غير رقمي يُرفض (لا يمرّ بصمت)", () => {
    expect(verifySubmittedSubtotal(Number.NaN, 400).ok).toBe(false);
    expect(verifySubmittedSubtotal(Number("abc"), 400).ok).toBe(false);
  });
});

describe("S6 + كوبون — المصدر الخادم في كل المنظومة", () => {
  const percentCoupon = {
    code: "SAVE10",
    type: "percent",
    value: 10,
    min_order: 500,
    usage_limit: null,
    used_count: 0,
    is_active: true,
  } as unknown as Coupon;

  it("الحد الأدنى يُقيَّم على subtotal الخادم لا على رقم العميل", async () => {
    const items = [{ product_id: "p1", variant_id: null, qty: 3, price: 200 }]; // 600 فعلي
    const pricing = await price(items);
    expect(verifySubmittedSubtotal(1, pricing.subtotal).ok).toBe(false);

    const onServer = evaluateCoupon(percentCoupon, { now: 0, subtotal: pricing.subtotal });
    expect(onServer.ok).toBe(true);

    const onLiedSubtotal = evaluateCoupon(percentCoupon, { now: 0, subtotal: 1 });
    expect(onLiedSubtotal.ok).toBe(false);
  });

  it("الخصم يُحسب من subtotal الخادم", async () => {
    const pricing = await price([{ product_id: "p1", variant_id: null, qty: 3 }]);
    expect(discountForCoupon(percentCoupon, pricing.subtotal)).toBe(60);
  });

  it("كوبون ثابت أكبر من السلة لا يجعل الإجمالي سالبًا", async () => {
    const fixed = { ...percentCoupon, type: "fixed", value: 5000, min_order: 0 } as unknown as Coupon;
    const pricing = await price([{ product_id: "p1", variant_id: null, qty: 1 }]); // 200

    // الخصم يقتصر على قيمة السلة، فمتبقٍ هو الشحن فقط — ولا ينزل تحت الصفر.
    const discount = discountForCoupon(fixed, pricing.subtotal);
    expect(discount).toBe(200);
    expect(pricing.subtotal + 20 - discount).toBe(20);

    // ومع شحن مجاني (عتبة الشحن المجاني) يصبح الإجمالي صفرًا لا سالبًا.
    expect(Math.max(0, pricing.subtotal + 0 - discount)).toBe(0);
  });

  it("رسائل الرفض لا تكشف تفاصيل داخلية", () => {
    const messages = new Set(Object.values(PRICING_MESSAGES));
    expect(messages.has("تعذّر إتمام الطلب. راجعي السلة وأعيدي المحاولة.")).toBe(true);
    expect(PRICING_MESSAGES.unknown_product).toBe(PRICING_MESSAGES.unknown_variant);
    expect(PRICING_MESSAGES.variant_mismatch).toBe(PRICING_MESSAGES.unknown_product);
  });
});

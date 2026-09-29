import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  products: [] as { id: string; price: number; sale_price: number | null }[],
  variants: [] as { id: string; product_id: string; price: number | null; sale_price: number | null }[],
  coupon: null as Record<string, unknown> | null,
  queriedTables: [] as string[],
  inserted: [] as { table: string; payload: Record<string, unknown> }[],
  /** G6-C: يجعل استبدال القسيمة يفشل (سباق/نفاد) لاختبار الترتيب الآمن. */
  redeemFails: false,
  warn: [] as unknown[][],
}));

/** supabase-js يُرجع دائمًا `{ data, error }` من أي استعلام (قائمة أو maybeSingle). */
function chain(data: unknown) {
  const response = { data, error: null };
  const c: Record<string, unknown> = {};
  const self = () => c;
  c.eq = self;
  c.order = self;
  c.limit = self;
  c.in = self;
  c.select = self;
  c.maybeSingle = async () => response;
  c.single = async () => response;
  c.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(response).then(resolve, reject);
  return c;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      h.queriedTables.push(table);
      const result =
        table === "products" ? h.products
        : table === "product_variants" ? h.variants
        : table === "coupons" ? h.coupon
        : null;
      return {
        select: () => chain(result),
        // G6-C: الطلب يُدرَج بقيمته كاملة ثم تُحدَّث بعد الاستبدال، فيحتاج
        // الـmock أن يدمج التحديث فعلًا كما يفعل Postgres. بدونه يبقى
        // الاختبار يقرأ صفًّا لم يُحدَّث.
        update: (patch: Record<string, unknown>) => {
          const target = h.inserted.filter((row) => row.table === table).pop();
          if (target) Object.assign(target.payload, patch);
          return chain([]);
        },
        insert: (payload: Record<string, unknown>) => {
          h.inserted.push({ table, payload });
          return chain({ id: "order-1", order_number: 4242, ...payload });
        },
      };
    },
    // redeem_coupon الذرّي: يعيد صف القسيمة بعد الزيادة.
    rpc: async (fn: string) => {
      if (fn !== "redeem_coupon") return { data: null, error: null };
      if (h.redeemFails || !h.coupon) {
        return { data: null, error: { code: "P0001", message: "exhausted" } };
      }
      return {
        data: [{ ...h.coupon, used_count: Number(h.coupon.used_count ?? 0) + 1 }],
        error: null,
      };
    },
  }),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => chain(null) }) }));
vi.mock("@/lib/auth", () => ({ getCustomerSession: async () => null, setCustomerSession: async () => {} }));
vi.mock("@/lib/services/settings", () => ({
  getSettings: async () => ({ free_shipping_threshold: 500 }),
}));
vi.mock("@/lib/notifications/engine", () => ({ emitNotification: async () => ({ queued: false }) }));
vi.mock("@/lib/customer-messaging", () => ({ sendCustomerWhatsApp: async () => ({ sent: false }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { createOrderAction } from "@/app/actions/orders";
import { PRICING_MESSAGES } from "@/lib/orders/pricing";

const UUID = "11111111-2222-3333-4444-555555555555";

function form(overrides: Record<string, string> = {}) {
  const data = new FormData();
  // النموذج يرسل كل الحقول الاختيارية كنص (فارغ أو قيمة)؛ الـaction يقرأ عدة
  // حقول بـ.trim() مباشرة، فـFormData الناقص يعني 500 لا رفضًا نظيفًا.
  for (const key of [
    "email", "city", "region", "address", "notes", "national_address",
    "building_number", "maps_url", "payment_method", "transfer_receipt_url",
  ]) {
    data.set(key, "");
  }
  data.set("name", "عميلة الاختبار");
  data.set("phone", "966512345678");
  data.set("items", JSON.stringify([{ product_id: UUID, variant_id: null, qty: 2, price: 200 }]));
  data.set("subtotal", "400");
  for (const [key, value] of Object.entries(overrides)) data.set(key, value);
  return data;
}

beforeEach(() => {
  h.queriedTables = [];
  h.inserted = [];
  h.coupon = null;
  h.redeemFails = false;
  h.products = [{ id: UUID, price: 200, sale_price: null }];
  h.variants = [];
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    h.warn.push(args);
  });
});

function lastOrder() {
  const order = h.inserted.filter((row) => row.table === "orders").pop();
  if (!order) throw new Error("no order inserted");
  return order.payload;
}

describe("S6 — createOrderAction يرفض subtotal من العميل", () => {
  it("subtotal أعلى من محسوب الخادم ⇒ رفض بلا كتابة", async () => {
    const res = await createOrderAction(form({ subtotal: "50" }));
    expect(res).toEqual({ error: PRICING_MESSAGES.price_mismatch });
    expect(h.inserted).toHaveLength(0);
    expect(h.queriedTables).not.toContain("orders");
  });

  it("subtotal أدنى من محسوب الخادم (تجاوز min_order) ⇒ رفض", async () => {
    const res = await createOrderAction(form({ subtotal: "1" }));
    expect(res).toEqual({ error: PRICING_MESSAGES.price_mismatch });
    expect(h.inserted).toHaveLength(0);
  });

  it("subtotal مطابق ⇒ يُكتب الطلب بالإجمالي المحسوب على الخادم", async () => {
    const res = await createOrderAction(form({ subtotal: "400" }));
    expect(res).toMatchObject({ success: true });
    expect(typeof (res as { orderNumber: unknown }).orderNumber).toBe("number");
    expect(lastOrder().total).toBe(400);
    expect(h.queriedTables).toContain("products");
  });

  it("فارق 0.01 ضمن التسامح ⇒ يُكتب الطلب", async () => {
    const res = await createOrderAction(form({ subtotal: "400.01" }));
    expect(res).toMatchObject({ success: true });
    expect(lastOrder().total).toBe(400);
  });

  it("فارق 0.02 خارج التسامح ⇒ رفض", async () => {
    const res = await createOrderAction(form({ subtotal: "400.02" }));
    expect(res).toEqual({ error: PRICING_MESSAGES.price_mismatch });
    expect(h.inserted).toHaveLength(0);
  });

  it("الخصم يُحسب من subtotal الخادم لا من رقم العميل", async () => {
    h.coupon = {
      code: "SAVE10", type: "percent", value: 10, min_order: 100,
      usage_limit: null, used_count: 0, is_active: true, starts_at: null, ends_at: null,
    };
    const res = await createOrderAction(form({ subtotal: "400", coupon_code: "save10" }));
    expect(res).toMatchObject({ success: true });
    const order = lastOrder();
    expect(order.discount).toBe(40);
    expect(order.total).toBe(360);
    expect(order.coupon_code).toBe("SAVE10");
  });

  it("G6-C: فشل استبدال القسيمة ⇒ الطلب يبقى بقيمته كاملة (لا خصم بلا قسيمة)", async () => {
    // الترتيب الآمن: الطلب يُدرَج بالقيمة الكاملة، ثم يُستبدل، ثم تُحدَّث
    // القيمة. فإذا فشل الاستبدال (سباق على usage_limit=1) تبقى القيمة
    // كاملة. العكس — خصم مطبَّق بلا قسيمة مستهلكة — هو الخلل المالي.
    h.coupon = {
      code: "SAVE10", type: "percent", value: 10, min_order: 100,
      usage_limit: 1, used_count: 0, is_active: true, starts_at: null, ends_at: null,
    };
    h.redeemFails = true;
    const res = await createOrderAction(form({ subtotal: "400", coupon_code: "SAVE10" }));
    expect(res).toMatchObject({ success: true });
    const order = lastOrder();
    expect(order.total).toBe(400);
    expect(order.discount).toBe(0);
    expect(order.coupon_code).toBeNull();
  });

  it("G6-C: القسيمة المربوطة بجوال آخر ⇒ رفض قبل الإدراج (بلا خصم وبلا استهلاك)", async () => {
    h.coupon = {
      code: "RECOVERYONLY1", type: "percent", value: 10, min_order: 0,
      usage_limit: 1, used_count: 0, is_active: true, starts_at: null, ends_at: null,
      customer_identifier: "966500000099",
    };
    const res = await createOrderAction(form({ subtotal: "400", coupon_code: "RECOVERYONLY1" }));
    expect(res).toEqual({ error: expect.any(String) });
    expect(h.inserted).toHaveLength(0);
  });

  it("منتج غير موجود في الكتالوج ⇒ رفض موحّد بلا تفاصيل", async () => {
    const data = form();
    data.set("items", JSON.stringify([{ product_id: "99999999-9999-9999-9999-999999999999", qty: 1, price: 10 }]));
    data.set("subtotal", "10");
    const res = await createOrderAction(data);
    expect(res).toEqual({ error: PRICING_MESSAGES.unknown_product });
    expect(h.inserted).toHaveLength(0);
  });

  it("كمية غير صحيحة ⇒ رفض", async () => {
    const data = form();
    data.set("items", JSON.stringify([{ product_id: UUID, qty: 0, price: 200 }]));
    const res = await createOrderAction(data);
    expect(res).toEqual({ error: PRICING_MESSAGES.invalid_qty });
  });

  it("items تالف JSON لا يرمي 500", async () => {
    const res = await createOrderAction(form({ items: "{oops" }));
    expect(res).toEqual({ error: "السلة فارغة" });
  });

  it("سجل الرفض يذكر السبب والرقمين بلا PII", async () => {
    await createOrderAction(form({ subtotal: "50" }));
    const mismatch = h.warn.find(([tag]) => tag === "[checkout] subtotal mismatch");
    expect(mismatch).toBeDefined();
    const [, payload] = mismatch as [string, { reason: string; submitted: number; server: number }];
    expect(payload).toEqual({ reason: "price_mismatch", submitted: 50, server: 400 });
    expect(JSON.stringify(payload)).not.toContain("966512345678");
  });

  it("variant_id يُسعَّر من product_variants لا من سعر العميل", async () => {
    const variantId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    h.variants = [{ id: variantId, product_id: UUID, price: 180, sale_price: null }];
    const data = form();
    data.set("items", JSON.stringify([{ product_id: UUID, variant_id: variantId, qty: 1, price: 180 }]));
    data.set("subtotal", "180");
    const res = await createOrderAction(data);
    expect(res).not.toEqual({ error: PRICING_MESSAGES.price_mismatch });
    expect(h.queriedTables).toContain("product_variants");
  });

  it("variant_id غير موجود ⇒ رفض، ولا استعلام variants بلا مُعرِّفات صالحة", async () => {
    const data = form();
    data.set("items", JSON.stringify([{ product_id: UUID, variant_id: "v-1", qty: 1, price: 200 }]));
    data.set("subtotal", "200");
    const res = await createOrderAction(data);
    expect(res).toEqual({ error: PRICING_MESSAGES.unknown_variant });
    // المُعرِّف ليس UUID ⇒ لا يُرسَل للاستعلام (لا 400 من PostgREST)
    expect(h.queriedTables).not.toContain("product_variants");
  });
});

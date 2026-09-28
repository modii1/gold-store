/**
 * اختبارات إثبات الاستعادة — recovered لا تعني purchase.
 *
 * قبل تثبيت أي قاعدة في Production: تدخل، شراء، استرجاع، أو قرار غير موثّق.
 * القاعدة المعتمدة: recovered لا تُشتق من purchase، بل من تدخّل موثّق يسبق الطلب.
 *
 * هذه الاختبارات مستقلة عن recovery.test.ts ولا تغيّر قصد الاختبارات القائمة.
 */

import { describe, it, expect } from "vitest";
import { InMemoryRecoveryStore } from "./store";
import { RecoveryEngine } from "./engine";
import { computeMetrics, isVerifiedRecovery } from "./metrics";
import type { RecoveryOrderSummary } from "./metrics";
import type { RecoveryIntervention } from "./metrics";
import type { RecoveryCase } from "./types";
import { loadRecoveryConfig } from "./config";
import type { RecoveryConfig } from "./config";

const HOUR = 3_600_000;
const T0 = 1_700_000_000_000;

const PHONE = "966533220646";
const ORDER_ID = "11111111-1111-4111-8111-111111111111";

/** يُبنى من loadRecoveryConfig ثم يُضبط فقط ما تحتاجه هذه الاختبارات. */
const cfg: RecoveryConfig = {
  ...loadRecoveryConfig({ NODE_ENV: "test" } as NodeJS.ProcessEnv),
  enabled: true,
  dryRun: false,
};

function baseCase(over: Partial<RecoveryCase> = {}): RecoveryCase {
  return {
    id: "case-1",
    customerId: null,
    customerPhone: PHONE,
    visitorId: "v-1",
    sessionId: "s-1",
    caseType: "ADD_TO_CART",
    status: "OPEN",
    score: 40,
    cartValue: 65,
    productIds: [],
    preferredProductId: null,
    preferredProductSlug: "product-1",
    firstDetectedAt: T0,
    lastActivityAt: T0,
    lastMessageAt: null,
    messageCount: 0,
    discountCount: 0,
    lastDiscountAt: null,
    nextActionAt: null,
    lastReminderStep: 0,
    completedAt: null,
    purchaseRef: null,
    discountRef: null,
    suppressReason: null,
    decision: null,
    decidedAt: null,
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

function intervention(over: Partial<RecoveryIntervention> = {}): RecoveryIntervention {
  return { caseId: "case-1", channel: "whatsapp", sentAt: T0 + HOUR, couponRef: null, ...over };
}

function metricsFor(cases: RecoveryCase[], interventions: RecoveryIntervention[], orderCreatedAt: number | null, order?: RecoveryOrderSummary) {
  const ordersByRef = new Map<string, RecoveryOrderSummary>();
  const orderCreatedAtByRef = new Map<string, number>();
  if (order) ordersByRef.set(ORDER_ID, order);
  if (orderCreatedAt !== null) orderCreatedAtByRef.set(ORDER_ID, orderCreatedAt);
  const byCase = new Map<string, RecoveryIntervention[]>();
  for (const i of interventions) byCase.set(i.caseId, [...(byCase.get(i.caseId) ?? []), i]);
  return computeMetrics(cases, ordersByRef, byCase, orderCreatedAtByRef);
}

// ── A/B/G: شراء طبيعي بلا تدخّل — لا استعادة ──────────────────────────

describe("شراء، purchase_ref، بلا تدخل", () => {
  it("A. حالة مُهملة + شراء طبيعي ⇒ PURCHASED ممكن لكن recovered = false", () => {
    const c = baseCase({ status: "PURCHASED", purchaseRef: ORDER_ID, completedAt: T0 + 2 * HOUR });
    const m = metricsFor([c], [], T0 + 2 * HOUR, { total: 65, discount: 0 });
    expect(m.recovered).toBe(0);
    expect(m.naturalConversions).toBe(1);
  });

  it("B. حالة + شراء بلا تدخّل ⇒ recoveredRevenue = 0", () => {
    const c = baseCase({ status: "PURCHASED", purchaseRef: ORDER_ID });
    const m = metricsFor([c], [], T0 + 2 * HOUR, { total: 65, discount: 0 });
    expect(m.recoveredRevenue).toBe(0);
    expect(m.netRecoveredRevenue).toBe(0);
    expect(m.recoveryRate).toBe(0);
  });

  it("G. purchase_ref موجود لكن لا يوجد intervention ⇒ recovered = false", () => {
    const c = baseCase({ status: "PURCHASED", purchaseRef: ORDER_ID });
    expect(isVerifiedRecovery({ status: c.status, purchaseRef: c.purchaseRef, orderCreatedAt: T0 + 2 * HOUR, interventions: [] })).toBe(false);
  });
});

// ── C: تدخّل موثّق قبل الشراء = استعادة ───────────────────────────────

describe("تدخّل موثّق قبل الشراء", () => {
  it("C. intervention قبل الطلب ⇒ recovered = true والمبيعات تُحتسب", () => {
    const c = baseCase({ status: "PURCHASED", purchaseRef: ORDER_ID });
    const m = metricsFor([c], [intervention({ sentAt: T0 + HOUR })], T0 + 2 * HOUR, { total: 65, discount: 5 });
    expect(m.recovered).toBe(1);
    expect(m.recoveredRevenue).toBe(65);
    expect(m.discountCost).toBe(5);
    expect(m.netRecoveredRevenue).toBe(60);
    expect(m.naturalConversions).toBe(0);
  });
});

// ── D/E: الترتيب الزمني ────────────────────────────────────────────────

describe("الترتيب الزمني للاستعادة", () => {
  it("D. intervention بعد الشراء ⇒ recovered = false", () => {
    const c = baseCase({ status: "PURCHASED", purchaseRef: ORDER_ID });
    const m = metricsFor([c], [intervention({ sentAt: T0 + 5 * HOUR })], T0 + 2 * HOUR, { total: 65, discount: 0 });
    expect(m.recovered).toBe(0);
    expect(m.naturalConversions).toBe(1);
  });

  it("E. شراء سابق للحالة أو تدخّل لا يخصّها ⇒ recovered = false", () => {
    const c = baseCase({ status: "PURCHASED", purchaseRef: ORDER_ID, firstDetectedAt: T0 });
    // تدخّل وطلب كلاهما سابق لبداية الحالة ⇒ لا يخصّان هذه الحالة.
    const m = metricsFor([c], [intervention({ sentAt: T0 - 2 * HOUR })], T0 - HOUR, { total: 65, discount: 0 });
    expect(m.recovered).toBe(0);
  });

  it("E2. تدخّل بعد بداية الحالة وقبل الطلب ⇒ استعادة صحيحة", () => {
    const c = baseCase({ status: "PURCHASED", purchaseRef: ORDER_ID, firstDetectedAt: T0 });
    const m = metricsFor([c], [intervention({ sentAt: T0 + HOUR })], T0 + 2 * HOUR, { total: 65, discount: 0 });
    expect(m.recovered).toBe(1);
  });

  it("لا وقت للطلب ⇒ لا استعادة (fail-safe)", () => {
    const c = baseCase({ status: "PURCHASED", purchaseRef: ORDER_ID });
    const m = metricsFor([c], [intervention({ sentAt: T0 + HOUR })], null, { total: 65, discount: 0 });
    expect(m.recovered).toBe(0);
  });
});

// ── H/I: التوصيات ليست تدخلًا ─────────────────────────────────────────

describe("التوصيات ليست تدخلاً", () => {
  it("H. wouldSend/decision فقط ⇒ recovered = false", () => {
    const c = baseCase({ status: "PURCHASED", purchaseRef: ORDER_ID, decision: "DISCOUNT_ELIGIBLE" });
    const m = metricsFor([c], [], T0 + 2 * HOUR, { total: 65, discount: 0 });
    expect(m.recovered).toBe(0);
  });

  it("I. توصية كوبون فقط (discountRef بلا سجل تدخّل) ⇒ recovered = false", () => {
    const c = baseCase({ status: "PURCHASED", purchaseRef: ORDER_ID, discountRef: "RCV-1", discountCount: 1 });
    const m = metricsFor([c], [], T0 + 2 * HOUR, { total: 65, discount: 10 });
    expect(m.recovered).toBe(0);
    expect(m.recoveredRevenue).toBe(0);
  });
});

// ── J: عدم مضاعفة الإيراد ────────────────────────────────────────────

describe("عدم مضاعفة الإيراد", () => {
  it("J. أكثر من تدخّل لنفس الحالة ⇒ الإيراد يُحتسب مرة واحدة", () => {
    const c = baseCase({ status: "PURCHASED", purchaseRef: ORDER_ID });
    const m = metricsFor(
      [c],
      [intervention({ sentAt: T0 + HOUR }), intervention({ sentAt: T0 + 1.5 * HOUR }), intervention({ sentAt: T0 + 1.8 * HOUR })],
      T0 + 2 * HOUR,
      { total: 65, discount: 0 }
    );
    expect(m.recovered).toBe(1);
    expect(m.recoveredRevenue).toBe(65);
  });

  it("حالتان تشتركان في purchase_ref ⇒ يُحتسب الطلب مرة واحدة", () => {
    const a = baseCase({ id: "case-1", status: "PURCHASED", purchaseRef: ORDER_ID });
    const b = baseCase({ id: "case-2", status: "PURCHASED", purchaseRef: ORDER_ID });
    const m = metricsFor(
      [a, b],
      [intervention({ caseId: "case-1", sentAt: T0 + HOUR }), intervention({ caseId: "case-2", sentAt: T0 + HOUR })],
      T0 + 2 * HOUR,
      { total: 65, discount: 0 }
    );
    expect(m.recovered).toBe(1);
    expect(m.recoveredRevenue).toBe(65);
  });
});

// ── K: لا dispatcher ⇒ أصفار ──────────────────────────────────────────

describe("غياب المرسل الفعلي", () => {
  it("K. لا يوجد أي تدخّل مسجّل ⇒ كل مقاييس الاستعادة صفر", () => {
    const c = baseCase({ status: "PURCHASED", purchaseRef: ORDER_ID });
    const m = metricsFor([c], [], T0 + 2 * HOUR, { total: 65, discount: 10 });
    expect(m.recovered).toBe(0);
    expect(m.recoveredRevenue).toBe(0);
    expect(m.recoveryRate).toBe(0);
    expect(m.discountCost).toBe(0);
    expect(m.netRecoveredRevenue).toBe(0);
  });

  it("لا نتائج حتى مع messageCount = 0 (أسوأ 0 في الاسترجاع)", () => {
    const c = baseCase({ status: "PURCHASED", purchaseRef: ORDER_ID, messageCount: 0 });
    const m = metricsFor([c], [], T0 + 2 * HOUR, { total: 65, discount: 0 });
    expect(m.recovered).toBe(0);
  });
});

// ── F: الإسناد في engine — لا إغلاق أعمى ─────────────────────────────

describe("completePurchaseByCustomer — إسناد دقيق", () => {
  it("F. عدّة حالات نشطة لنفس الرقم ⇒ تُغلق واحدة فقط (الأحدث نشاطاً)", async () => {
    const store = new InMemoryRecoveryStore();
    await store.create(baseCase({ id: "old", lastActivityAt: T0 }));
    await store.create(baseCase({ id: "new", lastActivityAt: T0 + HOUR }));
    const engine = new RecoveryEngine(store, cfg, () => T0 + 3 * HOUR);

    const closed = await engine.completePurchaseByCustomer(PHONE, ORDER_ID, { orderCreatedAt: T0 + 2 * HOUR });
    expect(closed).toBe(1);

    const all = store.all();
    const closedRow = all.find((c) => c.id === "new")!;
    const stillOpen = all.find((c) => c.id === "old")!;
    expect(closedRow.status).toBe("PURCHASED");
    expect(closedRow.purchaseRef).toBe(ORDER_ID);
    // الحالة الأقدم تبقى مفتوحة — لا إغلاق أعمى لكل حالات الرقم.
    expect(stillOpen.status).toBe("OPEN");
    expect(stillOpen.purchaseRef).toBeNull();
  });

  it("طلب سابق لكل الحالات ⇒ لا إغلاق (لا إسناد زمني)", async () => {
    const store = new InMemoryRecoveryStore();
    await store.create(baseCase({ id: "c1", lastActivityAt: T0 + 2 * HOUR }));
    const engine = new RecoveryEngine(store, cfg, () => T0 + 3 * HOUR);
    const closed = await engine.completePurchaseByCustomer(PHONE, ORDER_ID, { orderCreatedAt: T0 });
    expect(closed).toBe(0);
    expect(store.all()[0].status).toBe("OPEN");
  });

  it("بدون orderCreatedAt ⇒ لا إغلاق (fail-safe)", async () => {
    const store = new InMemoryRecoveryStore();
    await store.create(baseCase({ id: "c1" }));
    const engine = new RecoveryEngine(store, cfg, () => T0 + 3 * HOUR);
    expect(await engine.completePurchaseByCustomer(PHONE, ORDER_ID, {})).toBe(0);
    expect(store.all()[0].status).toBe("OPEN");
  });

  it("لا حالة نشطة ⇒ 0 بلا أخطاء", async () => {
    const store = new InMemoryRecoveryStore();
    const engine = new RecoveryEngine(store, cfg, () => T0 + 3 * HOUR);
    expect(await engine.completePurchaseByCustomer("0000000000", ORDER_ID, { orderCreatedAt: T0 + HOUR })).toBe(0);
  });
});

// ── L: regression — السجل الدائم يعمل والخصائص محفوظة ─────────────────

describe("التخزين الدائم للتدخلات", () => {
  it("L1. recordIntervention ثم listInterventions ⇒ يتقابلان", async () => {
    const store = new InMemoryRecoveryStore();
    await store.create(baseCase({ id: "c1" }));
    expect(await store.recordIntervention({ caseId: "c1", channel: "whatsapp", sentAt: T0 + HOUR })).toBe(true);
    const map = await store.listInterventions(["c1"]);
    expect(map.get("c1")).toHaveLength(1);
    expect(map.get("c1")![0].channel).toBe("whatsapp");
  });

  it("L2. تدخل موثّق مع حالة مُشتراة ⇒ استعادة صحيحة عبر المسار الكامل", async () => {
    const store = new InMemoryRecoveryStore();
    const engine = new RecoveryEngine(store, cfg, () => T0 + 3 * HOUR);
    await engine.ingest({ visitorId: "v-1", sessionId: "s-1", signalType: "add_to_cart", customer: { id: null as never, phone: PHONE }, occurredAt: T0 });
    const created = (await store.listActive())[0];
    await store.recordIntervention({ caseId: created.id, channel: "whatsapp", sentAt: T0 + HOUR });
    const closed = await engine.completePurchaseByCustomer(PHONE, ORDER_ID, { orderCreatedAt: T0 + 2 * HOUR });
    expect(closed).toBe(1);

    const all = await store.listAll();
    const byCase = await store.listInterventions();
    const createdAtMap = new Map<string, number>([[ORDER_ID, T0 + 2 * HOUR]]);
    const orders = new Map<string, RecoveryOrderSummary>([[ORDER_ID, { total: 65, discount: 0 }]]);
    const m = computeMetrics(all, orders, byCase, createdAtMap);
    expect(m.recovered).toBe(1);
    expect(m.recoveredRevenue).toBe(65);
  });

  it("L3. التقييم + استدعاء purchase لا يُسجّلان تدخلاً (بلا تسريب بصمت)", async () => {
    const store = new InMemoryRecoveryStore();
    const engine = new RecoveryEngine(store, cfg, () => T0 + 3 * HOUR);
    await engine.ingest({ visitorId: "v-9", sessionId: "s-9", signalType: "add_to_cart", occurredAt: T0 });
    const c = (await store.listActive())[0];
    expect(c.status).toBe("OPEN");
    expect(c.messageCount).toBe(0);
    const out = await engine.evaluate(c);
    expect(typeof out.decision).toBe("string");
    // التقييم لا يُسجّل تدخّلاً — وهذا هو جوهر الإصلاح.
    const byCase = await store.listInterventions();
    expect(byCase.size).toBe(0);
  });
});

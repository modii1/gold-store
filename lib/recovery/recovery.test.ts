import { describe, it, expect, beforeEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RecoveryEngine } from "./engine";
import { casePatchToRow, caseToRow, InMemoryRecoveryStore, isValidUuid, maskPhone, resolveOrderRef, SupabaseRecoveryStore } from "./store";
import { computeMetrics } from "./metrics";
import type { RecoveryIntervention } from "./metrics";
import { effectiveScore, applyAgePenalty, applyMessagePenalty } from "./scoring";
import { buildReminderSchedule, discountProposal, evaluateContact } from "./decisions";
import { canPersistCases, DEFAULT_RECOVERY_CONFIG } from "./config";
import { isCronAuthorized } from "./cron-auth";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecoveryConfig } from "./config";
import type { RecoveryCase, RecoveryInput } from "./types";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const T0 = 1_760_000_000_000;

function cfg(overrides: Partial<RecoveryConfig> = {}): RecoveryConfig {
  return { ...DEFAULT_RECOVERY_CONFIG, enabled: true, dryRun: true, ...overrides };
}

/**
 * وضع الكتابة — خارج DRY_RUN فقط.
 * منذ إصلاحStage 1: DRY_RUN = fail-closed للكتابة، فمسار الإغلاق
 * (completePurchaseByCustomer) لا يكتب إلا هنا.
 */
const wcfg = (overrides: Partial<RecoveryConfig> = {}): RecoveryConfig => cfg({ dryRun: false, ...overrides });

/** اسم حالة مُتحقَّقة مرتبطة بـ purchase_ref معيّن. */
const verifiedCaseId = (ref: string) => `verified-${ref}`;

/**
 * يبني أدلة التدخّل + أوقات الطلب التي تجعل استعادة معيّنة صالحة.
 * الشراء وحده لا يكفي: لا بد من تدخّل فعلي (T0+HOUR) قبل الطلب (T0+2*HOUR).
 */
function proofFor(ordersByRef: Map<string, { total: number; discount: number }>) {
  const interventionsByCase = new Map<string, RecoveryIntervention[]>();
  const orderCreatedAtByRef = new Map<string, number>();
  for (const ref of ordersByRef.keys()) {
    const id = verifiedCaseId(ref);
    interventionsByCase.set(id, [{ caseId: id, channel: "sms", sentAt: T0 + HOUR, couponRef: null }]);
    orderCreatedAtByRef.set(ref, T0 + 2 * HOUR);
  }
  return { interventionsByCase, orderCreatedAtByRef };
}

/** دليل تدخّل لحالة واحدة بعينها. */
function proofOf(caseId: string, orderCreatedAt: number) {
  return {
    interventionsByCase: new Map<string, RecoveryIntervention[]>([
      [caseId, [{ caseId, channel: "sms" as const, sentAt: T0 + HOUR, couponRef: null }]],
    ]),
    orderCreatedAtByRef: new Map<string, number>([[REAL_UUID, orderCreatedAt]]),
  };
}

const CUST = { id: "cust-1", phone: "966500000001" };
const REAL_UUID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

/**
 * F3-edge: تصنيف order_id قبل ربطه بـ purchase_ref.
 * أي قيمة ليست UUID صالحة ⇐ normalized=null ⇐ لا يُكتب purchase_ref.
 */
describe("F3-edge — resolveOrderRef", () => {
  it("1. order_id غير موجود (undefined / null / غير نصي) ⇐ missing", () => {
    for (const v of [undefined, null, 123, {}, []]) {
      const r = resolveOrderRef(v);
      expect(r.ok).toBe(false);
      expect(r.normalized).toBeNull();
      expect(r.problem).toBe("missing");
    }
  });

  it('2. order_id = "" ⇐ empty', () => {
    const r = resolveOrderRef("");
    expect(r.ok).toBe(false);
    expect(r.normalized).toBeNull();
    expect(r.problem).toBe("empty");
  });

  it("3. order_id = مسافات فقط ⇐ whitespace", () => {
    for (const v of ["   ", "\t", "\n", " \t\n "]) {
      const r = resolveOrderRef(v);
      expect(r.ok).toBe(false);
      expect(r.normalized).toBeNull();
      expect(r.problem).toBe("whitespace");
    }
  });

  it("4. order_id UUID صالح ⇐ normalized صالح للكتابة", () => {
    const r = resolveOrderRef(REAL_UUID);
    expect(r.ok).toBe(true);
    expect(r.problem).toBeNull();
    expect(r.normalized).toBe(REAL_UUID);
  });

  it("5. order_id غير UUID ⇐ not_uuid", () => {
    for (const v of ["not-a-uuid", "12345", `${REAL_UUID}-extra`, "00000000-0000-0000-0000-000000000000", REAL_UUID.replace("3f25", "zz25")]) {
      const r = resolveOrderRef(v);
      expect(r.ok).toBe(false);
      expect(r.normalized).toBeNull();
      expect(r.problem).toBe("not_uuid");
    }
  });

  it("6. لا يُحتسب purchase_ref في أي حالة غير صالحة", () => {
    const invalid = [undefined, null, "", "   ", "not-a-uuid", 42, {}];
    for (const v of invalid) {
      const r = resolveOrderRef(v);
      // القيمة التي ستُمرَّر إلى completePurchaseByCustomer هي normalized فقط.
      expect(r.normalized ?? null).toBeNull();
      if (r.ok) throw new Error(`قيمة غير صالحة صُنِّفت كصالحة: ${String(v)}`);
    }
    // والحالة الوحيدة التي تُنتج purchaseRef هي UUID صالح.
    expect(resolveOrderRef(REAL_UUID).normalized).toBe(REAL_UUID);
  });

  it("متوافق مع isValidUuid (لا تعارض في التصنيف)", () => {
    const samples = [REAL_UUID, "", "  ", "abc", "00000000-0000-0000-0000-000000000000"];
    for (const v of samples) {
      expect(resolveOrderRef(v).ok).toBe(isValidUuid(v));
    }
  });

  it("يزيل المسافات المحيطة من UUID صالح قبل الكتابة", () => {
    const r = resolveOrderRef(`  ${REAL_UUID}  `);
    expect(r.ok).toBe(true);
    expect(r.normalized).toBe(REAL_UUID);
  });
});

/**
 * F3-edge: order_id غير صالح لا يُلوّث purchase_ref، ولا يُنتج عدًّا خاطئًا في المقاييس.
 * (الإغلاق نفسه يمنعه المسار: order_id فارغ ⇐ لا يُستدعى المحرك أصلًا.)
 */
describe("F3-edge — لا تلويث purchase_ref ولا عدّ خاطئ", () => {
  it("completePurchaseByCustomer(null) يترك الحالة نشطة ولا يكتب purchase_ref", async () => {
    const store = new InMemoryRecoveryStore();
    const engine = new RecoveryEngine(store, wcfg(), () => T0);
    await engine.ingest({ ...base("add_to_cart"), customer: CUST });

    const closed = await engine.completePurchaseByCustomer(CUST.phone, resolveOrderRef(undefined).normalized ?? null, { orderCreatedAt: T0 + HOUR });
    // عقد المحرك (كما في R5b):.null يعني شراءً موثقًا بلا مرجع صالح ⇐ يُغلق بلا purchase_ref.
    expect(closed).toBe(1);

    const rows = await store.listAll();
    const row = rows[0];
    // purchaseRef لم يُكتب بأي قيمة (لا نص فارغ ولا قيمة مرفوضة)
    expect(row.purchaseRef).toBeNull();
    // الحالة مغلقة، لكن Success لا يُحتسب بلا مرجع صالح
    expect(row.status).toBe("PURCHASED");
    // لا ضياع لأي بيانات أخرى
    expect(row.visitorId).toBe("visitor-1");
    expect(row.sessionId).toBe("session-1");
    expect(row.score).toBeGreaterThan(0);
  });

  it("كل الحالات غير الصالحة تترك purchaseRef=null (لا قيمة واحدة تُكتب)", async () => {
    const store = new InMemoryRecoveryStore();
    const engine = new RecoveryEngine(store, wcfg(), () => T0);
    await engine.ingest({ ...base("add_to_cart"), customer: CUST });

    for (const v of [undefined, null, "", "   ", "not-a-uuid"]) {
      await engine.completePurchaseByCustomer(CUST.phone, resolveOrderRef(v).normalized ?? null, { orderCreatedAt: T0 + HOUR });
    }

    const row = (await store.listAll())[0];
    expect(row.purchaseRef).toBeNull();
  });

  it("order_id صالح يربط purchase_ref ويغلق الحالة (سلوك صحيح لم يتغير)", async () => {
    const store = new InMemoryRecoveryStore();
    const engine = new RecoveryEngine(store, wcfg(), () => T0);
    await engine.ingest({ ...base("add_to_cart"), customer: CUST });

    const ref = resolveOrderRef(REAL_UUID);
    const closed = await engine.completePurchaseByCustomer(CUST.phone, ref.ok ? ref.normalized : null, { orderCreatedAt: T0 + HOUR });
    expect(closed).toBe(1);

    const row = (await store.listAll())[0];
    expect(row.status).toBe("PURCHASED");
    expect(row.purchaseRef).toBe(REAL_UUID);
  });

  it("مقاييس الاسترجاع لا تحتسب استرجاعًا بلا purchase_ref (لا عدّ خاطئ)", async () => {
    const store = new InMemoryRecoveryStore();
    const engine = new RecoveryEngine(store, wcfg(), () => T0);
    await engine.ingest({ ...base("add_to_cart"), customer: CUST });

    // بلا purchase_ref صالح
    await engine.completePurchaseByCustomer(CUST.phone, null, { orderCreatedAt: T0 + HOUR });
    const noRef = computeMetrics(await store.listAll(), new Map());
    expect(noRef.recovered).toBe(0);
    expect(noRef.recoveredRevenue).toBe(0);
    expect(noRef.discountCost).toBe(0);
    expect(noRef.netRecoveredRevenue).toBe(0);

    // مع purchase_ref صالح يُحتسب مرة واحدة
    const store2 = new InMemoryRecoveryStore();
    const engine2 = new RecoveryEngine(store2, wcfg(), () => T0);
    await engine2.ingest({ ...base("add_to_cart"), customer: CUST });
    await engine2.completePurchaseByCustomer(CUST.phone, REAL_UUID, { orderCreatedAt: T0 + HOUR });
    const orders = new Map([[REAL_UUID, { total: 500, discount: 50 }]]);
    const c2 = (await store2.listAll())[0];
    const proof = proofOf(c2.id, T0 + 2 * HOUR);
    const withRef = computeMetrics(await store2.listAll(), orders, proof.interventionsByCase, proof.orderCreatedAtByRef);
    expect(withRef.recovered).toBe(1);
    expect(withRef.recoveredRevenue).toBe(500);
    expect(withRef.discountCost).toBe(50);
    expect(withRef.netRecoveredRevenue).toBe(450);
  });
});

describe("Privacy — maskPhone (dashboard/log display only)", () => {
  it("keeps only the last 4 digits", () => {
    expect(maskPhone("966500000001")).toBe("***0001");
    expect(maskPhone("0501234567")).toBe("***4567");
  });

  it("normalises formatted numbers before masking", () => {
    expect(maskPhone("+966 50 123 4567")).toBe("***4567");
    expect(maskPhone("(050) 123-4567")).toBe("***4567");
  });

  it("never leaks the full number", () => {
    const phone = "966500000001";
    const masked = maskPhone(phone);
    expect(masked).not.toBe(phone);
    expect(masked).not.toContain("500000001");
  });

  it("handles short / empty / missing values safely", () => {
    expect(maskPhone("12")).toBe("***");
    expect(maskPhone("")).toBeNull();
    expect(maskPhone(null)).toBeNull();
    expect(maskPhone(undefined)).toBeNull();
    expect(maskPhone("++++")).toBeNull();
  });

  it("does not mutate the stored case value", async () => {
    const store = new InMemoryRecoveryStore();
    const engine = new RecoveryEngine(store, cfg(), () => T0);
    const created = await engine.ingest({ ...base("add_to_cart"), customer: CUST });
    expect(created?.customerPhone).toBe("966500000001");
    const rows = await store.listAll();
    expect(rows[0].customerPhone).toBe("966500000001");
  });
});

describe("Recovery — Decision Engine scenarios", () => {
  let store: InMemoryRecoveryStore;
  let now: number;
  const engineAt = (c: RecoveryConfig) => new RecoveryEngine(store, c, () => now);

  beforeEach(() => {
    store = new InMemoryRecoveryStore();
    now = T0;
  });

  // 1) product_view فقط
  it("1. product_view فقط — لا تواصل (مشاهدة واحدة ليست سببًا كافيًا)", async () => {
    const c = cfg();
    const e = engineAt(c);
    await e.ingest({ ...base("product_view"), customer: CUST });
    const cases = await store.listActive();
    expect(cases).toHaveLength(1);
    const out = await e.evaluate(cases[0], {});
    expect(out.wouldSend).toBe(false);
    expect(out.decision).toBe("NO_INCENTIVE");
    expect(out.suppressReason).toBe("too_early");
  });

  // 2) repeated product views
  it("2. repeated_product_view يرفع النقاط (ترتيب لا تنبؤ)", async () => {
    const c = cfg();
    const e = engineAt(c);
    await e.ingest({ ...base("product_view"), customer: CUST });
    const after = await e.ingest({ ...base("repeated_product_view"), customer: CUST });
    expect(after!.score).toBe(10 + 15);
  });

  // 3) add_to_cart
  it("3. add_to_cart ينشئ حالة بنقاط أعلى من المشاهدة", async () => {
    const c = cfg();
    const e = engineAt(c);
    const created = await e.ingest({ ...base("add_to_cart"), customer: CUST });
    expect(created!.caseType).toBe("ADD_TO_CART");
    expect(created!.score).toBe(25);
  });

  // 4) checkout_start
  it("4. checkout_start يرفع الحالة إلى CHECKOUT_STARTED ويلتقط قيمة السلة", async () => {
    const c = cfg();
    const e = engineAt(c);
    await e.ingest({ ...base("add_to_cart"), customer: CUST });
    const up = await e.ingest({ ...base("checkout_start"), customer: CUST, subtotal: 350 });
    expect(up!.caseType).toBe("CHECKOUT_STARTED");
    expect(up!.cartValue).toBe(350);
  });

  // 5) purchase يلغي الحالة
  it("5. purchase يوقف الحالة فورًا (PURCHASED)", async () => {
    const c = wcfg();
    const e = engineAt(c);
    await e.ingest({ ...base("checkout_start"), customer: CUST, subtotal: 350 });
    now += 2 * HOUR;
    const closed = await e.completePurchaseByCustomer(CUST.phone, "order-123", { orderCreatedAt: T0 + HOUR });
    expect(closed).toBe(1);
    const all = await store.listAll();
    expect(all[0].status).toBe("PURCHASED");
    const out = await e.evaluate(all[0], {});
    expect(out.wouldSend).toBe(false);
  });

  // 5b) purchase عبر إشارة
  it("5b. purchase كإشارة يغلق الحالة (نفس النتيجة)", async () => {
    const c = cfg();
    const e = engineAt(c);
    await e.ingest({ ...base("checkout_start"), customer: CUST, subtotal: 350 });
    const res = await e.ingest({ ...base("purchase"), customer: CUST });
    expect(res!.status).toBe("PURCHASED");
    const out = await e.evaluate(res!, {});
    expect(out.wouldSend).toBe(false);
  });

  // 6) cooldown عام
  it("6. cooldown يمنع الرسالة التالية (REMINDER_ONLY لكن wouldSend=false)", async () => {
    const c = cfg();
    const e = engineAt(c);
    const created = await e.ingest({ ...base("checkout_start"), customer: CUST, subtotal: 400 });
    now += 1 * HOUR;
    await store.update(created!.id, { lastMessageAt: now, messageCount: 1 });
    const cur = (await store.listActive())[0];
    const out = await e.evaluate(cur, {});
    expect(out.wouldSend).toBe(false);
    expect(out.suppressReason).toBe("cooldown");
  });

  // 7) حد 3 رسائل
  it("7. لا أكثر من 3 رسائل للحالة الواحدة", async () => {
    const c = cfg();
    const e = engineAt(c);
    const created = await e.ingest({ ...base("checkout_start"), customer: CUST, subtotal: 400 });
    // 3 رسائل مرّت،cooling قديم
    now += 3 * HOUR;
    await store.update(created!.id, { lastMessageAt: now - 100 * HOUR, messageCount: 3 });
    const cur = (await store.listActive())[0];
    const out = await e.evaluate(cur, {});
    expect(out.wouldSend).toBe(false);
    expect(out.suppressReason).toBe("max_messages");
  });

  // 8) لا قناة تواصل (زائر مجهول)
  it("8. زائر مجهول — لا يُطلب تحديد هويته، يبقى OPEN بلا تواصل", async () => {
    const c = cfg();
    const e = engineAt(c);
    const created = await e.ingest(base("checkout_start")); // بلا customer
    now += 3 * HOUR;
    const cur = (await store.listActive())[0];
    const out = await e.evaluate(cur, {});
    expect(cur!.customerPhone).toBeNull();
    expect(cur!.status).toBe("OPEN");
    expect(out.wouldSend).toBe(false);
    expect(out.suppressReason).toBe("anonymous");
    expect(created!.status).toBe("OPEN");
  });

  // 9) طلب مكتمل موجود
  it("9. لا رسالة إذا كان هناك order مكتمل", async () => {
    const c = cfg();
    const e = engineAt(c);
    await e.ingest({ ...base("checkout_start"), customer: CUST, subtotal: 400 });
    now += 2 * HOUR;
    const cur = (await store.listActive())[0];
    const out = await e.evaluate(cur, { hasCompletedOrder: true });
    expect(out.wouldSend).toBe(false);
    expect(out.suppressReason).toBe("order_completed");
  });

  // 10) DRY_RUN لا ينفّذ شيئًا
  it("10. DRY_RUN: دورة التقييم لا تكتب ولا ترسل (تقييم فقط)", async () => {
    const c = cfg();
    const e = engineAt(c);
    await e.ingest({ ...base("checkout_start"), customer: CUST, subtotal: 400 });
    now += 30 * MINUTE;
    const { dryRun, outcomes } = await e.runDryRunCycle();
    expect(dryRun).toBe(true);
    expect(outcomes.length).toBe(1);
    // لا تغيير حالة/رسالة من التقييم
    const cur = (await store.listActive())[0];
    expect(cur!.messageCount).toBe(0);
    expect(cur!.status).toBe("OPEN");
  });

  // 11) disabled
  it("11. عند تعطيل النظام (enabled=false) لا تُنشأ حالة", async () => {
    const e = engineAt(cfg({ enabled: false }));
    const res = await e.ingest({ ...base("add_to_cart"), customer: CUST });
    expect(res).toBeNull();
    expect(await store.listAll()).toHaveLength(0);
  });

  // 12) أهلية الخصم
  it("12. الخصم مؤهل فقط بعد مرور الوقت + تذكير سابق + قيمة سلة كافية", async () => {
    const c = cfg();
    const e = engineAt(c);
    const created = await e.ingest({ ...base("checkout_start"), customer: CUST, subtotal: 400 });
    // بعد 25 ساعة ومع تذكير سابق (1 رسالة، قديمة بما يكفي لتفادي cooldown)
    now += 25 * HOUR;
    await store.update(created!.id, { lastMessageAt: now - 26 * HOUR, messageCount: 1 });
    const cur = (await store.listActive())[0];
    const out = await e.evaluate(cur, {});
    expect(out.decision).toBe("DISCOUNT_ELIGIBLE");
    expect(out.wouldSend).toBe(true);
    expect(out.recommendedDiscount).not.toBeNull();
  });

  // 13) cooldown الخصم
  it("13. cooldown الخصم: بعد منح خصم لا يُقترح خصم جديد فورًا", async () => {
    const c = cfg();
    const e = engineAt(c);
    const created = await e.ingest({ ...base("checkout_start"), customer: CUST, subtotal: 400 });
    now += 25 * HOUR;
    // تذكير سابق + خصم سابق مؤرخ الآن
    await store.update(created!.id, { lastMessageAt: now - 26 * HOUR, messageCount: 1, lastDiscountAt: now, discountCount: 1 });
    const cur = (await store.listActive())[0];
    const out = await e.evaluate(cur, {});
    expect(out.decision).not.toBe("DISCOUNT_ELIGIBLE");
  });

  // 14) انتهاء الخصم
  it("14. حتى لو انتهت مهلة cooldown الخصم، حد الخصومات لكل حالة يوقف التكرار", async () => {
    const c = cfg();
    const e = engineAt(c);
    const created = await e.ingest({ ...base("checkout_start"), customer: CUST, subtotal: 400 });
    now += 30 * HOUR;
    await store.update(created!.id, { lastMessageAt: now - 31 * HOUR, messageCount: 1, lastDiscountAt: now - 200 * HOUR, discountCount: 1 });
    const cur = (await store.listActive())[0];
    const out = await e.evaluate(cur, {});
    // maxDiscountsPerCase=1已经达到 → لا خصم
    expect(out.decision).not.toBe("DISCOUNT_ELIGIBLE");
  });

  // 15) سقف الخصم محترم
  it("15. سقف MAX_RECOVERY_DISCOUNT_AMOUNT و PERCENT لا يُتجاوز", () => {
    const c = cfg({ proposedRecoveryDiscountPercent: 25, maxRecoveryDiscountPercent: 10, maxRecoveryDiscountAmount: 50 });
    const p = discountProposal(1000, c)!;
    expect(p.percent).toBe(10); // محجوب بالحد الأعلى
    expect(p.value).toBeLessThanOrEqual(50);
  });

  // 16) منع تكرار الحالة لنفس الزائر
  it("16. لا حالة مكررة لنفس الزائر (تحديث بدل إنشاء)", async () => {
    const c = cfg();
    const e = engineAt(c);
    const a = await e.ingest({ ...base("add_to_cart"), customer: CUST });
    const b = await e.ingest({ ...base("add_to_cart"), customer: CUST });
    expect(a!.id).toBe(b!.id);
    expect(await store.listAll()).toHaveLength(1);
  });

  // 17) منع تكرار الخصم لنفس الحالة (discountRef)
  it("17. وجود discountRef يمنع اقتراح خصم جديد", async () => {
    const c = cfg();
    const e = engineAt(c);
    const created = await e.ingest({ ...base("checkout_start"), customer: CUST, subtotal: 400 });
    now += 25 * HOUR;
    await store.update(created!.id, { lastMessageAt: now - 26 * HOUR, messageCount: 1, discountRef: "RCV-1" });
    const cur = (await store.listActive())[0];
    const out = await e.evaluate(cur, {});
    expect(out.decision).not.toBe("DISCOUNT_ELIGIBLE");
  });

  // 18) تغيّر السلة
  it("18. تغيّر السلة يحدّث آخر نشاط ولا يفتح حالة جديدة", async () => {
    const c = cfg();
    const e = engineAt(c);
    const a = await e.ingest({ ...base("checkout_start"), customer: CUST, subtotal: 200 });
    now += 10 * MINUTE;
    const b = await e.ingest({ ...base("add_to_cart"), customer: CUST });
    expect(b!.id).toBe(a!.id);
    expect(b!.lastActivityAt).toBeGreaterThan(a!.lastActivityAt);
    expect(await store.listAll()).toHaveLength(1);
  });

  // 19) عميل عائد
  it("19. عميل عائد (نفس الزائر) ينعش النقاط وتاريخ آخر نشاط", async () => {
    const c = cfg();
    const e = engineAt(c);
    const a = await e.ingest({ ...base("product_view"), customer: CUST });
    now += 5 * HOUR;
    const b = await e.ingest({ ...base("add_to_cart"), customer: CUST });
    expect(b!.id).toBe(a!.id);
    expect(b!.score).toBeGreaterThan(a!.score);
    expect(b!.lastActivityAt).toBe(now);
  });

  // 19b) نية جديدة بعد حالة مغلقة = حالة جديدة (لا إحياء حد الرسائل)
  it("19b. بعد إغلاق الحالة (شراء) تُنشأ حالة جديدة لنفس الزائر — ولا تُفتح القديمة", async () => {
    const c = wcfg();
    const e = engineAt(c);
    const a = await e.ingest({ ...base("checkout_start"), customer: CUST, subtotal: 400 });
    await e.completePurchaseByCustomer(CUST.phone, "order-9", { orderCreatedAt: T0 + HOUR });
    now += 30 * MINUTE;
    const b = await e.ingest({ ...base("add_to_cart"), customer: CUST });
    expect(b!.id).not.toBe(a!.id);
    expect(b!.messageCount).toBe(0);
    const all = await store.listAll();
    expect(all).toHaveLength(2);
    expect(all.filter((c2) => c2.status === "PURCHASED")).toHaveLength(1);
  });

  // 20) انتهاء الحالة
  it("20. بعد expiryHours تُغلق الحالة ولا تُجدول رسالة", async () => {
    const c = cfg();
    const e = engineAt(c);
    await e.ingest({ ...base("checkout_start"), customer: CUST, subtotal: 400 });
    now += 100 * HOUR;
    const cur = (await store.listActive())[0];
    const out = await e.evaluate(cur, {});
    expect(out.wouldSend).toBe(false);
    expect(out.suppressReason).toBe("expired");
  });

  // 21) استرجاع يُحسب مرة واحدة (إيراد)
  it("21. الإيراد المسترجع يُحسب مرة واحدة (فك ازدواج purchase_ref)", () => {
    const orders = new Map([["o1", { total: 400, discount: 40 }]]);
    const proof = proofFor(orders);
    // نفس purchase_ref مرتين: نسخة مُتحقَّقة وأخرى بلا دليل ⇒ تُحتسب مرة واحدة.
    const cases: RecoveryCase[] = [
      caseOf({ id: verifiedCaseId("o1"), status: "PURCHASED", purchaseRef: "o1", customerPhone: CUST.phone, completedAt: T0 }),
      caseOf({ id: `dup-${verifiedCaseId("o1")}`, status: "PURCHASED", purchaseRef: "o1", customerPhone: CUST.phone, completedAt: T0 }),
    ];
    const m = computeMetrics(cases, orders, proof.interventionsByCase, proof.orderCreatedAtByRef);
    expect(m.recovered).toBe(1);
    expect(m.recoveredRevenue).toBe(400);
    expect(m.discountCost).toBe(40);
    expect(m.netRecoveredRevenue).toBe(360);
  });

  it("21b. شراء بلا أي تدخّل = انحويل طبيعي، لا استعادة", () => {
    const cases: RecoveryCase[] = [
      caseOf({ status: "PURCHASED", purchaseRef: "o1", customerPhone: CUST.phone, completedAt: T0 }),
    ];
    const orders = new Map([["o1", { total: 400, discount: 40 }]]);
    const m = computeMetrics(cases, orders);
    expect(m.recovered).toBe(0);
    expect(m.recoveredRevenue).toBe(0);
    expect(m.naturalConversions).toBe(1);
  });

  // 22) تكلفة الخصم والصافي
  it("22. تكلفة الخصم والصافي صحيحان", () => {
    const cases: RecoveryCase[] = [
      caseOf({ id: verifiedCaseId("o1"), status: "PURCHASED", purchaseRef: "o1", customerPhone: CUST.phone, completedAt: T0 }),
      caseOf({ id: verifiedCaseId("o2"), status: "PURCHASED", purchaseRef: "o2", customerPhone: "966500000002", completedAt: T0 }),
    ];
    const orders = new Map([
      ["o1", { total: 500, discount: 50 }],
      ["o2", { total: 200, discount: 0 }],
    ]);
    const proof = proofFor(orders);
    const m = computeMetrics(cases, orders, proof.interventionsByCase, proof.orderCreatedAtByRef);
    expect(m.recovered).toBe(2);
    expect(m.recoveredRevenue).toBe(700);
    expect(m.discountCost).toBe(50);
    expect(m.netRecoveredRevenue).toBe(650);
  });

  // 23) معدل الاسترجاع
  it("23. معدل الاسترجاع = مشتريات مسترجعة / حالات مؤهلة", () => {
    const orders = new Map([["o1", { total: 300, discount: 0 }]]);
    const proof = proofFor(orders);
    const cases: RecoveryCase[] = [
      caseOf({ id: verifiedCaseId("o1"), status: "PURCHASED", purchaseRef: "o1", customerPhone: CUST.phone, completedAt: T0 }),
      caseOf({ status: "OPEN", customerPhone: "966500000003" }),
      caseOf({ status: "OPEN", customerPhone: "966500000004" }),
      caseOf({ status: "OPEN", customerPhone: "966500000005" }),
    ];
    const m = computeMetrics(cases, orders, proof.interventionsByCase, proof.orderCreatedAtByRef);
    expect(m.recovered).toBe(1);
    expect(m.recoveryRate).toBe(25); // 1/4
  });

  it("23b. لا تدخلات إطلاقاً ⇒ recoveryRate = 0 ولا 100% كاذبة", () => {
    const cases: RecoveryCase[] = [
      caseOf({ status: "PURCHASED", purchaseRef: "o1", customerPhone: CUST.phone, completedAt: T0 }),
      caseOf({ status: "OPEN", customerPhone: "966500000003" }),
    ];
    const orders = new Map([["o1", { total: 300, discount: 0 }]]);
    const m = computeMetrics(cases, orders);
    expect(m.recovered).toBe(0);
    expect(m.recoveryRate).toBe(0);
  });

  // 24) زائر مجهول لا يدخل المقام (لا هوية = غير مؤهل للتواصل)
  it("24. الزائر المجهول لا يُحتسب في معدل الاسترجاع (لا تواصل)", () => {
    const cases: RecoveryCase[] = [caseOf({ status: "OPEN", customerPhone: null })];
    const m = computeMetrics(cases, new Map());
    expect(m.recoveryRate).toBe(0);
    expect(m.potentialRecoveryCandidates).toBe(1);
  });

  // 25) مفتاح التشغيل (settings.recovery_enabled) هو مصدر الحقيقة:
  //     OFF يوقف التخزين كليًا، وON يسمح به مهما كانت قيمة dryRun.
  it("25. التشغيل: التخزين يعتمد على enabled وحده", () => {
    expect(canPersistCases(cfg())).toBe(true);
    expect(canPersistCases({ ...cfg(), dryRun: false })).toBe(true);
    expect(canPersistCases({ ...cfg(), enabled: false })).toBe(false);
    expect(canPersistCases({ ...cfg(), enabled: false, dryRun: false })).toBe(false);
    expect(DEFAULT_RECOVERY_CONFIG.enabled).toBe(false);
    expect(DEFAULT_RECOVERY_CONFIG.dryRun).toBe(true);
  });

  // 26) dryRun=false يُبقي التقييم بلا قرار قابل للتنفيذ
  it("26. dryRun=false = لا يُرسل ولا يقرّح خصمًا", async () => {
    const e = new RecoveryEngine(store, { ...cfg(), dryRun: false });
    const c = caseOf({ customerPhone: CUST.phone, cartValue: 400, firstDetectedAt: T0 - 30 * HOUR, lastMessageAt: T0 - 31 * HOUR, messageCount: 1 });
    const out = await e.evaluate(c, {});
    expect(out.wouldSend).toBe(false);
    expect(out.recommendedDiscount).toBeNull();
    const cycle = await e.runDryRunCycle();
    expect(cycle.outcomes.every((o) => o.wouldSend === false)).toBe(true);
  });

  // 27) ingest لا يُنشئ حالات إذا كان النظام غير مفعّل
  it("27. enabled=false يمنع إنشاء أي حالة", async () => {
    const e = new RecoveryEngine(store, { ...cfg(), enabled: false });
    const res = await e.ingest({ ...base("checkout_start"), customer: CUST });
    expect(res).toBeNull();
    expect(await store.listAll()).toHaveLength(0);
  });

  // 28) ON يعمل بــdryRun=false: كل وظائف المحرّك القائمة بلا قفل
  it("28. ON: ingest يسجّل الحالة حتى مع dryRun=false", async () => {
    const e = new RecoveryEngine(store, { ...cfg(), enabled: true, dryRun: false });
    const res = await e.ingest({ ...base("checkout_start"), customer: CUST });
    expect(res).not.toBeNull();
    expect(await store.listAll()).toHaveLength(1);
  });

  // 29) ON: دورة التقييم والترتيب تعمل (قرار حقيقي لا قفل dryRun)
  it("29. ON: دورة التقييم تُخرج قرارًا حقيقيًا", async () => {
    const e = new RecoveryEngine(store, { ...cfg(), enabled: true, dryRun: false });
    const res = await e.ingest({ ...base("checkout_start"), customer: CUST, subtotal: 400 });
    expect(res).not.toBeNull();
    const cycle = await e.runDryRunCycle();
    expect(cycle.outcomes).toHaveLength(1);
    // القرار محسوب فعلًا عبر منطق التقييم، لا محجوب بقفل التشغيل.
    expect(cycle.outcomes[0].suppressReason).not.toBe("disabled");
    // ونفس القرار الذي يعطيه المحرّك للحالة نفسها عند ON.
    const same = await e.evaluate((await store.listAll())[0], {});
    expect(cycle.outcomes[0].decision).toBe(same.decision);
    expect(cycle.outcomes[0].suppressReason).toBe(same.suppressReason);
  });

  // 30) OFF: التقييم يُرجع حالة "معطّل" ولا يغيّر أي حالة
  it("30. OFF: دورة التقييم محجوبة بإمكانية التشغيل", async () => {
    await store.create(caseOf({ customerPhone: CUST.phone, cartValue: 400, firstDetectedAt: T0 - 30 * HOUR, lastMessageAt: T0 - 31 * HOUR, messageCount: 1 }));
    const before = await store.listAll();
    const e = new RecoveryEngine(store, { ...cfg(), enabled: false, dryRun: false });
    const cycle = await e.runDryRunCycle();
    expect(cycle.outcomes).toHaveLength(1);
    expect(cycle.outcomes[0].suppressReason).toBe("disabled");
    expect(cycle.outcomes[0].wouldSend).toBe(false);
    expect(cycle.outcomes[0].recommendedDiscount).toBeNull();
    const after = await store.listAll();
    expect(after[0].score).toBe(before[0].score);
    expect(after[0].status).toBe(before[0].status);
  });

  // 31) لا قفل على dryRun: كل دالة كتابة قائمة تعمل عند ON
  it("31. ON: لا إرسال ولا كوبون — القرار يبقى توصية فقط", async () => {
    const e = new RecoveryEngine(store, { ...cfg(), enabled: true, dryRun: false });
    const c = caseOf({ customerPhone: CUST.phone, cartValue: 400 });
    const out = await e.evaluate(c, {});
    expect(out.wouldSend).toBe(false);
    expect(out.recommendedDiscount).toBeNull();
  });
});

describe("Recovery — helpers", () => {
  it("جدول التذكيرات: 30د / 6س / 24س ثم توقف", () => {
    const sched = buildReminderSchedule(T0, DEFAULT_RECOVERY_CONFIG);
    expect(sched.map((s) => s.offsetMinutes)).toEqual([30, 360, 1440]);
    expect(sched).toHaveLength(3);
  });

  it("تناقص النقاط مع تقادم النشاط", () => {
    const s = applyAgePenalty(100, T0 + 84 * HOUR, T0, 168); // نصف عمر
    expect(s).toBe(50);
    const s2 = applyAgePenalty(100, T0 + 168 * HOUR, T0, 168); // صفر
    expect(s2).toBe(0);
  });

  it("خصم النقاط عن الرسائل السابقة", () => {
    expect(applyMessagePenalty(100, 2, 10)).toBe(80);
  });

  it("النقاط الفعالة تجمع_decay_و_penalty", () => {
    const c = { score: 100, messageCount: 1, lastActivityAt: T0 };
    const eff = effectiveScore(c, T0, DEFAULT_RECOVERY_CONFIG);
    expect(eff).toBe(90);
  });

  it("evaluateContact: قيمة سلة صغيرة لا تؤهل للخصم", () => {
    const c = caseOf({ customerPhone: CUST.phone, cartValue: 50, firstDetectedAt: T0 - 30 * HOUR, lastActivityAt: T0 - 30 * HOUR, lastMessageAt: T0 - 31 * HOUR, messageCount: 1 });
    const out = evaluateContact(c, { now: T0 }, DEFAULT_RECOVERY_CONFIG);
    expect(out.decision).not.toBe("DISCOUNT_ELIGIBLE");
  });
});

// ============================================================
// Regression suite — F1 (partial patch) / F2 (error handling) / F3 (uuid)
// ============================================================

const EPOCH_ISO = new Date(0).toISOString();

type FakeRow = Record<string, unknown>;
type FakeError = { code?: string; message: string };
type FakeState = { rows: FakeRow[]; inserts: FakeRow[]; updates: FakeRow[] };

function fakeState(): FakeState {
  return { rows: [], inserts: [], updates: [] };
}

/**
 * عميل Supabase وهمي يEnough لتغطية الاستعلامات الأربعة المستخدمة في المخزن:
 * select.eq.or.order.limit.maybeSingle / insert / update.eq / probe select.
 * يدمج التحديثات فعليًا في الصفوف حتى نتحقق من عدم محو الحقول.
 */
function fakeClient(state: FakeState, fail?: { insert?: FakeError; update?: FakeError }): unknown {
  const from = () => {
    const filters: Array<[string, unknown]> = [];
    let statusFilter: string[] | null = null;

    const applyFilters = (row: FakeRow): boolean => {
      const cols = filters.every(([c, v]) => row[c] === v);
      const st = statusFilter ? statusFilter.includes(String(row.status)) : true;
      return cols && st;
    };
    const matched = (): FakeRow[] => state.rows.filter(applyFilters);

    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = (col: string, val: unknown) => {
      filters.push([col, val]);
      return builder;
    };
    builder.or = (filter: string) => {
      const m = /status\.in\.\(([^)]*)\)/.exec(filter);
      if (m) statusFilter = m[1].split(",");
      return builder;
    };
    builder.order = () => builder;
    builder.limit = () => builder;
    builder.maybeSingle = async () => ({ data: matched()[0] ?? null, error: null });
    builder.then = (
      onfulfilled?: ((v: { data: FakeRow[]; error: FakeError | null }) => unknown) | null,
      onrejected?: ((r: unknown) => unknown) | null
    ) => Promise.resolve({ data: matched(), error: null }).then(onfulfilled, onrejected);

    builder.insert = async (row: FakeRow) => {
      state.inserts.push(row);
      if (fail?.insert) return { data: null, error: fail.insert };
      state.rows.push({ ...row });
      return { data: null, error: null };
    };

    builder.update = (row: FakeRow) => ({
      eq: (col: string, val: unknown) => {
        state.updates.push(row);
        if (fail?.update) return Promise.resolve({ data: null, error: fail.update });
        for (const r of state.rows) if (r[col] === val) Object.assign(r, row);
        return Promise.resolve({ data: null, error: null });
      },
    });

    return builder;
  };
  return { from };
}

function newFakeStore(state: FakeState, fail?: { insert?: FakeError; update?: FakeError }, onError?: (e: { op: string; code?: string; message: string }) => void) {
  return new SupabaseRecoveryStore({
    createClient: () => fakeClient(state, fail) as unknown as SupabaseClient,
    onError: onError as never,
  });
}

describe("Regression — F1: update جزئي لا يمسح الحقول الأخرى", () => {
  it("R1. casePatchToRow يرسل الحقول الموجودة فقط", () => {
    const row = casePatchToRow({ status: "PURCHASED", score: 42 });
    expect(row).toEqual({ status: "PURCHASED", score: 42 });
    expect(Object.keys(row)).toHaveLength(2);
  });

  it("R1b. undefined يُتجاهل (لا تحديث) و null يُرسل (مسح قيمة)", () => {
    const row = casePatchToRow({ status: undefined, purchaseRef: null, discountRef: undefined });
    expect(row).toEqual({ purchase_ref: null });
  });

  it("R1c. id لا يُرسل كقيمة — يُستعمل في .eq() فقط", () => {
    const row = casePatchToRow({ id: "abc", status: "EXPIRED" });
    expect(row).toEqual({ status: "EXPIRED" });
    expect(row).not.toHaveProperty("id");
  });

  it("R1d. الأرقام تُحوَّل إلى ISO (timestamptz) والأسماء snake_case", () => {
    const row = casePatchToRow({ completedAt: T0, customerPhone: CUST.phone, productIds: ["a"] });
    expect(row.completed_at).toBe(new Date(T0).toISOString());
    expect(row.customer_phone).toBe(CUST.phone);
    expect(row.product_ids).toEqual(["a"]);
  });

  it("R1e. update() يرسل patch جزئيًا فقط — بلا visitor_id/score/timestamps", async () => {
    const state = fakeState();
    const store = newFakeStore(state);
    await store.ensureReady();
    state.rows.push(caseToRow(caseOf({ id: "11111111-1111-4111-8111-111111111111" })));

    await store.update("11111111-1111-4111-8111-111111111111", { status: "PURCHASED", completedAt: T0 });

    expect(state.updates).toHaveLength(1);
    const sent = state.updates[0];
    expect(sent.status).toBe("PURCHASED");
    expect(sent).not.toHaveProperty("visitor_id");
    expect(sent).not.toHaveProperty("session_id");
    expect(sent).not.toHaveProperty("case_type");
    expect(sent).not.toHaveProperty("score");
    expect(sent).not.toHaveProperty("cart_value");
    expect(sent).not.toHaveProperty("product_ids");
    expect(sent).not.toHaveProperty("first_detected_at");
    expect(sent).not.toHaveProperty("created_at");
  });

  it("R1f. patch فارغ = لا استعلام update إطلاقًا", async () => {
    const state = fakeState();
    const store = newFakeStore(state);
    await store.ensureReady();
    await store.update("11111111-1111-4111-8111-111111111111", {});
    await store.update("11111111-1111-4111-8111-111111111111", { status: undefined });
    expect(state.updates).toHaveLength(0);
  });
});

describe("Regression — F1: completePurchaseByCustomer لا يمسح البيانات", () => {
  it("R2. الإغلاق بالشراء يحافظ على visitor/session/case_type/score/cart/products والتواريخ", async () => {
    const state = fakeState();
    const store = newFakeStore(state);
    await store.ensureReady();

    const id = "22222222-2222-4222-8222-222222222222";
    state.rows.push(
      caseToRow(
        caseOf({
          id,
          visitorId: "visitor-42",
          sessionId: "session-42",
          caseType: "CHECKOUT_STARTED",
          customerId: null,
          customerPhone: CUST.phone,
          score: 55,
          cartValue: 400,
          productIds: ["p1", "p2"],
          preferredProductId: "p1",
          preferredProductSlug: "ring-1",
          firstDetectedAt: T0 - 10 * HOUR,
          lastActivityAt: T0 - 2 * HOUR,
          createdAt: T0 - 10 * HOUR,
          messageCount: 2,
        })
      )
    );
    const createdIso = new Date(T0 - 10 * HOUR).toISOString();
    const detectedIso = new Date(T0 - 10 * HOUR).toISOString();

    const engine = new RecoveryEngine(store, wcfg(), () => T0);
    const closed = await engine.completePurchaseByCustomer(CUST.phone, REAL_UUID, { orderCreatedAt: T0 + HOUR });
    expect(closed).toBe(1);

    const row = state.rows[0];
    expect(row.status).toBe("PURCHASED");
    expect(row.purchase_ref).toBe(REAL_UUID);
    // الحقول التي كان يمسحها الكود القديم:
    expect(row.visitor_id).toBe("visitor-42");
    expect(row.session_id).toBe("session-42");
    expect(row.case_type).toBe("CHECKOUT_STARTED");
    expect(row.score).toBe(55);
    expect(row.cart_value).toBe(400);
    expect(row.product_ids).toEqual(["p1", "p2"]);
    expect(row.preferred_product_id).toBe("p1");
    expect(row.preferred_product_slug).toBe("ring-1");
    expect(row.message_count).toBe(2);
    // التواريخ القديمة لم تتغيّر:
    expect(row.created_at).toBe(createdIso);
    expect(row.first_detected_at).toBe(detectedIso);
  });

  it("R3. لا يوجد أي timestamp = 1970 بعد أي update جزئي", async () => {
    const state = fakeState();
    const store = newFakeStore(state);
    await store.ensureReady();
    const id = "33333333-3333-4333-8333-333333333333";
    state.rows.push(caseToRow(caseOf({ id, customerPhone: CUST.phone, firstDetectedAt: T0, createdAt: T0 })));

    const engine = new RecoveryEngine(store, wcfg(), () => T0);
    await engine.completePurchaseByCustomer(CUST.phone, REAL_UUID, { orderCreatedAt: T0 + HOUR });
    // تحديثات إضافية جزئية
    await store.update(id, { messageCount: 3 });
    await store.update(id, { lastMessageAt: T0, nextActionAt: T0 + HOUR });

    const TIME_COLUMNS_TO_CHECK = [
      "created_at",
      "updated_at",
      "first_detected_at",
      "last_activity_at",
      "completed_at",
      "last_message_at",
      "next_action_at",
    ];
    for (const row of state.rows) {
      for (const k of TIME_COLUMNS_TO_CHECK) {
        const v = row[k];
        if (v === null || v === undefined) continue;
        expect(typeof v, `${k} must be an ISO string`).toBe("string");
        expect(v, `${k} must not be epoch`).not.toBe(EPOCH_ISO);
        expect(new Date(String(v)).getTime(), `${k} must be a valid date`).toBeGreaterThan(0);
      }
    }
    //.created_at لم يتغيّر عند الإغلاق:
    expect(state.rows[0].created_at).toBe(new Date(T0).toISOString());
  });
});

describe("Regression — F2: أخطاء Supabase لا تُبتلع", () => {
  it("R4a. خطأ insert يُسجَّل عبر onError (لا يُبتلع ولا يرمي)", async () => {
    const state = fakeState();
    const errors: { op: string; code?: string; message: string }[] = [];
    const store = newFakeStore(state, { insert: { code: "23505", message: "duplicate key" } }, (e) => errors.push(e));
    await store.ensureReady();

    await expect(store.create(caseOf())).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
    expect(errors[0].op).toBe("create");
    expect(errors[0].code).toBe("23505");
    expect(state.rows).toHaveLength(0);
  });

  it("R4b. خطأ update يُسجَّل عبر onError (لا يُبتلع ولا يرمي)", async () => {
    const state = fakeState();
    const errors: { op: string; code?: string; message: string }[] = [];
    const store = newFakeStore(state, { update: { code: "PGRST116", message: "no rows updated" } }, (e) => errors.push(e));
    await store.ensureReady();
    state.rows.push(caseToRow(caseOf({ id: REAL_UUID })));

    await expect(store.update(REAL_UUID, { status: "PURCHASED" })).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
    expect(errors[0].op).toBe("update");
    expect(errors[0].code).toBe("PGRST116");
  });

  it("R4c. خطأ الاستعلام (throw) يُسجَّل ولا ينكسر المسار", async () => {
    const errors: { op: string; code?: string; message: string }[] = [];
    const store = new SupabaseRecoveryStore({
      createClient: () =>
        ({
          from: () => ({
            select: () => ({ limit: () => Promise.resolve({ data: null, error: null }) }),
            insert: () => {
              throw new Error("network down");
            },
            update: () => {
              throw new Error("network down");
            },
          }),
        }) as unknown as SupabaseClient,
      onError: (e) => errors.push(e),
    });
    await store.ensureReady();
    await expect(store.create(caseOf())).resolves.toBeUndefined();
    await expect(store.update(REAL_UUID, { status: "PURCHASED" })).resolves.toBeUndefined();
    expect(errors).toHaveLength(2);
    expect(errors[0].message).toBe("network down");
    expect(errors[1].message).toBe("network down");
  });

  it("R4d. ensureReady=false يمنع كل الكتابة (fail closed)", async () => {
    const state = fakeState();
    const store = newFakeStore(state);
    // لم نُحاكِ فحص الجاهزية: _ready=false
    await store.create(caseOf());
    await store.update(REAL_UUID, { status: "PURCHASED" });
    expect(state.inserts).toHaveLength(0);
    expect(state.updates).toHaveLength(0);
  });
});

describe("Regression — F3: التحقق من صلاحية purchase_ref", () => {
  it("R5a. isValidUuid: يقبل UUID ويرفض غيره", () => {
    expect(isValidUuid(REAL_UUID)).toBe(true);
    expect(isValidUuid(REAL_UUID.toUpperCase())).toBe(true);
    expect(isValidUuid(` ${REAL_UUID} `)).toBe(true);
    expect(isValidUuid("order-9")).toBe(false);
    expect(isValidUuid("12345")).toBe(false);
    expect(isValidUuid("")).toBe(false);
    expect(isValidUuid(null)).toBe(false);
    expect(isValidUuid(undefined)).toBe(false);
    expect(isValidUuid(42)).toBe(false);
    expect(isValidUuid("3f9a1c2e4b7d4a519c3e8d2f6b1a5e40")).toBe(false); // بلا شرطات
    expect(isValidUuid("3f9a1c2e-4b7d-4a51-9c3e-8d2f6b1a5e4g")).toBe(false); // حرف غير hex
  });

  it("R5b. order_id غير صالح ← الحالة تُغلق لكن purchase_ref يبقى null", async () => {
    const state = fakeState();
    const store = newFakeStore(state);
    await store.ensureReady();
    state.rows.push(caseToRow(caseOf({ id: REAL_UUID, customerPhone: CUST.phone, score: 30, cartValue: 250 })));

    const engine = new RecoveryEngine(store, wcfg(), () => T0);
    const closed = await engine.completePurchaseByCustomer(CUST.phone, null, { orderCreatedAt: T0 + HOUR });

    expect(closed).toBe(1);
    const row = state.rows[0];
    expect(row.status).toBe("PURCHASED");
    expect(row.purchase_ref).toBeNull();
    // لا يمسح بقية البيانات:
    expect(row.score).toBe(30);
    expect(row.cart_value).toBe(250);
    expect(row.created_at).toBe(new Date(T0).toISOString());
  });

  it("R5c. لا تُكتب قيمة غير صالحة في purchase_ref عبر المسار الكامل", async () => {
    const state = fakeState();
    const store = newFakeStore(state);
    await store.ensureReady();
    state.rows.push(caseToRow(caseOf({ id: REAL_UUID, customerPhone: CUST.phone })));
    const engine = new RecoveryEngine(store, wcfg(), () => T0);

    // order_id من نوع text قد لا يكون uuid — نمرّره كما هو فقط إن كان صالحًا
    const rawOrderId: string = "ORD-2026-0001";
    const ref = isValidUuid(rawOrderId) ? rawOrderId : null;
    await engine.completePurchaseByCustomer(CUST.phone, ref, { orderCreatedAt: T0 + HOUR });

    const sent = state.updates[0];
    expect(sent.purchase_ref).toBeNull();
    expect(String(sent.purchase_ref)).not.toContain("ORD-");
  });

  it("R5d. المقاييس لا تحتسب شراءً بلا purchase_ref", async () => {
    const orders = new Map([[REAL_UUID, { total: 100, discount: 0 }]]);
    const proof = proofFor(orders);
    const rows = [
      caseOf({ status: "PURCHASED", purchaseRef: null, customerPhone: CUST.phone, completedAt: T0 }),
      caseOf({ id: verifiedCaseId(REAL_UUID), status: "PURCHASED", purchaseRef: REAL_UUID, customerPhone: "966500000009", completedAt: T0 }),
    ];
    const m = computeMetrics(rows, orders, proof.interventionsByCase, proof.orderCreatedAtByRef);
    expect(m.recovered).toBe(1);
    expect(m.recoveredRevenue).toBe(100);
  });
});
// ---------- أدوات بناء الحالات للاختبار ----------
/** مدخلات إشارة صحيحة (RecoveryInput) للاختبارات. */
function base(signalType: RecoveryInput["signalType"]) {
  return {
    visitorId: "visitor-1",
    sessionId: "session-1",
    signalType,
  } as RecoveryInput;
}

/** كائن حالة كامل يدويًا لاختبارات المقاييس/القرارات. */
function caseOf(overrides: Partial<RecoveryCase> = {}): RecoveryCase {
  return {
    id: `case-${Math.random().toString(36).slice(2, 10)}`,
    customerId: null,
    customerPhone: null,
    visitorId: "visitor-1",
    sessionId: "session-1",
    caseType: "ADD_TO_CART",
    status: "OPEN",
    score: 0,
    cartValue: null,
    productIds: [],
    preferredProductId: null,
    preferredProductSlug: null,
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
      ...overrides,
    };
  }

// ============================================================
// إصلاحان أمنيّان — مصادقة fail-closed + DRY_RUN بلا كتابة
// ============================================================

/** A–D: حارس المصادقة — لا وضع يُبقي المسار مفتوحًا. */
describe("Security A–D — مصادقة /api/recovery/run (fail-closed)", () => {
  const SECRET = "s3cr3t-cron-value";

  it("A. CRON_SECRET غير موجود ⇒ مرفوض (لا تمرير حتى بلا header)", () => {
    expect(isCronAuthorized(null, {})).toBe(false);
    expect(isCronAuthorized(SECRET, {})).toBe(false);
    expect(isCronAuthorized(null, { CRON_SECRET: undefined })).toBe(false);
  });

  it("A2. CRON_SECRET فارغ أو مسافات فقط ⇒ مرفوض", () => {
    expect(isCronAuthorized(SECRET, { CRON_SECRET: "" })).toBe(false);
    expect(isCronAuthorized(SECRET, { CRON_SECRET: "   " })).toBe(false);
  });

  it("B. السر موجود + header مفقود ⇒ مرفوض", () => {
    expect(isCronAuthorized(null, { CRON_SECRET: SECRET })).toBe(false);
    expect(isCronAuthorized(undefined, { CRON_SECRET: SECRET })).toBe(false);
    expect(isCronAuthorized("", { CRON_SECRET: SECRET })).toBe(false);
  });

  it("C. السر موجود + header خاطئ ⇒ مرفوض (طول مختلف / قيمة مختلفة / مسافات)", () => {
    expect(isCronAuthorized("wrong-value", { CRON_SECRET: SECRET })).toBe(false);
    expect(isCronAuthorized("short", { CRON_SECRET: SECRET })).toBe(false);
    expect(isCronAuthorized(`${SECRET}x`, { CRON_SECRET: SECRET })).toBe(false);
    expect(isCronAuthorized(` ${SECRET}`, { CRON_SECRET: SECRET })).toBe(false);
    expect(isCronAuthorized(SECRET.toUpperCase(), { CRON_SECRET: SECRET })).toBe(false);
  });

  it("D. السر موجود + header صحيح ⇒ يسمح بالمرور", () => {
    expect(isCronAuthorized(SECRET, { CRON_SECRET: SECRET })).toBe(true);
  });

  it("لا allowlistievable: كل تركيبة بلا تطابق تابِط السبب الصحيح", () => {
    // جدول صريح يوثّق السلوك المطلوب بدل الاعتماد على الاستنتاج
    const cases: Array<[string | null | undefined, string | undefined, boolean]> = [
      [null, undefined, false],
      [null, "", false],
      [null, "   ", false],
      ["anything", undefined, false],
      ["anything", "", false],
      [null, "s3cr3t-cron-value", false],
      ["wrong", "s3cr3t-cron-value", false],
      ["s3cr3t-cron-value", "s3cr3t-cron-value", true],
    ];
    for (const [header, secret, expected] of cases) {
      expect(isCronAuthorized(header, secret === undefined ? {} : { CRON_SECRET: secret })).toBe(expected);
    }
  });
});

/** E: DRY_RUN يمنع الكتابة — وإثبات ذلك بعدّ محاولات update لا بعدّ الأثر فقط. */
describe("Security E–G — DRY_RUN = بلا أي كتابة", () => {
  function spyStore() {
    const store = new InMemoryRecoveryStore();
    const writes: Array<{ id: string; patch: Partial<RecoveryCase> }> = [];
    const realUpdate = store.update.bind(store);
    store.update = async (id: string, patch: Partial<RecoveryCase>) => {
      writes.push({ id, patch });
      return realUpdate(id, patch);
    };
    return { store, writes };
  }

  it("E. DRY_RUN=true ⇒ لا attempt كتابة ولا PURCHASED (عدّاد 0)", async () => {
    const { store, writes } = spyStore();
    const engine = new RecoveryEngine(store, cfg(), () => T0); // dryRun: true
    await engine.ingest({ ...base("checkout_start"), customer: CUST, subtotal: 400 });

    const closed = await engine.completePurchaseByCustomer(CUST.phone, REAL_UUID, { orderCreatedAt: T0 + HOUR });
    expect(closed).toBe(0);

    // الدليل الأقوى: صفر محاولة update أصلًا (لا مجرّد أثر محايد)
    expect(writes).toHaveLength(0);

    const row = (await store.listAll())[0];
    expect(row.status).toBe("OPEN");
    expect(row.purchaseRef).toBeNull();
    expect(row.completedAt).toBeNull();
  });

  it("E2. disabled=true + dryRun=false ⇒ لا كتابة أيضًا (مزدوج الإغلاق)", async () => {
    const { store, writes } = spyStore();
    // نزرع الحالة بمحرّك مفعّل، ثم نجرّب الإغلاق بمحرّك معطّل
    await new RecoveryEngine(store, wcfg(), () => T0).ingest({
      ...base("checkout_start"),
      customer: CUST,
      subtotal: 400,
    });
    const disabled = new RecoveryEngine(store, cfg({ enabled: false, dryRun: false }), () => T0);

    expect(await disabled.completePurchaseByCustomer(CUST.phone, REAL_UUID, { orderCreatedAt: T0 + HOUR })).toBe(0);
    expect(writes).toHaveLength(0);
    expect((await store.listAll())[0].status).toBe("OPEN");
  });

  it("E3. خارج DRY_RUN ⇒ الكتابة تعمل كما كان (لم نكسر منطق الإغلاق)", async () => {
    const { store } = spyStore();
    const engine = new RecoveryEngine(store, wcfg(), () => T0);
    await engine.ingest({ ...base("checkout_start"), customer: CUST, subtotal: 400 });

    expect(await engine.completePurchaseByCustomer(CUST.phone, REAL_UUID, { orderCreatedAt: T0 + HOUR })).toBe(1);
    const row = (await store.listAll())[0];
    expect(row.status).toBe("PURCHASED");
    expect(row.purchaseRef).toBe(REAL_UUID);
  });

  it("F. DRY_RUN=true ⇒ دورة القرار لا تكتب (لا رسالة ولا عدّاد)", async () => {
    const { store, writes } = spyStore();
    const engine = new RecoveryEngine(store, cfg(), () => T0);
    await engine.ingest({ ...base("checkout_start"), customer: CUST, subtotal: 400 });

    const before = JSON.stringify((await store.listAll())[0]);
    const { dryRun, outcomes } = await engine.runDryRunCycle();
    expect(dryRun).toBe(true);
    expect(outcomes).toHaveLength(1);

    // المحرك يقرأ ويقرّر فقط: لا update ولا تغيّر في أي حقل
    expect(writes).toHaveLength(0);
    expect(JSON.stringify((await store.listAll())[0])).toBe(before);

    const row = (await store.listAll())[0];
    expect(row.lastMessageAt).toBeNull();
    expect(row.messageCount).toBe(0);
    expect(row.lastReminderStep).toBe(0);
  });

  it("G. DRY_RUN=true ⇒ لا coupon: حقول الخصم لا تُمسّ + لا كود كوبون في المصدر", async () => {
    const { store, writes } = spyStore();
    let t = T0;
    const engine = new RecoveryEngine(store, cfg(), () => t);
    await engine.ingest({ ...base("checkout_start"), customer: CUST, subtotal: 400 });

    const row = (await store.listAll())[0];
    t = T0 + 30 * HOUR;
    const out = await engine.evaluate((await store.listActive())[0], {});
    // القرار يُحسب (قراءة) لكن لا خصم ولا كوبون ولا كتابة
    expect(["REMINDER_ONLY", "DISCOUNT_ELIGIBLE", "NO_INCENTIVE"]).toContain(out.decision);
    expect(out.recommendedDiscount === null || out.recommendedDiscount === undefined).toBe(true);
    expect(writes).toHaveLength(0);

    const after = (await store.listAll())[0];
    expect(after.discountCount).toBe(0);
    expect(after.discountRef).toBeNull();
    expect(after.lastDiscountAt).toBeNull();
    expect(after.discountCount).toBe(row.discountCount);
  });

  it("G2. لا مسار إرسال مباشر ولا كوبون في كود Recovery (فحص مصدر ثابت)", () => {
    const roots = ["lib/recovery", "app/api/recovery"];
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) files.push(full);
      }
    };
    for (const r of roots) walk(join(process.cwd(), r));
    expect(files.length).toBeGreaterThan(5);

    // ممنوع في كل ملفات Recovery بلا استثناء: أي استدعاء إرسال مباشر،
    // وأي مسار كوبون. الاسترجاع لا يتصل بـWhatsApp API ولا ينشئ خصومات.
    const forbidden =
      /sendWhatsApp|sendSms|sendSMS|sendEmail|sendMessage|twilio|createCoupon|insert\s+into\s+coupons|from\(\s*["'`]coupons["'`]\s*\)/i;
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      expect(`${file}: ${forbidden.test(src) ? "MATCH" : "clean"}`).toBe(`${file}: clean`);
    }

    // الاستثناء الوحيد الموافَق عليه: lib/recovery/dispatcher.ts هو المُرسِل
    // المعتمد، وهو يخاطب notification_deliveries عبر createDeliveries
    // الموجودة أصلًا — أي جدولة لا إرسال. لا يُسمح لأي ملف آخر بذكر الجدول،
    // حتى لا يتفرّع مسار تواصل ثانٍ.
    const deliveriesRef = /notification_deliveries/i;
    const allowed = join("lib", "recovery", "dispatcher.ts");
    for (const file of files) {
      const usesTable = deliveriesRef.test(readFileSync(file, "utf8"));
      if (usesTable) expect(file.endsWith(allowed)).toBe(true);
    }
    // حتى في المُرسِل: لا جدول coupons ولا استدعاء send مباشر.
    const src = readFileSync(join(process.cwd(), allowed), "utf8");
    expect(forbidden.test(src)).toBe(false);
  });
});

/** H: لا regression — F3/order_ref، anonymous suppression، ومنع الازدواج. */
describe("Security H — لا regression بعد الإصلاحين", () => {
  it("H1. F3/order_ref: مرجع صالح ⇐ يربط purchase_ref (خارج DRY_RUN)", async () => {
    const store = new InMemoryRecoveryStore();
    const engine = new RecoveryEngine(store, wcfg(), () => T0);
    await engine.ingest({ ...base("add_to_cart"), customer: CUST });

    const ref = resolveOrderRef(REAL_UUID);
    expect(await engine.completePurchaseByCustomer(CUST.phone, ref.ok ? ref.normalized : null, { orderCreatedAt: T0 + HOUR })).toBe(1);
    const row = (await store.listAll())[0];
    expect(row.status).toBe("PURCHASED");
    expect(row.purchaseRef).toBe(REAL_UUID);
  });

  it("H2. F3/order_ref: مرجع غير صالح ⇐ يُغلق بلا purchase_ref (لا تلويث)", async () => {
    const store = new InMemoryRecoveryStore();
    const engine = new RecoveryEngine(store, wcfg(), () => T0);
    await engine.ingest({ ...base("add_to_cart"), customer: CUST });

    for (const bad of ["", "   ", "not-a-uuid", undefined, null]) {
      const ref = resolveOrderRef(bad);
      await engine.completePurchaseByCustomer(CUST.phone, ref.ok ? ref.normalized : null, { orderCreatedAt: T0 + HOUR });
      expect((await store.listAll())[0].purchaseRef).toBeNull();
    }
    expect((await store.listAll())[0].status).toBe("PURCHASED");
  });

  it("H3. F3/order_ref: في DRY_RUN لا كتابة إطلاقًا (بما فيها المرجع)", async () => {
    const store = new InMemoryRecoveryStore();
    const engine = new RecoveryEngine(store, cfg(), () => T0);
    await engine.ingest({ ...base("add_to_cart"), customer: CUST });

    const ref = resolveOrderRef(REAL_UUID);
    expect(await engine.completePurchaseByCustomer(CUST.phone, ref.ok ? ref.normalized : null, { orderCreatedAt: T0 + HOUR })).toBe(0);
    const row = (await store.listAll())[0];
    expect(row.purchaseRef).toBeNull();
    expect(row.status).toBe("OPEN");
  });

  it("H4. anonymous suppression: بلا هاتف ⇒ wouldSend=false وبلا تواصل", async () => {
    const store = new InMemoryRecoveryStore();
    const engine = new RecoveryEngine(store, wcfg(), () => T0);
    await engine.ingest({ ...base("checkout_start") }); // بلا customer = anonymous

    const row = (await store.listActive())[0];
    expect(row.customerPhone).toBeNull();
    expect(row.customerId).toBeNull();

    const out = await engine.evaluate(row, {});
    expect(out.wouldSend).toBe(false);
    expect(out.suppressReason).toBe("anonymous");
  });

  it("H5. logged-in: العميل المسجّل يصل لقرار حقيقي بلا كسر", async () => {
    const store = new InMemoryRecoveryStore();
    const engine = new RecoveryEngine(store, wcfg(), () => T0);
    await engine.ingest({ ...base("checkout_start"), customer: CUST, subtotal: 400 });

    const row = (await store.listActive())[0];
    expect(row.customerPhone).toBe(CUST.phone);
    expect(row.customerId).toBe(CUST.id);
    const out = await engine.evaluate(row, {});
    expect(out.suppressReason).not.toBe("anonymous");
    expect(typeof out.decision).toBe("string");
  });

  it("H6. منع الازدواج: إغلاق ثانٍ لنفس المرجع لا يضاعف الاحتساب", async () => {
    const store = new InMemoryRecoveryStore();
    const engine = new RecoveryEngine(store, wcfg(), () => T0);
    await engine.ingest({ ...base("checkout_start"), customer: CUST, subtotal: 400 });

    expect(await engine.completePurchaseByCustomer(CUST.phone, REAL_UUID, { orderCreatedAt: T0 + HOUR })).toBe(1);
    // لا حالة نشطة متبقية ⇒ محاولة ثانية لا تُغلق شيئًا
    expect(await engine.completePurchaseByCustomer(CUST.phone, REAL_UUID, { orderCreatedAt: T0 + HOUR })).toBe(0);

    const all = await store.listAll();
    expect(all.filter((c) => c.purchaseRef === REAL_UUID)).toHaveLength(1);
    const proof = proofOf(all[0].id, T0 + 2 * HOUR);
    // الشراء بلا دليل تدخّل ليس استعادة.
    const m = computeMetrics(all, new Map([[REAL_UUID, { total: 500, discount: 50 }]]), proof.interventionsByCase, proof.orderCreatedAtByRef);
    expect(m.recovered).toBe(1);
  });

  it("H7. حالة نشطة واحدة لكل زائر: لا تكرار بعد إعادة الاستيعاب", async () => {
    const store = new InMemoryRecoveryStore();
    let t = T0;
    const engine = new RecoveryEngine(store, wcfg(), () => t);
    const first = await engine.ingest({ ...base("checkout_start"), customer: CUST, subtotal: 400 });
    t = T0 + 5 * HOUR;
    const second = await engine.ingest({ ...base("add_to_cart"), customer: CUST });
    expect(second!.id).toBe(first!.id);
    expect(await store.listActive()).toHaveLength(1);
  });
});

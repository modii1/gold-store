/**
 * Phase 5–6 — اختبارات محرك القرار (أدلة + نية + ثقة ← قرار خالص).
 *
 * Fixtures محلية فقط: لا أي اتصال بقاعدة بيانات الإنتاج.
 * القرار دالة نقية حتمية (now مدخل) — الاختبارات تثبت:
 *   - سلسلة الأولوية P0..P9 لا تُكسر (حماية أعلى تسبق كل ما يليها).
 *   - الحافز ترشيح فقط في طبقة EXTREME + HIGH ثقة + شروط كاملة.
 *   - لا Side effect ولا إعادة قراءة: المدخلات مجمّدة ولا تُغيّر.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_RECOVERY_CONFIG } from "./config";
import { evaluateRecoveryIntelligence, type AnalyticsEventRow, type IntelligenceContext } from "./evidence";
import {
  CUSTOMER_STATES,
  decideRecoveryAction,
  INCENTIVE_DECISIONS,
  RECOVERY_DECISIONS,
  type CustomerState,
  type DecisionCaseContext,
  type RecoveryDecision,
  type RecoveryDecisionValue,
} from "./decision";

const cfg = { ...DEFAULT_RECOVERY_CONFIG, enabled: true, dryRun: true };
const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const H = 3600_000;
const MIN = 60_000;

let seq = 0;
function ev(type: string, session: string, o: { product?: string | null; ts?: number; meta?: Record<string, unknown> } = {}): AnalyticsEventRow {
  seq++;
  return {
    id: `e${seq}`,
    visitor_id: "visitor-v1",
    session_id: session,
    event_type: type,
    page_path: null,
    product_id: o.product ?? null,
    product_slug: o.product ? `slug-${o.product}` : null,
    referrer: null,
    device_type: "desktop",
    metadata: o.meta ?? {},
    created_at: new Date(o.ts ?? NOW).toISOString(),
  };
}

function baseCtx(over: Partial<DecisionCaseContext> = {}): DecisionCaseContext {
  return {
    now: NOW,
    caseId: "c1",
    status: "OPEN",
    firstDetectedAt: NOW - 40 * MIN,
    lastActivityAt: NOW - 10 * MIN,
    lastMessageAt: null,
    messageCount: 0,
    cartValue: null,
    preferredProductId: "p1",
    discountCount: 0,
    lastDiscountAt: null,
    discountRef: null,
    hasCompletedOrder: false,
    customerPhone: "966500000001",
    ...over,
  };
}

/** السلسلة الكاملة: أدلة ← نية/ثقة ← قرار عبر الوحدة المركزية (بلا أي محرك خارجي). */
function decide(rows: AnalyticsEventRow[], cx: DecisionCaseContext, over: Partial<IntelligenceContext> = {}): RecoveryDecision {
  const ic: IntelligenceContext = { caseType: "ADD_TO_CART", preferredProductId: "p1", caseCartValue: null, identity: "anonymous", ...over };
  const r = evaluateRecoveryIntelligence(rows, ic, cfg, { asOf: NOW });
  return decideRecoveryAction({ evidence: r.evidence, intent: r.intent, confidence: r.confidence, context: cx, cfg });
}

describe("decision — النموذج والمخزّنات", () => {
  it("الحالات والقرارات وقررات الحافز قيم صريحة ثابتة", () => {
    expect(CUSTOMER_STATES).toContain("INCENTIVE_CANDIDATE");
    expect(CUSTOMER_STATES).toContain("HIGH_INTENT");
    expect(RECOVERY_DECISIONS).toEqual(["NO_ACTION", "WAIT", "SEND_MESSAGE", "SEND_PRODUCT_MESSAGE", "SEND_MARKETING_MESSAGE", "RECOMMEND_INCENTIVE", "STOP"]);
    expect(INCENTIVE_DECISIONS).toEqual(["NO_INCENTIVE", "INCENTIVE_NOT_JUSTIFIED", "INCENTIVE_CANDIDATE"]);
    expect(RECOVERY_DECISIONS).not.toContain("CREATE_COUPON");
  });

  it("قرار الحافز لا ينشئ كوبونًا: ترشيح فقط بقيمة رقمية", () => {
    const rows = [
      ev("product_view", "s1", { product: "p1", ts: NOW - 3 * H }),
      ev("product_view", "s2", { product: "p1", ts: NOW - 2 * H }),
      ev("add_to_cart", "s3", { product: "p1", ts: NOW - 70 * MIN }),
      ev("checkout_start", "s3", { product: null, ts: NOW - 50 * MIN, meta: { subtotal: 1500 } }),
      ev("payment_started", "s3", { product: null, ts: NOW - 40 * MIN }),
    ];
    const d = decide(rows, baseCtx({ firstDetectedAt: NOW - 26 * H, messageCount: 1 }), { caseType: "PAYMENT_STARTED", identity: "logged_in" });
    expect(d.decision).toBe("RECOMMEND_INCENTIVE");
    expect(d.recommendedDiscount).toEqual({ percent: 10, cap: 50, value: 50 });
    expect("couponCode" in (d as never)).toBe(false);
  });
});

describe("decision — سيناريوهات 1..20 (القرار من النماذج الحتمية)", () => {
  it("1. تصفّح واحد لا يكفي: intent VERY_LOW ⇒ NO_ACTION/LOW_INTENT", () => {
    const d = decide([ev("product_view", "s1", { product: "p1", ts: NOW - 40 * MIN })], baseCtx(), { identity: "logged_in" });
    expect(d.decision).toBe("NO_ACTION");
    expect(d.customerState).toBe("BROWSING");
    expect(d.intentScore).toBe(19);
    expect(d.intentLevel).toBe("VERY_LOW");
    expect(d.confidenceScore).toBe(57);
    expect(d.confidenceLevel).toBe("MEDIUM");
    expect(d.contactReason).toBe("LOW_INTENT");
    expect(d.shouldContact).toBe(false);
    expect(d.shouldOfferIncentive).toBe(false);
    expect(d.recommendedStage).toBeNull();
    expect(d.nextActionAt).toBeNull();
  });

  it("2. تكرار مشاهدة عبر جلسات يبقى ضعيفًا: intent LOW ⇒ NO_ACTION", () => {
    const rows = [
      ev("product_view", "s1", { product: "p1", ts: NOW - 3 * H }),
      ev("product_view", "s2", { product: "p1", ts: NOW - 2 * H }),
      ev("product_view", "s3", { product: "p1", ts: NOW - 1 * H }),
    ];
    const d = decide(rows, baseCtx(), { identity: "logged_in" });
    expect(d.intentScore).toBe(42);
    expect(d.intentLevel).toBe("LOW");
    expect(d.confidenceScore).toBe(93);
    expect(d.customerState).toBe("REPEATED_INTEREST");
    expect(d.decision).toBe("NO_ACTION");
    expect(d.contactReason).toBe("LOW_INTENT");
  });

  it("3. إضافة سلة واحدة لا تكفي: intent VERY_LOW ⇒ NO_ACTION", () => {
    const d = decide([ev("add_to_cart", "s1", { product: "p1", ts: NOW - 30 * MIN })], baseCtx(), { identity: "logged_in" });
    expect(d.intentScore).toBe(19);
    expect(d.intentLevel).toBe("VERY_LOW");
    expect(d.customerState).toBe("CART_CREATED");
    expect(d.decision).toBe("NO_ACTION");
    expect(d.contactReason).toBe("LOW_INTENT");
  });

  it("4. سلة بقيمة + جلسات لا تكفي تكرارًا: intent LOW ⇒ NO_ACTION", () => {
    const rows = [
      ev("add_to_cart", "s1", { product: "p1", ts: NOW - 3 * H }),
      ev("add_to_cart", "s2", { product: "p1", ts: NOW - 2 * H }),
      ev("add_to_cart", "s3", { product: "p1", ts: NOW - 1 * H }),
    ];
    const d = decide(rows, baseCtx({ cartValue: 300 }), { identity: "logged_in", caseCartValue: 300 });
    expect(d.intentScore).toBe(35);
    expect(d.intentLevel).toBe("LOW");
    expect(d.confidenceScore).toBe(100);
    expect(d.decision).toBe("NO_ACTION");
    expect(d.contactReason).toBe("LOW_INTENT");
  });

  it("5. إتمام مع سلة 250 ⇒ intent MEDIUM 50: SEND_MESSAGE المرحلة الأولى", () => {
    const rows = [
      ev("product_view", "s1", { product: "p1", ts: NOW - 40 * MIN }),
      ev("add_to_cart", "s1", { product: "p1", ts: NOW - 30 * MIN }),
      ev("checkout_start", "s1", { product: null, ts: NOW - 10 * MIN, meta: { subtotal: 250 } }),
    ];
    const d = decide(rows, baseCtx(), { caseType: "CHECKOUT_STARTED", identity: "logged_in" });
    expect(d.intentScore).toBe(50);
    expect(d.intentLevel).toBe("MEDIUM");
    expect(d.confidenceScore).toBe(89);
    expect(d.confidenceLevel).toBe("HIGH");
    expect(d.decision).toBe("SEND_MESSAGE");
    expect(d.customerState).toBe("CHECKOUT_STARTED");
    expect(d.shouldContact).toBe(true);
    expect(d.contactReason).toBe("CONTACT_ALLOWED");
    expect(d.recommendedStage).toBe("reminder_1");
    expect(d.nextActionAt).toBe(NOW + 320 * MIN);
    expect(d.shouldOfferIncentive).toBe(false);
    expect(d.incentiveDecision).toBe("NO_INCENTIVE");
  });

  it("6. إتمام + تكرار + سلة 420 ⇒ intent HIGH 73، ثقة HIGH 100: SEND_MARKETING (لا حافز دون EXTREME)", () => {
    const rows = [
      ev("product_view", "s1", { product: "p1", ts: NOW - 3 * H }),
      ev("product_view", "s2", { product: "p1", ts: NOW - 2 * H }),
      ev("product_view", "s3", { product: "p1", ts: NOW - 90 * MIN }),
      ev("add_to_cart", "s4", { product: "p1", ts: NOW - 70 * MIN }),
      ev("add_to_cart", "s3", { product: "p1", ts: NOW - 60 * MIN }),
      ev("checkout_start", "s3", { product: null, ts: NOW - 15 * MIN, meta: { subtotal: 420 } }),
    ];
    const d = decide(rows, baseCtx({ firstDetectedAt: NOW - 3 * H }), { caseType: "CHECKOUT_STARTED", identity: "logged_in" });
    expect(d.intentScore).toBe(73);
    expect(d.intentLevel).toBe("HIGH");
    expect(d.confidenceScore).toBe(100);
    expect(d.confidenceLevel).toBe("HIGH");
    expect(d.decision).toBe("SEND_MARKETING_MESSAGE");
    expect(d.customerState).toBe("HIGH_INTENT");
    expect(d.shouldContact).toBe(true);
    expect(d.recommendedStage).toBe("reminder_1");
    expect(d.nextActionAt).toBe(NOW + 3 * H);
    expect(d.incentiveDecision).toBe("INCENTIVE_NOT_JUSTIFIED");
    expect(d.shouldOfferIncentive).toBe(false);
  });

  it("7. دفع قوي دون سلة مرصودة ⇒ intent HIGH 79 بثقة MEDIUM 55: SEND_PRODUCT_MESSAGE", () => {
    const rows = [ev("payment_started", "s1", { product: null, ts: NOW - 15 * MIN })];
    const d = decide(rows, baseCtx(), { caseType: "PAYMENT_STARTED", preferredProductId: null, caseCartValue: 1500, identity: "logged_in" });
    expect(d.intentScore).toBe(79);
    expect(d.intentLevel).toBe("HIGH");
    expect(d.confidenceScore).toBe(55);
    expect(d.confidenceLevel).toBe("MEDIUM");
    expect(d.decision).toBe("SEND_PRODUCT_MESSAGE");
    expect(d.customerState).toBe("HIGH_INTENT");
    expect(d.shouldContact).toBe(true);
    expect(d.contactReason).toBe("CONTACT_ALLOWED");
    expect(d.nextActionAt).toBe(NOW + 320 * MIN);
    expect(d.incentiveDecision).toBe("NO_INCENTIVE");
  });

  it("8. دفع + سلة 500 مجهول ⇒ intent HIGH 75 بثقة LOW 32: WAIT/LOW_CONFIDENCE (لا تسويق قوي)", () => {
    const rows = [
      ev("checkout_start", "s1", { product: null, ts: NOW - 10 * MIN, meta: { subtotal: 500 } }),
      ev("payment_started", "s1", { product: null, ts: NOW - 5 * MIN }),
    ];
    const d = decide(rows, baseCtx(), { caseType: "PAYMENT_STARTED", preferredProductId: null, identity: "anonymous" });
    expect(d.intentScore).toBe(75);
    expect(d.intentLevel).toBe("HIGH");
    expect(d.confidenceScore).toBe(32);
    expect(d.confidenceLevel).toBe("LOW");
    expect(d.decision).toBe("WAIT");
    expect(d.contactReason).toBe("LOW_CONFIDENCE");
    expect(d.customerState).toBe("PAYMENT_INTENT");
    expect(d.shouldContact).toBe(false);
    expect(d.shouldOfferIncentive).toBe(false);
  });

  it("9. دفع + إتمام + سلة 1500 + تذكير سابق + عمر 26س ⇒ intent EXTREME 94، ثقة 100: RECOMMEND_INCENTIVE", () => {
    const rows = [
      ev("product_view", "s1", { product: "p1", ts: NOW - 3 * H }),
      ev("product_view", "s2", { product: "p1", ts: NOW - 2 * H }),
      ev("add_to_cart", "s3", { product: "p1", ts: NOW - 70 * MIN }),
      ev("checkout_start", "s3", { product: null, ts: NOW - 50 * MIN, meta: { subtotal: 1500 } }),
      ev("payment_started", "s3", { product: null, ts: NOW - 40 * MIN }),
    ];
    const d = decide(rows, baseCtx({ firstDetectedAt: NOW - 26 * H, messageCount: 1 }), { caseType: "PAYMENT_STARTED", identity: "logged_in" });
    expect(d.intentScore).toBe(94);
    expect(d.intentLevel).toBe("EXTREME");
    expect(d.confidenceScore).toBe(100);
    expect(d.confidenceLevel).toBe("HIGH");
    expect(d.decision).toBe("RECOMMEND_INCENTIVE");
    expect(d.customerState).toBe("INCENTIVE_CANDIDATE");
    expect(d.shouldContact).toBe(true);
    expect(d.shouldOfferIncentive).toBe(true);
    expect(d.incentiveDecision).toBe("INCENTIVE_CANDIDATE");
    expect(d.recommendedDiscount).toEqual({ percent: 10, cap: 50, value: 50 });
    expect(d.recommendedStage).toBe("reminder_2");
    expect(d.nextActionAt).toBe(NOW - 2 * H);

    const copy = decide(rows, baseCtx({ firstDetectedAt: NOW - 26 * H, messageCount: 1 }), { caseType: "PAYMENT_STARTED", identity: "logged_in" });
    expect(copy).toEqual(d);
  });

  it("10. تواصل حديث (cooldown 24س) ⇒ WAIT/RECENT_CONTACT مهما بلغت النية", () => {
    const rows = [
      ev("checkout_start", "s1", { product: null, ts: NOW - 10 * MIN, meta: { subtotal: 1500 } }),
      ev("payment_started", "s1", { product: null, ts: NOW - 5 * MIN }),
    ];
    const d = decide(rows, baseCtx({ lastMessageAt: NOW - 1 * H }), { caseType: "PAYMENT_STARTED", identity: "logged_in" });
    expect(d.decision).toBe("WAIT");
    expect(d.contactReason).toBe("RECENT_CONTACT");
    expect(d.shouldContact).toBe(false);
    expect(d.nextActionAt).toBe(NOW + 23 * H);
  });

  it("11. شراء حديث ⇒ STOP/PURCHASED (لا رسالة تعقب الشراء)", () => {
    const rows = [
      ev("checkout_start", "s1", { product: null, ts: NOW - 30 * MIN, meta: { subtotal: 350 } }),
      ev("purchase", "s1", { product: null, ts: NOW - 20 * MIN, meta: { value: 350 } }),
    ];
    const d = decide(rows, baseCtx(), { caseType: "PAYMENT_STARTED", identity: "logged_in" });
    expect(d.decision).toBe("STOP");
    expect(d.customerState).toBe("PURCHASED");
    expect(d.contactReason).toBe("PURCHASED");
    expect(d.suppressionReason).toBe("purchased");
    expect(d.shouldContact).toBe(false);
    expect(d.shouldOfferIncentive).toBe(false);
    expect(d.recommendedDiscount).toBeNull();
  });

  it("12. طلب سابق مكتمل ⇒ STOP/SUPPRESSED order_completed", () => {
    const d = decide([ev("checkout_start", "s1", { product: null, ts: NOW - 10 * MIN, meta: { subtotal: 500 } })], baseCtx({ hasCompletedOrder: true }), {
      caseType: "CHECKOUT_STARTED",
      identity: "logged_in",
    });
    expect(d.decision).toBe("STOP");
    expect(d.customerState).toBe("SUPPRESSED");
    expect(d.suppressionReason).toBe("order_completed");
  });

  it("13. حالة مغلقة (EXPIRED) ⇒ STOP/SUPPRESSED مهما كانت الأدلة", () => {
    const d = decide(
      [
        ev("payment_started", "s1", { product: null, ts: NOW - 10 * MIN }),
        ev("checkout_start", "s1", { product: null, ts: NOW - 15 * MIN, meta: { subtotal: 1000 } }),
      ],
      baseCtx({ status: "EXPIRED" }),
      { caseType: "PAYMENT_STARTED", identity: "logged_in" },
    );
    expect(d.decision).toBe("STOP");
    expect(d.customerState).toBe("SUPPRESSED");
    expect(d.suppressionReason).toBe("status:expired");
  });

  it("14. انتهاء مهلة الاسترجاع ⇒ STOP/SUPPRESSED expired (حتى مع نية شديدة)", () => {
    const rows = [
      ev("product_view", "s1", { product: "p1", ts: NOW - 3 * H }),
      ev("product_view", "s2", { product: "p1", ts: NOW - 2 * H }),
      ev("add_to_cart", "s3", { product: "p1", ts: NOW - 70 * MIN }),
      ev("checkout_start", "s3", { product: null, ts: NOW - 50 * MIN, meta: { subtotal: 1500 } }),
      ev("payment_started", "s3", { product: null, ts: NOW - 40 * MIN }),
    ];
    const d = decide(rows, baseCtx({ firstDetectedAt: NOW - 100 * H }), { caseType: "PAYMENT_STARTED", identity: "logged_in" });
    expect(d.decision).toBe("STOP");
    expect(d.customerState).toBe("SUPPRESSED");
    expect(d.suppressionReason).toBe("expired");
    expect(d.shouldContact).toBe(false);
  });

  it("15. زائر مجهول بلا قناة ⇒ WAIT/SUPPRESSED anonymous (الحالة تبقى مفتوحة)", () => {
    const d = decide([ev("checkout_start", "s1", { product: null, ts: NOW - 10 * MIN, meta: { subtotal: 250 } })], baseCtx({ customerPhone: null }), {
      caseType: "CHECKOUT_STARTED",
      identity: "anonymous",
    });
    expect(d.decision).toBe("WAIT");
    expect(d.customerState).toBe("CHECKOUT_STARTED");
    expect(d.contactReason).toBe("SUPPRESSED");
    expect(d.suppressionReason).toBe("anonymous");
    expect(d.shouldContact).toBe(false);
    expect(d.nextActionAt).toBeNull();
  });

  it("16. مبكر جدًا: قبل التذكير الأول (30د) ⇒ WAIT مع موعد التقييم التالي", () => {
    const d = decide(
      [ev("product_view", "s1", { product: "p1", ts: NOW - 8 * MIN })],
      baseCtx({ firstDetectedAt: NOW - 10 * MIN }),
      { identity: "logged_in" },
    );
    expect(d.decision).toBe("WAIT");
    expect(d.contactReason).toBe("WAITING");
    expect(d.customerState).toBe("BROWSING");
    expect(d.nextActionAt).toBe(NOW + 20 * MIN);
    expect(d.shouldContact).toBe(false);
  });

  it("17. لا أدلة صالحة ضمن النافذة ⇒ NO_ACTION/NO_VALID_SIGNAL (حالة انتظار)", () => {
    const d = decide([], baseCtx(), { identity: "logged_in" });
    expect(d.decision).toBe("NO_ACTION");
    expect(d.contactReason).toBe("NO_VALID_SIGNAL");
    expect(d.customerState).toBe("WAITING");
    expect(d.nextActionAt).toBeNull();
    expect(d.shouldContact).toBe(false);
  });

  it("18. بيانات متقادمة داخل المهلة (72س) ⇒ عقوبة الثقة تُحبس القرار: WAIT/LOW_CONFIDENCE", () => {
    const rows = [
      ev("product_view", "s1", { product: "p1", ts: NOW - 73 * H }),
      ev("checkout_start", "s1", { product: null, ts: NOW - 72 * H, meta: { subtotal: 250 } }),
    ];
    const d = decide(rows, baseCtx({ firstDetectedAt: NOW - 72 * H }), { caseType: "CHECKOUT_STARTED", identity: "anonymous" });
    expect(d.intentScore).toBe(10);
    expect(d.intentLevel).toBe("VERY_LOW");
    expect(d.confidenceScore).toBe(27);
    expect(d.confidenceLevel).toBe("LOW");
    expect(d.decision).toBe("WAIT");
    expect(d.contactReason).toBe("LOW_CONFIDENCE");
    expect(d.customerState).toBe("CHECKOUT_STARTED");
    expect(d.shouldContact).toBe(false);
  });

  it("19. استقلالية الترتيب: نفس الأدلة بترتيب معكوس ⇒ نفس القرار تمامًا", () => {
    const rows = [
      ev("product_view", "s1", { product: "p1", ts: NOW - 3 * H }),
      ev("product_view", "s2", { product: "p1", ts: NOW - 2 * H }),
      ev("add_to_cart", "s3", { product: "p1", ts: NOW - 70 * MIN }),
      ev("checkout_start", "s3", { product: null, ts: NOW - 50 * MIN, meta: { subtotal: 1500 } }),
      ev("payment_started", "s3", { product: null, ts: NOW - 40 * MIN }),
    ];
    const cx = baseCtx({ firstDetectedAt: NOW - 26 * H, messageCount: 1 });
    const forward = decide(rows, cx, { caseType: "PAYMENT_STARTED", identity: "logged_in" });
    const backward = decide([...rows].reverse(), cx, { caseType: "PAYMENT_STARTED", identity: "logged_in" });
    expect(backward).toEqual(forward);
  });

  it("20. حتمية بلا side effect: تكرار الاستدعاء بقيم مجمّدة ⇒ نفس النتيجة دون أي تغيير", () => {
    const rows = [
      ev("checkout_start", "s1", { product: null, ts: NOW - 10 * MIN, meta: { subtotal: 500 } }),
      ev("payment_started", "s1", { product: null, ts: NOW - 5 * MIN }),
    ];
    const cx = baseCtx({ status: "OPEN" });
    const snaphot = JSON.stringify(cx);
    Object.freeze(cx);
    const r = evaluateRecoveryIntelligence(rows, { caseType: "PAYMENT_STARTED", preferredProductId: "p1", caseCartValue: null, identity: "logged_in" }, cfg, { asOf: NOW });
    Object.freeze(r.evidence);
    Object.freeze(r.evidence.observations);
    Object.freeze(r.evidence.inference);
    Object.freeze(r.evidence.coverage);
    Object.freeze(r.intent);
    Object.freeze(r.confidence);
    const input = { evidence: r.evidence, intent: r.intent, confidence: r.confidence, context: cx, cfg };
    Object.freeze(input);

    const d1 = decideRecoveryAction(input);
    const d2 = decideRecoveryAction(input);
    expect(d2).toEqual(d1);
    expect(JSON.stringify(cx)).toBe(snaphot);
    expect(d1.decision).toBe("SEND_MARKETING_MESSAGE");
    expect(d1.customerState).toBe("HIGH_INTENT");
  });
});

describe("decision — خصائص ثابتة (invariants)", () => {
  it("أي قرار SEND/RECOMMEND يلزم: تواصل مسموح + ثقة ≥ MEDIUM + نية ≥ MEDIUM", () => {
    const scenarios: [AnalyticsEventRow[], DecisionCaseContext, Partial<IntelligenceContext>][] = [
      [
        [ev("checkout_start", "s1", { product: null, ts: NOW - 10 * MIN, meta: { subtotal: 250 } })],
        baseCtx(),
        { caseType: "CHECKOUT_STARTED", identity: "logged_in" },
      ],
      [
        [ev("payment_started", "s1", { product: null, ts: NOW - 15 * MIN })],
        { ...baseCtx(), preferredProductId: null },
        { caseType: "PAYMENT_STARTED", preferredProductId: null, caseCartValue: 1500, identity: "logged_in" },
      ],
    ];
    for (const [rows, cx, over] of scenarios) {
      const d = decide(rows, cx, over);
      expect(["SEND_MESSAGE", "SEND_PRODUCT_MESSAGE", "SEND_MARKETING_MESSAGE", "RECOMMEND_INCENTIVE"]).toContain(d.decision);
      expect(d.shouldContact).toBe(true);
      expect(d.contactReason).toBe("CONTACT_ALLOWED");
      expect(["MEDIUM", "HIGH"]).toContain(d.confidenceLevel);
      expect(["MEDIUM", "HIGH", "EXTREME"]).toContain(d.intentLevel);
    }
  });

  it("PURCHASED أو حالة مغلقة لا ينتجان SEND/INCENTIVE أبدًا", () => {
    const rows = [
      ev("product_view", "s1", { product: "p1", ts: NOW - 3 * H }),
      ev("product_view", "s2", { product: "p1", ts: NOW - 2 * H }),
      ev("add_to_cart", "s3", { product: "p1", ts: NOW - 70 * MIN }),
      ev("checkout_start", "s3", { product: null, ts: NOW - 50 * MIN, meta: { subtotal: 1500 } }),
      ev("payment_started", "s3", { product: null, ts: NOW - 40 * MIN }),
    ];
    for (const status of ["PURCHASED", "CANCELLED", "SUPPRESSED", "EXPIRED"] as const) {
      const d = decide(rows, baseCtx({ status }), { caseType: "PAYMENT_STARTED", identity: "logged_in" });
      expect(d.decision).toBe("STOP");
      expect(d.shouldContact).toBe(false);
      expect(d.shouldOfferIncentive).toBe(false);
    }
  });

  it("ثقة LOW لا تسمح بالتسويق البارد أو الحافز — قرار متحفّظ فقط", () => {
    const lowIntents: [AnalyticsEventRow[], Partial<IntelligenceContext>][] = [
      [[ev("checkout_start", "s1", { product: null, ts: NOW - 10 * MIN, meta: { subtotal: 500 } }), ev("payment_started", "s1", { product: null, ts: NOW - 5 * MIN })], { caseType: "PAYMENT_STARTED", preferredProductId: null, identity: "anonymous" }],
      [[ev("product_view", "s1", { product: "p1", ts: NOW - 131 * H }), ev("checkout_start", "s1", { product: null, ts: NOW - 130 * H, meta: { subtotal: 250 } })], { caseType: "CHECKOUT_STARTED", identity: "logged_in" }],
    ];
    for (const [rows, over] of lowIntents) {
      const d = decide(rows, baseCtx(), over);
      expect(d.confidenceLevel).toBe("LOW");
      expect(d.contactReason).toBe("LOW_CONFIDENCE");
      expect(d.decision).toBe("WAIT");
      expect(d.shouldOfferIncentive).toBe(false);
    }
  });

  it("بلا أدلة: لا HIGH_INTENT ولا INCENTIVE_CANDIDATE ولا قرار تواصل", () => {
    const d = decide([], baseCtx(), { identity: "logged_in" });
    expect(d.customerState).toBe("WAITING");
    expect(d.decision).toBe("NO_ACTION");
    expect(d.shouldContact).toBe(false);
    expect(d.shouldOfferIncentive).toBe(false);
  });

  it("نية عالية (HIGH) دون EXTREME لا تُنتج حافزًا أبدًا حتى مع اكتمال باقي الشروط", () => {
    const rows = [
      ev("checkout_start", "s1", { product: null, ts: NOW - 10 * MIN, meta: { subtotal: 1500 } }),
      ev("payment_started", "s1", { product: null, ts: NOW - 5 * MIN }),
    ];
    // intent ≈ 75 HIGH (لا EXTREME) — رغم سلة عالية وشروط الحافز
    const d = decide(rows, baseCtx({ firstDetectedAt: NOW - 26 * H, messageCount: 1 }), { caseType: "PAYMENT_STARTED", identity: "logged_in" });
    expect(d.intentLevel).toBe("HIGH");
    expect(d.decision).toBe("SEND_MARKETING_MESSAGE");
    expect(d.incentiveDecision).toBe("INCENTIVE_NOT_JUSTIFIED");
    expect(d.shouldOfferIncentive).toBe(false);
    expect(d.recommendedDiscount).toBeNull();
  });

  it("ذروة الحافز تبقى ترشيحًا: INCENTIVE_CANDIDATE لا يصنع كوبونًا ولا يعدّل الحالة", () => {
    const rows = [
      ev("product_view", "s1", { product: "p1", ts: NOW - 3 * H }),
      ev("product_view", "s2", { product: "p1", ts: NOW - 2 * H }),
      ev("add_to_cart", "s3", { product: "p1", ts: NOW - 70 * MIN }),
      ev("checkout_start", "s3", { product: null, ts: NOW - 50 * MIN, meta: { subtotal: 1500 } }),
      ev("payment_started", "s3", { product: null, ts: NOW - 40 * MIN }),
    ];
    const cx = baseCtx({ firstDetectedAt: NOW - 26 * H, messageCount: 1, status: "OPEN" as const });
    const d = decide(rows, cx, { caseType: "PAYMENT_STARTED", identity: "logged_in" });
    expect(d.decision).toBe("RECOMMEND_INCENTIVE");
    expect(cx.status).toBe("OPEN");
    expect(d.recommendedDiscount).toEqual({ percent: 10, cap: 50, value: 50 });
    expect("createdCoupon" in (d as never)).toBe(false);
    expect("couponRef" in (d as never)).toBe(false);
  });

  it("الحافز المتكرر ممنوع: آخر حافز قريب يبطل الترشيح مهما علت النية", () => {
    const rows = [
      ev("product_view", "s1", { product: "p1", ts: NOW - 3 * H }),
      ev("product_view", "s2", { product: "p1", ts: NOW - 2 * H }),
      ev("add_to_cart", "s3", { product: "p1", ts: NOW - 70 * MIN }),
      ev("checkout_start", "s3", { product: null, ts: NOW - 50 * MIN, meta: { subtotal: 1500 } }),
      ev("payment_started", "s3", { product: null, ts: NOW - 40 * MIN }),
    ];
    const d = decide(rows, baseCtx({ firstDetectedAt: NOW - 26 * H, messageCount: 1, lastDiscountAt: NOW - 10 * MIN }), {
      caseType: "PAYMENT_STARTED",
      identity: "logged_in",
    });
    expect(d.decision).toBe("SEND_MARKETING_MESSAGE");
    expect(d.incentiveDecision).toBe("INCENTIVE_NOT_JUSTIFIED");
    expect(d.shouldOfferIncentive).toBe(false);
  });

  it("التكرار الحرفي لا يرفع القرار: نسخ مكررة ⇒ نفس القرار والأدلة", () => {
    const rows = [
      ev("product_view", "s1", { product: "p1", ts: NOW - 3 * H }),
      ev("product_view", "s2", { product: "p1", ts: NOW - 2 * H }),
      ev("add_to_cart", "s3", { product: "p1", ts: NOW - 70 * MIN }),
      ev("checkout_start", "s3", { product: null, ts: NOW - 50 * MIN, meta: { subtotal: 1500 } }),
      ev("payment_started", "s3", { product: null, ts: NOW - 40 * MIN }),
    ];
    const cx = baseCtx({ firstDetectedAt: NOW - 26 * H, messageCount: 1 });
    const single = decide(rows, cx, { caseType: "PAYMENT_STARTED", identity: "logged_in" });
    const duplicated = decide([...rows, ...rows], cx, { caseType: "PAYMENT_STARTED", identity: "logged_in" });
    expect(duplicated).toEqual(single);
    expect(duplicated.decision).toBe("RECOMMEND_INCENTIVE");
  });

  it("مسارات الأولوية تُختبر صراحةً: كل قرار مطابق لموضعه في السلسلة", () => {
    // P0 purchase > كل شيء
    const purchase = decide([ev("purchase", "s1", { product: null, ts: NOW - 20 * MIN, meta: { value: 100 } })], baseCtx(), { identity: "logged_in" });
    expect(purchase.decision).toBe("STOP");
    // P1 anonymous > توقيت
    const anon = decide([ev("checkout_start", "s1", { product: null, ts: NOW - 10 * MIN, meta: { subtotal: 500 } })], baseCtx({ customerPhone: null }), {
      caseType: "CHECKOUT_STARTED",
      identity: "anonymous",
    });
    expect(anon.contactReason).toBe("SUPPRESSED");
    // P2 maxMessages > نية عالية
    const maxed = decide(
      [ev("payment_started", "s1", { product: null, ts: NOW - 5 * MIN }), ev("checkout_start", "s1", { product: null, ts: NOW - 10 * MIN, meta: { subtotal: 1000 } })],
      baseCtx({ messageCount: 3 }),
      { caseType: "PAYMENT_STARTED", identity: "logged_in" },
    );
    expect(maxed.decision).toBe("STOP");
    expect(maxed.suppressionReason).toBe("max_messages");
    // P5 مبكر > نية منخفضة (يسبق NO_ACTION)
    const early = decide(
      [ev("product_view", "s1", { product: "p1", ts: NOW - 8 * MIN })],
      baseCtx({ firstDetectedAt: NOW - 10 * MIN }),
      { identity: "logged_in" },
    );
    expect(early.contactReason).toBe("WAITING");
  });

  it("المخرجات كاملة وقابلة للشرح: كل قرار يحمل النية والثقة والأسباب", () => {
    const rows = [
      ev("checkout_start", "s1", { product: null, ts: NOW - 10 * MIN, meta: { subtotal: 250 } }),
    ];
    const d = decide(rows, baseCtx(), { caseType: "CHECKOUT_STARTED", identity: "logged_in" });
    expect(typeof d.reason).toBe("string");
    expect(d.reason.length).toBeGreaterThan(0);
    expect(Array.isArray(d.reasons)).toBe(true);
    expect(d.reasons.length).toBeGreaterThan(0);
    const allStates: CustomerState[] = d.customerState ? [d.customerState] : [];
    expect(allStates.every((s) => (CUSTOMER_STATES as readonly string[]).includes(s))).toBe(true);
    const allDecisions: RecoveryDecisionValue[] = d.decision ? [d.decision] : [];
    expect(allDecisions.every((v) => (RECOVERY_DECISIONS as readonly string[]).includes(v))).toBe(true);
  });
});
/**
 * G2 — اختبارات طبقة التسويق (القرار ← استراتيجية ← قالب ← رسالة ← توصية).
 *
 * المبدأ: التوصية «تُقرر ما يُرسل» فقط — بلا إرسال ولا إنشاء كوبون ولا كتابة.
 * القرارات تأتي من محرك القرار الحقيقي (نفس سيناريوهات decision.test.ts)
 * لتثبيت أن القالب/الاستراتيجية تُشتق من القرار لا من المرحلة وحدها.
 *
 * Fixtures محلية فقط: لا أي اتصال بقاعدة البيانات.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_RECOVERY_CONFIG } from "./config";
import { evaluateRecoveryIntelligence, type AnalyticsEventRow, type IntelligenceContext } from "./evidence";
import { decideRecoveryAction, type DecisionCaseContext, type RecoveryDecision } from "./decision";
import {
  CTAS,
  INCENTIVE_MODES,
  MARKETING_STRATEGIES,
  MARKETING_TEMPLATES,
  MESSAGE_TYPES,
  marketingCatalogIntegrity,
  recommendMarketingAction,
  templateIntegrity,
  unprovenClaims,
  type MarketingInput,
  type MarketingTemplate,
} from "./marketing";
import type { RecoveryCouponView } from "./types";

/** قسيمة كاملة كما تنتجها البوابة — لا شكل ناقص (الإنواع ترفضه). */
function couponView(code: string, over: Partial<RecoveryCouponView> = {}): RecoveryCouponView {
  return {
    code,
    type: "percent",
    value: 10,
    computedValue: 50,
    expiresAt: new Date(NOW + 48 * H).toISOString(),
    ...over,
  };
}

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

/** السلسلة الحقيقية الكاملة: أدلة ← نية/ثقة ← قرار ← مدخل للتوصية التسويقية. */
function scenario(rows: AnalyticsEventRow[], cx: DecisionCaseContext, over: Partial<IntelligenceContext> = {}, values: Record<string, string> = {}): MarketingInput {
  const ic: IntelligenceContext = { caseType: "ADD_TO_CART", preferredProductId: "p1", caseCartValue: null, identity: "anonymous", ...over };
  const r = evaluateRecoveryIntelligence(rows, ic, cfg, { asOf: NOW });
  const decision = decideRecoveryAction({ evidence: r.evidence, intent: r.intent, confidence: r.confidence, context: cx, cfg });
  return { decision, evidence: r.evidence, intent: r.intent, confidence: r.confidence, values, stage: null };
}

const FULL_VALUES: Record<string, string> = {
  "customer.name": "نورة",
  "product.name": "حقيبة ميني",
  "product.slug": "mini-bag",
  "cart.value": "420",
  "links.cart": "/cart",
  "links.checkout": "/checkout",
  "links.product": "/product/mini-bag",
  "links.support": "https://wa.me/966500000000",
};

// ---------- صفوف السيناريوهات (مطابقة ل decision.test.ts) ----------

const REPEATED_ROWS = [
  ev("product_view", "s1", { product: "p1", ts: NOW - 40 * MIN }),
  ev("product_view", "s2", { product: "p1", ts: NOW - 36 * MIN }),
  ev("product_view", "s3", { product: "p1", ts: NOW - 32 * MIN }),
  ev("product_view", "s4", { product: "p1", ts: NOW - 28 * MIN }),
  ev("product_view", "s5", { product: "p1", ts: NOW - 25 * MIN }),
];

const CART_ROWS = [
  ev("product_view", "s1", { product: "p1", ts: NOW - 40 * MIN }),
  ev("product_view", "s2", { product: "p1", ts: NOW - 36 * MIN }),
  ev("product_view", "s3", { product: "p1", ts: NOW - 32 * MIN }),
  ev("product_view", "s4", { product: "p1", ts: NOW - 28 * MIN }),
  ev("product_view", "s5", { product: "p1", ts: NOW - 26 * MIN }),
  ev("add_to_cart", "s5", { product: "p1", ts: NOW - 25 * MIN }),
];

const CHECKOUT_ROWS = [
  ev("product_view", "s1", { product: "p1", ts: NOW - 40 * MIN }),
  ev("add_to_cart", "s1", { product: "p1", ts: NOW - 30 * MIN }),
  ev("checkout_start", "s1", { product: null, ts: NOW - 10 * MIN, meta: { subtotal: 250 } }),
];

const HIGH_ROWS = [
  ev("product_view", "s1", { product: "p1", ts: NOW - 3 * H }),
  ev("product_view", "s2", { product: "p1", ts: NOW - 2 * H }),
  ev("product_view", "s3", { product: "p1", ts: NOW - 90 * MIN }),
  ev("add_to_cart", "s4", { product: "p1", ts: NOW - 70 * MIN }),
  ev("add_to_cart", "s3", { product: "p1", ts: NOW - 60 * MIN }),
  ev("checkout_start", "s3", { product: null, ts: NOW - 15 * MIN, meta: { subtotal: 420 } }),
];

const PRODUCT_ROWS = [ev("payment_started", "s1", { product: null, ts: NOW - 15 * MIN })];

const INCENTIVE_ROWS = [
  ev("product_view", "s1", { product: "p1", ts: NOW - 3 * H }),
  ev("product_view", "s2", { product: "p1", ts: NOW - 2 * H }),
  ev("add_to_cart", "s3", { product: "p1", ts: NOW - 70 * MIN }),
  ev("checkout_start", "s3", { product: null, ts: NOW - 50 * MIN, meta: { subtotal: 1500 } }),
  ev("payment_started", "s3", { product: null, ts: NOW - 40 * MIN }),
];

const PURCHASED_ROWS = [
  ev("checkout_start", "s1", { product: null, ts: NOW - 30 * MIN, meta: { subtotal: 350 } }),
  ev("purchase", "s1", { product: null, ts: NOW - 20 * MIN, meta: { value: 350 } }),
];

const LOWCONF_ROWS = [
  ev("checkout_start", "s1", { product: null, ts: NOW - 10 * MIN, meta: { subtotal: 500 } }),
  ev("payment_started", "s1", { product: null, ts: NOW - 5 * MIN }),
];

const CHECKOUT_NO_CART_ROWS = [
  ev("product_view", "s1", { product: "p1", ts: NOW - 40 * MIN }),
  ev("product_view", "s2", { product: "p1", ts: NOW - 35 * MIN }),
  ev("add_to_cart", "s2", { product: "p1", ts: NOW - 30 * MIN }),
  ev("checkout_start", "s2", { product: null, ts: NOW - 10 * MIN, meta: {} }),
];

describe("marketing — المخزّنات والنزاهة", () => {
  it("مجموعات الاستراتيجيات والأنواع وCTAs وأوضاع الحافز مغلقة وبلا إضافات", () => {
    expect(MARKETING_STRATEGIES).toEqual([
      "NO_ACTION",
      "LIGHT_REMINDER",
      "PRODUCT_INTEREST",
      "CART_RECOVERY",
      "CHECKOUT_RECOVERY",
      "HIGH_INTENT_MARKETING",
      "INCENTIVE_CANDIDATE",
      "CUSTOMER_ASSISTANCE",
    ]);
    expect(MESSAGE_TYPES).toHaveLength(7);
    for (const mt of ["none", "reminder", "product", "checkout", "marketing", "incentive", "assistance"]) {
      expect(MESSAGE_TYPES).toContain(mt);
    }
    expect(CTAS).toEqual(["NONE", "VISIT_CART", "VIEW_PRODUCT", "COMPLETE_CHECKOUT", "CONTACT_SUPPORT"]);
    expect(INCENTIVE_MODES).toEqual(["NONE", "RECOMMENDED", "REQUIRED_BEFORE_SEND"]);
    expect(INCENTIVE_MODES).not.toContain("CREATED");
  });

  it("الكتالوج المضمّن سليم بالكامل: مفاتيح فريدة، صيغ عربية صالحة، بلا ادعاءات", () => {
    const c = marketingCatalogIntegrity();
    expect(c.ok).toBe(true);
    expect(c.failures).toEqual([]);

    const keys = MARKETING_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);

    for (const t of MARKETING_TEMPLATES) {
      expect(MARKETING_STRATEGIES).toContain(t.strategy);
      expect(MESSAGE_TYPES).toContain(t.messageType);
      expect(CTAS).toContain(t.cta);
      expect(t.variants.length).toBeGreaterThan(0);
      for (const body of t.variants) {
        expect(unprovenClaims(body)).toEqual([]);
        expect(body.length).toBeGreaterThan(0);
      }
    }
  });

  it("الادعاءات بلا بيانات ممنوعة: تصنّف كل الأنماط الشائعة", () => {
    expect(unprovenClaims("خصم 10% الآن")).toContain("خصم");
    expect(unprovenClaims("توصلك قيمة مخفضة")).toContain("قيمة مخفضة");
    expect(unprovenClaims("لفترة محدودة فقط")).toContain("ينفد");
    expect(unprovenClaims("آخر فرصة")).toContain("آخر فرصة");
    expect(unprovenClaims("الأكثر مبيعًا لدينا")).toContain("الطلب كبير / الأكثر مبيعًا");
    expect(unprovenClaims("شحن مجاني")).toContain("شحن مجاني");
    expect(unprovenClaims("مرحبًا، اطلب الآن من الرابط")).toEqual([]);
  });

  it("قالب معطوب يُفشِل فحص النزاهة ويذكر مكانه بالعربية", () => {
    const broken: MarketingTemplate = {
      key: "broken",
      nameAr: "معطل",
      strategy: "PRODUCT_INTEREST",
      messageType: "product",
      cta: "VIEW_PRODUCT",
      requires: { product: true },
      tokenRequirements: ["product.name"],
      variants: ["مرحبًا {{discount.code}}"],
    };
    const t = templateIntegrity(broken);
    expect(t.ok).toBe(false);
    expect(t.errors.join("، ")).toContain("product.name");
    expect(marketingCatalogIntegrity([broken]).ok).toBe(false);
  });
});

describe("marketing — القرار ← الاستراتيجية (عبر محرك القرار الحقيقي)", () => {
  it("LOW_INTENT/تصفّح بسيط ⇒ NO_ACTION بلا رسالة ولا fallback عشوائي", () => {
    const rec = recommendMarketingAction(scenario([ev("product_view", "s1", { product: "p1", ts: NOW - 40 * MIN })], baseCtx(), { identity: "logged_in" }));
    expect(rec.strategy).toBe("NO_ACTION");
    expect(rec.shouldSend).toBe(false);
    expect(rec.blockedReason).toBe("decision_no_action");
    expect(rec.templateKey).toBeNull();
    expect(rec.messageType).toBe("none");
    expect(rec.cta).toBeNull();
    expect(rec.body).toBeNull();
    expect(rec.variantIndex).toBeNull();
    expect(rec.incentiveMode).toBe("NONE");
  });

  it("اهتمام متكرر بلا شراء (SEND_MESSAGE/REPEATED_INTEREST) ⇒ PRODUCT_INTEREST/repeated_interest", () => {
    const rec = recommendMarketingAction(scenario(REPEATED_ROWS, baseCtx(), { identity: "logged_in", caseType: "ADD_TO_CART" }, FULL_VALUES));
    expect(rec.strategy).toBe("PRODUCT_INTEREST");
    expect(rec.shouldSend).toBe(true);
    expect(rec.templateKey).toBe("repeated_interest");
    expect(rec.messageType).toBe("product");
    expect(rec.cta).toBe("VIEW_PRODUCT");
    expect(rec.blockedReason).toBeNull();
  });

  it("سلة منشأة (SEND_MESSAGE/CART_CREATED) ⇒ CART_RECOVERY/cart_recovery", () => {
    const rec = recommendMarketingAction(scenario(CART_ROWS, baseCtx(), { identity: "logged_in", caseType: "ADD_TO_CART" }, FULL_VALUES));
    expect(rec.strategy).toBe("CART_RECOVERY");
    expect(rec.shouldSend).toBe(true);
    expect(rec.templateKey).toBe("cart_recovery");
    expect(rec.messageType).toBe("reminder");
    expect(rec.cta).toBe("VISIT_CART");
  });

  it("إتمام (SEND_MESSAGE/CHECKOUT_STARTED) ⇒ CHECKOUT_RECOVERY/checkout_completion", () => {
    const rec = recommendMarketingAction(scenario(CHECKOUT_ROWS, baseCtx(), { caseType: "CHECKOUT_STARTED", identity: "logged_in" }, FULL_VALUES));
    expect(rec.strategy).toBe("CHECKOUT_RECOVERY");
    expect(rec.shouldSend).toBe(true);
    expect(rec.templateKey).toBe("checkout_completion");
    expect(rec.messageType).toBe("checkout");
    expect(rec.cta).toBe("COMPLETE_CHECKOUT");
  });

  it("نية عالية (SEND_MARKETING_MESSAGE/HIGH_INTENT) ⇒ HIGH_INTENT_MARKETING/high_intent", () => {
    const cx = baseCtx({ firstDetectedAt: NOW - 3 * H });
    const rec = recommendMarketingAction(scenario(HIGH_ROWS, cx, { caseType: "CHECKOUT_STARTED", identity: "logged_in" }, FULL_VALUES));
    expect(rec.strategy).toBe("HIGH_INTENT_MARKETING");
    expect(rec.shouldSend).toBe(true);
    expect(rec.templateKey).toBe("high_intent");
    expect(rec.messageType).toBe("marketing");
    expect(rec.cta).toBe("COMPLETE_CHECKOUT");
    expect(rec.nextActionAt).toBe(NOW + 3 * H);
  });

  it("رسالة منتج بلا منتج معروف (SEND_PRODUCT_MESSAGE) ⇒ محجوبة product_missing", () => {
    const cx = baseCtx({ preferredProductId: null });
    const rec = recommendMarketingAction(
      scenario(PRODUCT_ROWS, cx, { caseType: "PAYMENT_STARTED", preferredProductId: null, caseCartValue: 1500, identity: "logged_in" }, {}),
    );
    expect(rec.strategy).toBe("PRODUCT_INTEREST");
    expect(rec.shouldSend).toBe(false);
    expect(rec.blockedReason).toBe("product_missing");
    expect(rec.templateKey).toBeNull();
    expect(rec.body).toBeNull();
  });

  it("ترشيح الحافز بلا كوبون فعلي ⇒ لا إرسال إطلاقًا (REQUIRED_BEFORE_SEND) بالصياغة المطلوبة", () => {
    const cx = baseCtx({ firstDetectedAt: NOW - 26 * H, messageCount: 1 });
    const rec = recommendMarketingAction(scenario(INCENTIVE_ROWS, cx, { caseType: "PAYMENT_STARTED", identity: "logged_in" }, FULL_VALUES));
    expect(rec.strategy).toBe("INCENTIVE_CANDIDATE");
    expect(rec.shouldSend).toBe(false);
    expect(rec.templateKey).toBeNull();
    expect(rec.messageType).toBe("marketing");
    expect(rec.cta).toBeNull();
    expect(rec.body).toBeNull();
    expect(rec.incentiveMode).toBe("REQUIRED_BEFORE_SEND");
    expect(rec.blockedReason).toBe("incentive_required_before_send");
    expect(rec.reason).toBe("Decision engine recommends incentive but no real coupon is available.");
    expect(String(rec.title)).toBe("");
  });

  it("ترشيح الحافز مع قسيمة فعلية ⇒ يُعرض الكود ولا يُذكر نسبة ولا مبلغ", () => {
    const cx = baseCtx({ firstDetectedAt: NOW - 26 * H, messageCount: 1 });
    const rec = recommendMarketingAction({
      ...scenario(INCENTIVE_ROWS, cx, { caseType: "PAYMENT_STARTED", identity: "logged_in" }, FULL_VALUES),
      coupon: couponView("R50"),
    });
    expect(rec.strategy).toBe("INCENTIVE_CANDIDATE");
    expect(rec.shouldSend).toBe(true);
    expect(rec.templateKey).toBe("incentive_candidate");
    expect(rec.messageType).toBe("incentive");
    expect(rec.incentiveMode).toBe("RECOMMENDED");
    expect(rec.blockedReason).toBeNull();
    // G6-C: الكود يظهر فعلًا (وإلا رفضه الحارس)، بلا نسبة ولا مبلغ، وبلا رموز.
    expect(rec.body).toContain("R50");
    expect(rec.body).not.toMatch(/\d+\s*%/);
    expect(rec.body).not.toMatch(/\{\{/);
  });

  it("عميل اشترى (STOP/PURCHASED) ⇒ لا رسالة أبدًا (blockedReason purchased)", () => {
    const rec = recommendMarketingAction(scenario(PURCHASED_ROWS, baseCtx(), { caseType: "PAYMENT_STARTED", identity: "logged_in" }, FULL_VALUES));
    expect(rec.strategy).toBe("NO_ACTION");
    expect(rec.shouldSend).toBe(false);
    expect(rec.blockedReason).toBe("purchased");
    expect(rec.templateKey).toBeNull();
    expect(rec.body).toBeNull();
  });

  it("ثقة منخفضة عبر المحرك (WAIT/LOW_CONFIDENCE) ⇒ قرار انتظار لا رسالة", () => {
    const rec = recommendMarketingAction(scenario(LOWCONF_ROWS, baseCtx(), { caseType: "PAYMENT_STARTED", preferredProductId: null, identity: "anonymous" }, FULL_VALUES));
    expect(rec.shouldSend).toBe(false);
    expect(rec.blockedReason).toBe("decision_wait");
    expect(rec.body).toBeNull();
  });
});

describe("marketing — حواجز fail-safe", () => {
  it("دفاع ثانٍ: ثقة منخفضة لا تُرسل تسويقًا قويًا حتى لو وصل SEND_MARKETING", () => {
    const cx = baseCtx({ firstDetectedAt: NOW - 3 * H });
    const base = scenario(HIGH_ROWS, cx, { caseType: "CHECKOUT_STARTED", identity: "logged_in" }, FULL_VALUES);
    const low = {
      ...haHighConfidenceDecision(base),
      confidence: { score: 32, level: "LOW" as const, reasons: [], reason: "" },
    };
    const rec = recommendMarketingAction(low);
    expect(rec.strategy).toBe("HIGH_INTENT_MARKETING");
    expect(rec.shouldSend).toBe(false);
    expect(rec.blockedReason).toBe("low_confidence");
    expect(rec.body).toBeNull();
  });

  it("إتمام/سلة بلا بيانات سلة + رابط مساعدة ⇒ CUSTOMER_ASSISTANCE (مساعدة حقيقية لا ادعاء «محفوظة»)", () => {
    const cx = baseCtx({ firstDetectedAt: NOW - 40 * MIN });
    const rec = recommendMarketingAction(scenario(CHECKOUT_NO_CART_ROWS, cx, { caseType: "CHECKOUT_STARTED", identity: "logged_in" }, { "links.support": "https://wa.me/966500000000" }));
    expect(rec.strategy).toBe("CUSTOMER_ASSISTANCE");
    expect(rec.shouldSend).toBe(true);
    expect(rec.templateKey).toBe("customer_assistance");
    expect(rec.messageType).toBe("assistance");
    expect(rec.cta).toBe("CONTACT_SUPPORT");
    expect(rec.body).not.toContain("سلتك محفوظة");
  });

  it("إتمام/سلة بلا بيانات سلة وبلا مساعدة ⇒ محجوبة cart_data_missing", () => {
    const cx = baseCtx({ firstDetectedAt: NOW - 40 * MIN });
    const rec = recommendMarketingAction(scenario(CHECKOUT_NO_CART_ROWS, cx, { caseType: "CHECKOUT_STARTED", identity: "logged_in" }, {}));
    expect(rec.shouldSend).toBe(false);
    expect(rec.blockedReason).toBe("cart_data_missing");
    expect(rec.body).toBeNull();
  });

  it("قالب غير مفعّل ⇒ لا إرسال (template_inactive)", () => {
    const cx = baseCtx({ firstDetectedAt: NOW - 3 * H });
    const base = scenario(HIGH_ROWS, cx, { caseType: "CHECKOUT_STARTED", identity: "logged_in" }, FULL_VALUES);
    const inactive: MarketingTemplate[] = MARKETING_TEMPLATES.map((t) => (t.key === "high_intent" ? { ...t, isActive: false } : t));
    const rec = recommendMarketingAction({ ...base, templates: inactive });
    expect(rec.shouldSend).toBe(false);
    expect(rec.blockedReason).toBe("template_inactive");
    expect(rec.body).toBeNull();
  });

  it("قالب مفقود (كتالوج فارغ) ⇒ لا إرسال (template_missing) بلا أي بديل عشوائي", () => {
    const cx = baseCtx({ firstDetectedAt: NOW - 3 * H });
    const base = scenario(HIGH_ROWS, cx, { caseType: "CHECKOUT_STARTED", identity: "logged_in" }, FULL_VALUES);
    const rec = recommendMarketingAction({ ...base, templates: [] });
    expect(rec.shouldSend).toBe(false);
    expect(rec.blockedReason).toBe("template_missing");
    expect(rec.templateKey).toBeNull();
    expect(rec.body).toBeNull();
  });

  it("قالب بلا CTA للاستراتيجية الملزمة ⇒ cta_missing", () => {
    const cx = baseCtx({ firstDetectedAt: NOW - 3 * H });
    const base = scenario(HIGH_ROWS, cx, { caseType: "CHECKOUT_STARTED", identity: "logged_in" }, FULL_VALUES);
    const noCta: MarketingTemplate[] = MARKETING_TEMPLATES.map((t) => (t.key === "high_intent" ? { ...t, cta: "NONE" } : t));
    const rec = recommendMarketingAction({ ...base, templates: noCta });
    expect(rec.shouldSend).toBe(false);
    expect(rec.blockedReason).toBe("cta_missing");
  });

  it("متغير غير معروف في القالب ⇒ قالب معطوب لا يُبنى منه نص (template_invalid + اسم المتغير)", () => {
    const cx = baseCtx({ firstDetectedAt: NOW - 3 * H });
    const base = scenario(HIGH_ROWS, cx, { caseType: "CHECKOUT_STARTED", identity: "logged_in" }, FULL_VALUES);
    const broken: MarketingTemplate[] = MARKETING_TEMPLATES.map((t) =>
      t.key === "high_intent" ? { ...t, variants: ["مرحبًا {{customer.name}} — رمزك الخاص: {{unknown.token}}"] } : t,
    );
    const rec = recommendMarketingAction({ ...base, templates: broken });
    expect(rec.shouldSend).toBe(false);
    expect(rec.blockedReason).toBe("template_invalid");
    expect(rec.reasons.join("، ")).toContain("unknown.token");
  });

  it("وعد خصم في قالب الحافز مع كوبون فعلي لا يُرسل: الادعاء بلا بيان صادق ممنوع", () => {
    const cx = baseCtx({ firstDetectedAt: NOW - 26 * H, messageCount: 1 });
    const base = scenario(INCENTIVE_ROWS, cx, { caseType: "PAYMENT_STARTED", identity: "logged_in" }, FULL_VALUES);
    const claims: MarketingTemplate[] = MARKETING_TEMPLATES.map((t) =>
      t.key === "incentive_candidate" ? { ...t, variants: ["{{customer.name}}، خصم 10% بانتظارك اليوم فقط ليتم طلبك"] } : t,
    );
    const rec = recommendMarketingAction({ ...base, templates: claims, coupon: couponView("R50") });
    expect(rec.shouldSend).toBe(false);
    expect(rec.blockedReason).toBe("template_invalid");
    expect(rec.reasons.join("، ")).toContain("خصم");
  });

  it("بلا اسم حقيقي لا يُخترع اسم: يقع البديل الآمن «عميلنا» بدل تخصيص وهمي", () => {
    const rec = recommendMarketingAction(
      scenario(CART_ROWS, baseCtx(), { identity: "logged_in", caseType: "ADD_TO_CART" }, { "cart.value": "420", "links.cart": "/cart" }),
    );
    expect(rec.shouldSend).toBe(true);
    expect(rec.body).toContain("عميلنا");
    expect(rec.body).not.toContain("نورة");
    expect(rec.body).not.toMatch(/\{\{/);
  });

  it("التحميل النهائي يُتقن هندسة المتغيرات: لا بقايا {{}} في النص النهائي", () => {
    const cx = baseCtx({ firstDetectedAt: NOW - 3 * H });
    const rec = recommendMarketingAction(scenario(HIGH_ROWS, cx, { caseType: "CHECKOUT_STARTED", identity: "logged_in" }, FULL_VALUES));
    expect(rec.shouldSend).toBe(true);
    expect(rec.body).toBeTruthy();
    expect(String(rec.body)).not.toMatch(/\{\{/);
    expect(String(rec.body).length).toBeGreaterThan(0);
    expect(String(rec.body)).toContain("/checkout");
    expect(typeof rec.reason).toBe("string");
  });

  it("حتمية تامة: نفس المدخلات تعطي نفس التوصية ونفس صياغة الـ variant", () => {
    const cx = baseCtx({ firstDetectedAt: NOW - 3 * H });
    const base = scenario(HIGH_ROWS, cx, { caseType: "CHECKOUT_STARTED", identity: "logged_in" }, FULL_VALUES);
    const a = recommendMarketingAction(base);
    const b = recommendMarketingAction(base);
    expect(b).toEqual(a);
    expect(a.variantIndex).not.toBeNull();
    const tpl = MARKETING_TEMPLATES.find((t) => t.key === a.templateKey);
    expect(a.variantIndex).toBeGreaterThanOrEqual(0);
    expect(a.variantIndex).toBeLessThan(tpl!.variants.length);
  });

  it("التوصية لا تحمل أي حقل إرسال/كتابة: بلا كوبون مخلوق ولا delivery ولا queue", () => {
    const cx = baseCtx({ firstDetectedAt: NOW - 3 * H });
    const rec = recommendMarketingAction(scenario(HIGH_ROWS, cx, { caseType: "CHECKOUT_STARTED", identity: "logged_in" }, FULL_VALUES)) as Record<string, unknown>;
    expect(rec).not.toHaveProperty("couponCode");
    expect(rec).not.toHaveProperty("createdCoupon");
    expect(rec).not.toHaveProperty("deliveryId");
    expect(rec).not.toHaveProperty("queued");
    expect(rec).not.toHaveProperty("inserted");
  });
});

/** إعادة بناء مدخل بتعويم قرار صناعي فوق قرار حقيقي (لاختبار الدفاعات فقط). */
function haHighConfidenceDecision(base: MarketingInput): MarketingInput {
  return {
    ...base,
    decision: { ...base.decision, confidenceLevel: "HIGH", confidenceScore: 100, decision: "SEND_MARKETING_MESSAGE" } as RecoveryDecision,
  };
}
/**
 * G4 — اختبارات تكامل السلسلة الجديدة على الـruntime القائم.
 *
 *   Evidence → Intent → Confidence → Decision → Marketing → Execution Guard
 *   → ContactOutcome (adapter) → RecoveryDispatcher الموجود
 *
 * كل اختبار يبني أدلة حقيقية (صفوف analytics_events) ويمرّرها عبر الكود نفسه
 * الذي يمرّ به الـcron: لا قيم مخترعة للمسار، ولا أي إرسال حقيقي. البوابة
 * الوهمية تسجّل ما *فُرض* عليها فقط (notification/delivery)، والتسوية تُختبر
 * بحالة التسليم الفعلية (sent/failed) كما يقرؤها qr-server.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_RECOVERY_CONFIG } from "./config";
import type { RecoveryConfig } from "./config";
import { buildRecoveryEvidence } from "./evidence";
import type { AnalyticsEventRow } from "./evidence";
import { runRecoveryPipeline } from "./pipeline";
import { InMemoryRecoveryStore } from "./store";
import {
  RECOVERY_CONTACT_TYPE,
  RecoveryDispatcher,
  deterministicNotificationId,
} from "./dispatcher";
import type {
  CreateContactResult,
  RecoveryContactGateway,
  RecoveryContactPayload,
  RecoveryDeliveryRow,
} from "./dispatcher";
import type { DispatchTemplate } from "./dispatch-message";
import type { RecoveryStage } from "./stages";
import type { RecoveryCase, RecoveryCouponView } from "./types";

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const HOUR = 3_600_000;
const PHONE = "966500000001";

/** G6-C: قسيمة حقيقية جاهزة للاختبار (ما تنتجه البوابة فعليًا). */
function couponView(code: string, over: Partial<RecoveryCouponView> = {}): RecoveryCouponView {
  return { code, type: "percent", value: 10, computedValue: 50, expiresAt: null, ...over };
}

function cfgWith(over: Partial<RecoveryConfig> = {}): RecoveryConfig {
  return { ...DEFAULT_RECOVERY_CONFIG, enabled: true, dryRun: false, ...over };
}

function caseFixture(over: Partial<RecoveryCase> = {}): RecoveryCase {
  return {
    id: "case-1",
    customerId: "cust-1",
    customerPhone: PHONE,
    visitorId: "visitor-1",
    sessionId: "session-1",
    caseType: "ADD_TO_CART",
    status: "OPEN",
    score: 25,
    cartValue: 600,
    productIds: ["p-1"],
    preferredProductId: "p-1",
    preferredProductSlug: "gold-ring",
    firstDetectedAt: NOW - 8 * HOUR,
    lastActivityAt: NOW,
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
    createdAt: NOW - 8 * HOUR,
    updatedAt: NOW,
    ...over,
  };
}

type Row = { type: string; session?: string; product?: string | null; at?: number; subtotal?: number };

/** صفوف analytics_events حقيقية (نفس أعمدة migration-016) بلا أي تسمية مفتعلة. */
function rows(list: Row[]): AnalyticsEventRow[] {
  return list.map((r, i) => ({
    id: `e-${i + 1}`,
    visitor_id: "visitor-1",
    session_id: r.session ?? "s-1",
    event_type: r.type,
    product_id: r.product === undefined ? "p-1" : r.product,
    product_slug: "gold-ring",
    metadata: r.subtotal === undefined ? {} : { subtotal: r.subtotal },
    created_at: r.at ?? NOW,
  }));
}

/** قراءة الأدلة كما يقرأها الراوت: analytics_events فقط، بلا هوية مخترَعة. */
function evidenceReader(list: Row[]) {
  const data = rows(list);
  return async ({ asOf }: { asOf: number }) =>
    buildRecoveryEvidence(data, { asOf, identity: "logged_in", preferredProductId: "p-1" }, cfgWith());
}

/** البوابة الوهمية: تسجّل ما فُرض فقط. لا WhatsApp ولا شبكة. */
class FakeGateway implements RecoveryContactGateway {
  readonly created: RecoveryContactPayload[] = [];
  deliveries: RecoveryDeliveryRow[] = [];
  templates: DispatchTemplate[] = [];
  private ids = new Set<string>();

  async createWhatsAppContact(payload: RecoveryContactPayload): Promise<CreateContactResult> {
    if (this.ids.has(payload.notificationId)) return { created: false, duplicate: true };
    this.ids.add(payload.notificationId);
    this.created.push(payload);
    // يحاكي createDeliveries: صف واتساب مضاف بلا sent.
    this.deliveries.push({
      deliveryId: `d-${this.deliveries.length + 1}`,
      notificationId: payload.notificationId,
      caseId: payload.caseId,
      channel: "whatsapp",
      status: "pending",
      sentAt: null,
      expectedMessageCount: payload.expectedMessageCount,
    });
    return { created: true, duplicate: false };
  }

  async listRecoveryCaseIds(): Promise<string[]> {
    return [...new Set(this.deliveries.map((d) => d.caseId))];
  }

  async listRecoveryDeliveries(caseIds: string[]): Promise<RecoveryDeliveryRow[]> {
    return this.deliveries.filter((d) => caseIds.includes(d.caseId));
  }

  async readTemplates(ids: number[]): Promise<DispatchTemplate[]> {
    return this.templates.filter((t) => t.id !== null && ids.includes(t.id));
  }
}

type RunOpts = {
  cfg?: RecoveryConfig;
  cases?: RecoveryCase[];
  evidence?: Row[];
  store?: InMemoryRecoveryStore;
  gateway?: FakeGateway;
  /** G6-C: قسيمة حقيقية (عرض كامل) أو null صراحةً. */
  coupon?: RecoveryCouponView | null;
  hasCompletedOrder?: (phone: string) => Promise<boolean>;
  stages?: RecoveryStage[];
};

async function runCycle(opts: RunOpts = {}) {
  const cfg = opts.cfg ?? cfgWith();
  const store = opts.store ?? new InMemoryRecoveryStore();
  for (const c of opts.cases ?? [caseFixture()]) await store.create(c);
  const gateway = opts.gateway ?? new FakeGateway();
  const pipeline = await runRecoveryPipeline({
    cfg,
    store,
    gateway,
    readEvidence: evidenceReader(opts.evidence ?? []),
    hasCompletedOrder: opts.hasCompletedOrder,
    resolveCoupon: opts.coupon === undefined ? undefined : () => opts.coupon ?? null,
    now: () => NOW,
  });
  return { cfg, store, gateway, pipeline };
}

/** يشغّل الـdispatcher الموجود بنفس لحظة الدورة — بلا أي مسار إرسال جديد. */
function dispatchWith(cycle: Awaited<ReturnType<typeof runCycle>>) {
  const dispatcher = new RecoveryDispatcher(cycle.store, cycle.gateway, cycle.cfg, () => NOW);
  return dispatcher;
}

describe("G4 — سلسلة الاسترجاع الجديدة على الـruntime القائم", () => {
  it("1) browsing → لا إجراء ولا إرسال", async () => {
    const { pipeline } = await runCycle({
      cases: [caseFixture({ caseType: "ADD_TO_CART", cartValue: null, productIds: [], preferredProductId: null })],
      evidence: [{ type: "product_view" }],
    });
    const r = pipeline.results[0];
    expect(r.customerState).toBe("BROWSING");
    expect(r.recoveryDecision).toBe("NO_ACTION");
    expect(r.marketing.shouldSend).toBe(false);
    expect(r.outcome.wouldSend).toBe(false);
    expect(pipeline.counters.allowed).toBe(0);
    expect(pipeline.counters.blockedBy.NO_ACTION).toBe(1);
  });

  it("2) اهتمام متكرر → توصية رسالة منتج", async () => {
    const { pipeline } = await runCycle({
      cases: [caseFixture({ caseType: "ADD_TO_CART", cartValue: 200 })],
      evidence: [
        { type: "product_view", session: "s-1" },
        { type: "product_view", session: "s-2" },
        { type: "product_view", session: "s-3" },
        { type: "product_view", session: "s-4" },
      ],
    });
    const r = pipeline.results[0];
    expect(r.customerState).toBe("REPEATED_INTEREST");
    expect(r.recoveryDecision).toBe("SEND_MESSAGE");
    expect(r.marketing.strategy).toBe("PRODUCT_INTEREST");
    expect(r.marketing.templateKey).toBe("repeated_interest");
    expect(r.outcome.wouldSend).toBe(true);
    expect(r.guard.allowed).toBe(true);
  });

  it("3) سلة → استرجاع سلة", async () => {
    const { pipeline } = await runCycle({
      cases: [caseFixture({ caseType: "ADD_TO_CART", cartValue: 1600 })],
      evidence: [
        { type: "product_view", session: "s-1" },
        { type: "product_view", session: "s-2" },
        { type: "product_view", session: "s-3" },
        { type: "add_to_cart", session: "s-3" },
      ],
    });
    const r = pipeline.results[0];
    expect(r.customerState).toBe("CART_CREATED");
    expect(r.marketing.strategy).toBe("CART_RECOVERY");
    expect(r.marketing.templateKey).toBe("cart_recovery");
    expect(r.outcome.wouldSend).toBe(true);
  });

  it("4) إتمام → استرجاع إتمام", async () => {
    const { pipeline } = await runCycle({
      cases: [caseFixture({ caseType: "CHECKOUT_STARTED", cartValue: 900 })],
      evidence: [
        { type: "product_view", session: "s-1" },
        { type: "add_to_cart", session: "s-1" },
        { type: "checkout_start", session: "s-1", subtotal: 900 },
      ],
    });
    const r = pipeline.results[0];
    expect(r.customerState).toBe("CHECKOUT_STARTED");
    expect(r.marketing.strategy).toBe("CHECKOUT_RECOVERY");
    expect(r.marketing.templateKey).toBe("checkout_completion");
    expect(r.outcome.wouldSend).toBe(true);
  });

  it("5) نية عالية → رسالة تسويق", async () => {
    const { pipeline } = await runCycle({
      cases: [caseFixture({ caseType: "PAYMENT_STARTED", cartValue: 900 })],
      evidence: [
        { type: "product_view", session: "s-1" },
        { type: "product_view", session: "s-1" },
        { type: "payment_started", session: "s-1" },
      ],
    });
    const r = pipeline.results[0];
    expect(r.intentLevel).toBe("HIGH");
    expect(r.confidenceLevel).toBe("HIGH");
    expect(r.recoveryDecision).toBe("SEND_MARKETING_MESSAGE");
    expect(r.marketing.strategy).toBe("HIGH_INTENT_MARKETING");
    expect(r.outcome.wouldSend).toBe(true);
  });

  it("6) نية شديدة + مؤهلات → ترشيح حافز (بلا إنشاء كوبون)", async () => {
    const extreme = {
      cases: [caseFixture({ caseType: "PAYMENT_STARTED", cartValue: 2000, messageCount: 1, firstDetectedAt: NOW - 30 * HOUR, createdAt: NOW - 30 * HOUR })],
      evidence: [
        { type: "product_view", session: "s-1" },
        { type: "product_view", session: "s-2" },
        { type: "add_to_cart", session: "s-2" },
        { type: "checkout_start", session: "s-2", subtotal: 2000 },
        { type: "payment_started", session: "s-2" },
      ],
    };

    const blocked = await runCycle(extreme);
    const r = blocked.pipeline.results[0];
    expect(r.intentLevel).toBe("EXTREME");
    expect(r.confidenceLevel).toBe("HIGH");
    expect(r.customerState).toBe("INCENTIVE_CANDIDATE");
    expect(r.recoveryDecision).toBe("RECOMMEND_INCENTIVE");
    expect(r.marketing.strategy).toBe("INCENTIVE_CANDIDATE");
    // لا كوبون في gold-store ⇒ لا رسالة حافز. لا يُنشأ شيء.
    expect(r.marketing.incentiveMode).toBe("REQUIRED_BEFORE_SEND");
    expect(r.outcome.wouldSend).toBe(false);
    expect(r.guard.allowed).toBe(false);

    // ومع قسيمة حقيقية فقط: يمر الإذن بلا أي إنشاء داخل الـpipeline.
    const allowed = await runCycle({ ...extreme, coupon: couponView("GIFT10") });
    const ok = allowed.pipeline.results[0];
    expect(ok.marketing.shouldSend).toBe(true);
    expect(ok.guard.allowed).toBe(true);
    expect(ok.outcome.decision).toBe("DISCOUNT_ELIGIBLE");
    // الحافز اقتراح رقمي داخلي: لا coupon_ref ولا كود في الإدراج.
    expect(ok.outcome.recommendedDiscount).not.toBeNull();
  });

  it("7) ثقة منخفضة (بيانات ناقصة) → لا تنفيذ", async () => {
    const { pipeline } = await runCycle({
      // حالة بلا منتج ولا قيمة سلة وبلا أي إشارة إقدام: البيانات لا تكفي للتسويق.
      cases: [caseFixture({ caseType: "ADD_TO_CART", cartValue: null, productIds: [], preferredProductId: null, preferredProductSlug: null })],
      evidence: [{ type: "remove_from_cart", session: "s-1", product: null }],
    });
    const r = pipeline.results[0];
    expect(r.confidenceLevel).toBe("LOW");
    expect(r.recoveryDecision).toBe("WAIT");
    expect(r.contactReason).toBe("LOW_CONFIDENCE");
    expect(r.outcome.wouldSend).toBe(false);
  });

  it("8) تواصل حديث → لا تنفيذ (cooldown عام)", async () => {
    const { pipeline } = await runCycle({
      cases: [caseFixture({ lastMessageAt: NOW - HOUR })],
      evidence: [
        { type: "product_view", session: "s-1" },
        { type: "add_to_cart", session: "s-1" },
        { type: "checkout_start", session: "s-1", subtotal: 900 },
      ],
    });
    const r = pipeline.results[0];
    expect(r.recoveryDecision).toBe("WAIT");
    expect(r.contactReason).toBe("RECENT_CONTACT");
    expect(r.outcome.wouldSend).toBe(false);
  });

  it("9) شراء مُثبت بالأدلة → لا تنفيذ بعد الشراء", async () => {
    const { pipeline } = await runCycle({
      cases: [caseFixture({ caseType: "CHECKOUT_STARTED", cartValue: 900 })],
      evidence: [
        { type: "product_view", session: "s-1" },
        { type: "add_to_cart", session: "s-1" },
        { type: "checkout_start", session: "s-1", subtotal: 900 },
        { type: "purchase", session: "s-1", subtotal: 900 },
      ],
    });
    const r = pipeline.results[0];
    expect(r.recoveryDecision).toBe("STOP");
    expect(r.customerState).toBe("PURCHASED");
    expect(r.guard.allowed).toBe(false);
    expect(pipeline.counters.blockedBy.PURCHASED).toBe(1);
    expect(pipeline.outcomes.some((o) => o.wouldSend)).toBe(false);
  });

  it("10) بلا رقم → لا تنفيذ", async () => {
    const { pipeline } = await runCycle({
      cases: [caseFixture({ customerPhone: null })],
      evidence: [
        { type: "product_view", session: "s-1" },
        { type: "add_to_cart", session: "s-1" },
        { type: "checkout_start", session: "s-1", subtotal: 900 },
      ],
    });
    const r = pipeline.results[0];
    expect(r.recoveryDecision).toBe("WAIT");
    expect(r.outcome.wouldSend).toBe(false);
    expect(pipeline.outcomes.every((o) => !o.wouldSend)).toBe(true);
  });

  it("11) رقم غير صالح دوليًا → لا تنفيذ", async () => {
    const { pipeline } = await runCycle({
      cases: [caseFixture({ caseType: "CHECKOUT_STARTED", cartValue: 900, customerPhone: "12345" })],
      evidence: [
        { type: "product_view", session: "s-1" },
        { type: "add_to_cart", session: "s-1" },
        { type: "checkout_start", session: "s-1", subtotal: 900 },
      ],
    });
    const r = pipeline.results[0];
    expect(r.marketing.shouldSend).toBe(true);
    expect(r.guard.allowed).toBe(false);
    if (!r.guard.allowed) expect(r.guard.reason).toBe("INVALID_PHONE");
    expect(pipeline.counters.blockedBy.INVALID_PHONE).toBe(1);
  });

  it("12) قالب المرحلة مفقود → لا تنفيذ (بلا fallback عشوائي)", async () => {
    const stages: RecoveryStage[] = [{ ...DEFAULT_RECOVERY_CONFIG.stages[0], templateId: 999 }];
    const { pipeline } = await runCycle({
      cfg: cfgWith({ stages }),
      cases: [caseFixture({ caseType: "CHECKOUT_STARTED", cartValue: 900 })],
      evidence: [
        { type: "product_view", session: "s-1" },
        { type: "add_to_cart", session: "s-1" },
        { type: "checkout_start", session: "s-1", subtotal: 900 },
      ],
    });
    const r = pipeline.results[0];
    expect(r.marketing.shouldSend).toBe(true);
    expect(r.guard.allowed).toBe(false);
    if (!r.guard.allowed) expect(r.guard.reason).toBe("TEMPLATE_MISSING");
    expect(r.block?.stage).toBe("render");
    expect(pipeline.counters.renderBlocked).toBe(1);
  });

  it("13) حافز مطلوب بلا كوبون → لا تنفيذ", async () => {
    const { pipeline } = await runCycle({
      cases: [caseFixture({ caseType: "PAYMENT_STARTED", cartValue: 2000, messageCount: 1, firstDetectedAt: NOW - 30 * HOUR, createdAt: NOW - 30 * HOUR })],
      evidence: [
        { type: "product_view", session: "s-1" },
        { type: "product_view", session: "s-2" },
        { type: "add_to_cart", session: "s-2" },
        { type: "checkout_start", session: "s-2", subtotal: 2000 },
        { type: "payment_started", session: "s-2" },
      ],
    });
    const r = pipeline.results[0];
    if (!r.guard.allowed) expect(r.guard.reason).toBe("INCENTIVE_REQUIRED");
    expect(pipeline.counters.blockedBy.INCENTIVE_REQUIRED).toBe(1);
    expect(pipeline.outcomes.every((o) => o.wouldSend === false)).toBe(true);
  });

  it("14) dryRun: السلسلة تعمل ولا يحدث أي أثر", async () => {
    const cfg = cfgWith({ dryRun: true });
    const cycle = await runCycle({
      cfg,
      cases: [caseFixture({ caseType: "CHECKOUT_STARTED", cartValue: 900 })],
      evidence: [
        { type: "product_view", session: "s-1" },
        { type: "add_to_cart", session: "s-1" },
        { type: "checkout_start", session: "s-1", subtotal: 900 },
      ],
    });
    const r = cycle.pipeline.results[0];

    // الأدلة والنية والثقة والقرار والتسويق تقيّمت كلها...
    expect(r.intentScore).toBeGreaterThan(0);
    expect(r.confidenceLevel).not.toBe("LOW");
    expect(r.marketing.shouldSend).toBe(true);

    // ...لكن الحارس يغلق كل شيء.
    expect(r.guard.allowed).toBe(false);
    if (!r.guard.allowed) expect(r.guard.reason).toBe("DRY_RUN");
    expect(cycle.pipeline.counters.allowed).toBe(0);

    // ولا أثر: لا إدراج ولا delivery ولا تدخل ولا ترقية عدّاد.
    const summary = await dispatchWith(cycle).dispatch(cycle.pipeline.cases, cycle.pipeline.outcomes);
    expect(summary.queued).toBe(0);
    expect(summary.considered).toBe(0);
    expect(cycle.gateway.created).toHaveLength(0);
    expect(cycle.gateway.deliveries).toHaveLength(0);
    const settled = await dispatchWith(cycle).settle();
    expect(settled.sent).toBe(0);
    expect((await cycle.store.listInterventions(["case-1"])).get("case-1")).toBeUndefined();
    const after = (await cycle.store.findByIds(["case-1"])).get("case-1");
    expect(after?.messageCount).toBe(0);
    expect(after?.lastMessageAt).toBeNull();
  });

  it("15) recovery معطّل → لا تنفيذ ولا جدولة", async () => {
    const cfg = cfgWith({ enabled: false });
    const cycle = await runCycle({
      cfg,
      cases: [caseFixture({ caseType: "CHECKOUT_STARTED", cartValue: 900 })],
      evidence: [
        { type: "product_view", session: "s-1" },
        { type: "add_to_cart", session: "s-1" },
        { type: "checkout_start", session: "s-1", subtotal: 900 },
      ],
    });
    const r = cycle.pipeline.results[0];
    if (!r.guard.allowed) expect(r.guard.reason).toBe("RECOVERY_DISABLED");
    expect(cycle.pipeline.counters.allowed).toBe(0);
    const summary = await dispatchWith(cycle).dispatch(cycle.pipeline.cases, cycle.pipeline.outcomes);
    expect(summary.queued).toBe(0);
    expect(cycle.gateway.created).toHaveLength(0);
  });

  it("16) تكرار: دورة ثانية لنفس الحالة لا تُنشئ رسالة ثانية", async () => {
    const cycle = await runCycle({
      cases: [caseFixture({ caseType: "CHECKOUT_STARTED", cartValue: 900 })],
      evidence: [
        { type: "product_view", session: "s-1" },
        { type: "add_to_cart", session: "s-1" },
        { type: "checkout_start", session: "s-1", subtotal: 900 },
      ],
    });
    const dispatcher = dispatchWith(cycle);
    const first = await dispatcher.dispatch(cycle.pipeline.cases, cycle.pipeline.outcomes);
    expect(first.queued).toBe(1);
    const keyA = firstQueuedKey(cycle.pipeline);
    expect(keyA).not.toBeNull();

    // الدورة التالية: نفس الحالة ونفس messageCount (بلا تسوية بعد).
    const second = await runCycle({
      cfg: cycle.cfg,
      store: cycle.store,
      gateway: cycle.gateway,
      cases: [],
      evidence: [
        { type: "product_view", session: "s-1" },
        { type: "add_to_cart", session: "s-1" },
        { type: "checkout_start", session: "s-1", subtotal: 900 },
      ],
    });
    // الحارس نفسه يوقف التكرار: رسالة غير مسوّاة في الطريق.
    const r2 = second.pipeline.results[0];
    expect(r2.guard.allowed).toBe(false);
    if (!r2.guard.allowed) expect(r2.guard.reason).toBe("ALREADY_IN_FLIGHT");
    expect(second.pipeline.counters.allowed).toBe(0);

    // ولو مرّ الحارس someday، فمفتاح الإدراج الحتمي يبقى الحارس الأخير (23505).
    const again = await dispatcher.dispatch(second.pipeline.cases, second.pipeline.outcomes);
    expect(again.queued).toBe(0);
    expect(again.considered).toBe(0);
    expect(cycle.gateway.created).toHaveLength(1);
    expect(cycle.gateway.created[0].notificationId).toBe(deterministicNotificationId("case-1", 0));
  });

  it("17) سباق الشراء: إغلاق الحالة بعد قراءتها يمنع الإرسال", async () => {
    const store = new InMemoryRecoveryStore();
    const c = caseFixture({ caseType: "CHECKOUT_STARTED", cartValue: 900 });
    await store.create(c);
    // القراءة الثانية (findByIds) ترى حالة أُغلقت بالشراء أثناء الدورة.
    const raced: RecoveryCaseStoreLike = {
      listActive: async () => [c],
      findByIds: async (ids) => new Map(ids.map((id) => [id, { ...c, status: "PURCHASED", purchaseRef: "order-1", completedAt: NOW }])),
    };
    const pipeline = await runRecoveryPipeline({
      cfg: cfgWith(),
      store: raced,
      gateway: new FakeGateway(),
      readEvidence: evidenceReader([
        { type: "product_view", session: "s-1" },
        { type: "add_to_cart", session: "s-1" },
        { type: "checkout_start", session: "s-1", subtotal: 900 },
      ]),
      now: () => NOW,
    });
    const r = pipeline.results[0];
    expect(r.case.status).toBe("PURCHASED");
    expect(r.guard.allowed).toBe(false);
    if (!r.guard.allowed) expect(r.guard.reason).toBe("PURCHASED");
    expect(pipeline.outcomes.every((o) => !o.wouldSend)).toBe(true);
  });

  it("18) المسار الناجح: الـdispatcher الموجود وحده (نفس المفتاح ونفس النص)", async () => {
    const cycle = await runCycle({
      cases: [caseFixture({ caseType: "CHECKOUT_STARTED", cartValue: 900 })],
      evidence: [
        { type: "product_view", session: "s-1" },
        { type: "add_to_cart", session: "s-1" },
        { type: "checkout_start", session: "s-1", subtotal: 900 },
      ],
    });
    const summary = await dispatchWith(cycle).dispatch(cycle.pipeline.cases, cycle.pipeline.outcomes);
    expect(summary.queued).toBe(1);
    expect(cycle.gateway.created).toHaveLength(1);

    const created = cycle.gateway.created[0];
    // مفتاح حتمي ونوع مطابقان تمامًا لمسار الإرسال القائم.
    expect(created.notificationId).toBe(deterministicNotificationId("case-1", 0));
    expect(RECOVERY_CONTACT_TYPE).toBe("recovery.contact");
    expect(created.expectedMessageCount).toBe(1);
    expect(created.phone).toBe(PHONE);
    expect(created.actionUrl).toBe("/cart");

    // ما فحصه الحارس هو ما أُدرج — لا نصّان.
    const r = cycle.pipeline.results[0];
    if (r.guard.allowed) {
      expect(created.message).toBe(r.guard.message);
      expect(created.title).toBe(r.guard.title);
    }

    // الإدراج ليس إرسالًا.
    const interventions = await cycle.store.listInterventions(["case-1"]);
    expect(interventions.get("case-1") ?? []).toHaveLength(0);
    const after = (await cycle.store.findByIds(["case-1"])).get("case-1");
    expect(after?.messageCount).toBe(0);
    expect(after?.lastMessageAt).toBeNull();
  });

  it("19) تسليم فاشل → لا تدخل ولا ترقية عدّاد", async () => {
    const cycle = await runCycle({
      cases: [caseFixture({ caseType: "CHECKOUT_STARTED", cartValue: 900 })],
      evidence: [
        { type: "product_view", session: "s-1" },
        { type: "add_to_cart", session: "s-1" },
        { type: "checkout_start", session: "s-1", subtotal: 900 },
      ],
    });
    const dispatcher = dispatchWith(cycle);
    await dispatcher.dispatch(cycle.pipeline.cases, cycle.pipeline.outcomes);
    cycle.gateway.deliveries = [
      {
        deliveryId: "d-1",
        notificationId: deterministicNotificationId("case-1", 0),
        caseId: "case-1",
        channel: "whatsapp",
        status: "failed",
        sentAt: null,
        expectedMessageCount: 1,
      },
    ];

    const settled = await dispatcher.settle();
    expect(settled.sent).toBe(0);
    expect(settled.failed).toBe(1);
    expect((await cycle.store.listInterventions(["case-1"])).get("case-1") ?? []).toHaveLength(0);
    const after = (await cycle.store.findByIds(["case-1"])).get("case-1");
    expect(after?.messageCount).toBe(0);
    expect(after?.lastMessageAt).toBeNull();
  });

  it("20) تسليم مؤكد sent → تسوية مرة واحدة فقط", async () => {
    const cycle = await runCycle({
      cases: [caseFixture({ caseType: "CHECKOUT_STARTED", cartValue: 900 })],
      evidence: [
        { type: "product_view", session: "s-1" },
        { type: "add_to_cart", session: "s-1" },
        { type: "checkout_start", session: "s-1", subtotal: 900 },
      ],
    });
    const dispatcher = dispatchWith(cycle);
    await dispatcher.dispatch(cycle.pipeline.cases, cycle.pipeline.outcomes);
    const sentAt = NOW + 5000;
    cycle.gateway.deliveries = [
      {
        deliveryId: "d-1",
        notificationId: deterministicNotificationId("case-1", 0),
        caseId: "case-1",
        channel: "whatsapp",
        status: "sent",
        sentAt,
        expectedMessageCount: 1,
      },
    ];

    const settled = await dispatcher.settle();
    expect(settled.sent).toBe(1);
    const interventions = (await cycle.store.listInterventions(["case-1"])).get("case-1") ?? [];
    expect(interventions).toHaveLength(1);
    expect(interventions[0].channel).toBe("whatsapp");
    expect(interventions[0].couponRef).toBeNull();
    const after = (await cycle.store.findByIds(["case-1"])).get("case-1");
    expect(after?.messageCount).toBe(1);
    expect(after?.lastMessageAt).toBe(sentAt);

    // دورة تسوية ثانية = لا تكرار.
    const again = await dispatcher.settle();
    expect(again.sent).toBe(0);
    expect((await cycle.store.listInterventions(["case-1"])).get("case-1") ?? []).toHaveLength(1);
    expect((await cycle.store.findByIds(["case-1"])).get("case-1")?.messageCount).toBe(1);
  });
});

/** نوع الردّ الذي يحتاجه pipeline للقراءة فقط. */
type RecoveryCaseStoreLike = {
  listActive: () => Promise<RecoveryCase[]>;
  findByIds: (ids: string[]) => Promise<Map<string, RecoveryCase>>;
};

/** مفتاح idempotency من أول حالة سمح لها الـGuard. */
function firstQueuedKey(pipeline: { results: { guard: { allowed: boolean; idempotencyKey: string | null } }[] }): string | null {
  for (const r of pipeline.results) if (r.guard.allowed) return r.guard.idempotencyKey;
  return null;
}

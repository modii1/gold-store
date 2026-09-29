/**
 * G3 — اختبارات Execution Guard (الإذن بالتنفيذ قبل مسار الإرسال الموجود).
 *
 * المبدأ: الـ Guard طبقة نقية تقرر «هل مسموح الإرسال الآن؟» فقط —
 * لا إرسال، لا notification، لا delivery، لا كوبون، لا كتابة حالة.
 * كل الاختبارات Fixtures محلية: لا أي اتصال بقاعدة بيانات ولا أي شبكة.
 *
 * حالات الـ 22 للقبول (بلا إرسال حقيقي إطلاقًا):
 *  NO_ACTION · LOW_CONFIDENCE · PURCHASED · SUPPRESSED · no phone ·
 *  invalid phone · recent contact · message limit · missing template ·
 *  invalid template · incentive required · dryRun بلا side effects ·
 *  disabled · enabled+valid ⇒ allowed · duplicate · concurrent ⇒ لا تكرار ·
 *  purchase race · valid ⇒ dispatcher الموجود فقط · settlement بعد إرسال فعلي فقط ·
 *  failed delivery بلا intervention كاذبة · unknown variable · ادعاء خصم غير مدعوم.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_RECOVERY_CONFIG } from "./config";
import type { RecoveryConfig } from "./config";
import type { MarketingRecommendation } from "./marketing";
import {
  EXECUTION_CHANNEL,
  buildDispatchPlan,
  buildExecutionIdempotencyKey,
  guardExecution,
} from "./execution-guard";
import type { ExecutionCaseState, ExecutionGuardInput } from "./execution-guard";
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
import { InMemoryRecoveryStore } from "./store";
import type { ContactOutcome, RecoveryCase, RecoveryCouponView } from "./types";

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const MIN = 60_000;
const HOUR = 3_600_000;

/** G6-C: قسيمة حقيقية مكتملة العرض — الكود وحده لم يعد كافيًا. */
function couponView(code: string, over: Partial<RecoveryCouponView> = {}): RecoveryCouponView {
  return { code, type: "percent", value: 10, computedValue: 34.9, expiresAt: null, ...over };
}

function baseCfg(over: Partial<RecoveryConfig> = {}): RecoveryConfig {
  return { ...DEFAULT_RECOVERY_CONFIG, enabled: true, dryRun: false, ...over };
}

function baseCase(over: Partial<ExecutionCaseState> = {}): ExecutionCaseState {
  return {
    id: "case-1",
    status: "OPEN",
    customerId: "cust-1",
    customerPhone: "966500000001",
    messageCount: 0,
    lastMessageAt: null,
    purchaseRef: null,
    completedAt: null,
    ...over,
  };
}

function baseRec(over: Partial<MarketingRecommendation> = {}): MarketingRecommendation {
  return {
    strategy: "CART_RECOVERY",
    shouldSend: true,
    templateKey: "cart_recovery",
    messageType: "reminder",
    cta: "VISIT_CART",
    reason: "استرجاع السلة — العودة للسلة (صيغة 1/2)",
    reasons: ["القرار: SEND_MESSAGE (CART_CREATED)"],
    incentiveMode: "NONE",
    nextActionAt: null,
    blockedReason: null,
    body: "سارة، لا تزال السلة التي بدأت بتجهيزها في انتظارك 🛒\nإن أردت المتابعة، يمكنك الرجوع إليها من هنا:\n/cart",
    variantIndex: 0,
    title: "استرجاع السلة",
    ...over,
  };
}

function guard(input: Partial<ExecutionGuardInput> = {}) {
  return guardExecution({
    recommendation: input.recommendation ?? baseRec(),
    caseState: input.caseState ?? baseCase(),
    cfg: input.cfg ?? baseCfg(),
    now: NOW,
    ...input,
  });
}

// ---------------------------------------------------------------
// حالات المنع الخمس عشرة — كل سبب يُفحص باستقلال
// ---------------------------------------------------------------

describe("execution guard — أسباب المنع", () => {
  it("1) NO_ACTION: قرار بلا إجراء لا يُرسَل ولا يُخترع تسويق", () => {
    const d = guard({
      recommendation: baseRec({
        shouldSend: false,
        blockedReason: "decision_no_action",
        templateKey: null,
        cta: null,
        body: null,
        variantIndex: null,
        title: "",
      }),
    });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe("NO_ACTION");
    expect(d.message).toBeNull();
    expect(d.channel).toBeNull();
  });

  it("2) LOW_CONFIDENCE: ثقة منخفضة تمنع الإرسال حتى لو وصل القرار", () => {
    const d = guard({
      recommendation: baseRec({
        shouldSend: false,
        blockedReason: "low_confidence",
        templateKey: null,
        cta: null,
        body: null,
        variantIndex: null,
        title: "",
      }),
    });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe("LOW_CONFIDENCE");
  });

  it("3) PURCHASED: حالة شراء نهائية — لا رسالة بعد الشراء", () => {
    const d = guard({ caseState: baseCase({ status: "PURCHASED" }) });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe("PURCHASED");
  });

  it("4) SUPPRESSED: حالة مغلقة/ممنوعة — لا إرسال", () => {
    const d = guard({ caseState: baseCase({ status: "SUPPRESSED" }) });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe("SUPPRESSED");
    const expired = guard({ caseState: baseCase({ status: "EXPIRED" }) });
    expect(expired.allowed).toBe(false);
    if (!expired.allowed) expect(expired.reason).toBe("SUPPRESSED");
  });

  it("5) NO_PHONE: حالة بلا رقم أو بلا معرّف عميل", () => {
    const noPhone = guard({ caseState: baseCase({ customerPhone: null }) });
    expect(noPhone.allowed).toBe(false);
    if (!noPhone.allowed) expect(noPhone.reason).toBe("NO_PHONE");
    const noId = guard({ caseState: baseCase({ customerId: null }) });
    expect(noId.allowed).toBe(false);
    if (!noId.allowed) expect(noId.reason).toBe("NO_PHONE");
  });

  it("6) INVALID_PHONE: رقم لا يمر للصيغة الدولية السعودية", () => {
    const d = guard({ caseState: baseCase({ customerPhone: "12345" }) });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe("INVALID_PHONE");
  });

  it("7) RECENT_CONTACT: تواصل حديث — cooldown عام لم ينتهِ", () => {
    const d = guard({ caseState: baseCase({ lastMessageAt: NOW - 1 * HOUR }) });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe("RECENT_CONTACT");
  });

  it("8) MESSAGE_LIMIT: بلوغ الحد الأقصى (عام أو خاص بالمرحلة)", () => {
    const global = guard({ caseState: baseCase({ messageCount: 3 }) });
    expect(global.allowed).toBe(false);
    if (!global.allowed) expect(global.reason).toBe("MESSAGE_LIMIT");
    const staged = guard({
      caseState: baseCase({ messageCount: 1 }),
      stage: { key: "reminder_1", maxTotalMessages: 1 },
    });
    expect(staged.allowed).toBe(false);
    if (!staged.allowed) expect(staged.reason).toBe("MESSAGE_LIMIT");
  });

  it("9) TEMPLATE_MISSING: القالب المطلوب غير موجود في الكتالوج", () => {
    const d = guard({
      recommendation: baseRec({ templateKey: "ghost_template" }),
    });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe("TEMPLATE_MISSING");
  });

  it("10) TEMPLATE_INVALID: رسالة نهائية فارغة/متضخمة فوق الحد", () => {
    const empty = guard({ recommendation: baseRec({ body: "" }) });
    expect(empty.allowed).toBe(false);
    if (!empty.allowed) expect(empty.reason).toBe("TEMPLATE_INVALID");
    const long = guard({ recommendation: baseRec({ body: "x".repeat(2001) }) });
    expect(long.allowed).toBe(false);
    if (!long.allowed) expect(long.reason).toBe("TEMPLATE_INVALID");
  });

  it("11) INCENTIVE_REQUIRED: حافز بلا كوبون فعلي = لا إرسال أبدًا", () => {
    const refused = guard({
      recommendation: baseRec({
        strategy: "INCENTIVE_CANDIDATE",
        shouldSend: false,
        blockedReason: "incentive_required_before_send",
        incentiveMode: "REQUIRED_BEFORE_SEND",
        templateKey: null,
        cta: null,
        body: null,
        variantIndex: null,
        title: "",
      }),
    });
    expect(refused.allowed).toBe(false);
    if (!refused.allowed) expect(refused.reason).toBe("INCENTIVE_REQUIRED");

    // G6-D: فشل إنشاء القسيمة ⇒ INCENTIVE_UNAVAILABLE (لا إرسال حافز)
    const unavailable = guard({
      recommendation: baseRec({
        strategy: "INCENTIVE_CANDIDATE",
        shouldSend: false,
        blockedReason: "incentive_unavailable",
        incentiveMode: "REQUIRED_BEFORE_SEND",
        templateKey: null,
        cta: null,
        body: null,
        variantIndex: null,
        title: "",
      }),
    });
    expect(unavailable.allowed).toBe(false);
    if (!unavailable.allowed) expect(unavailable.reason).toBe("INCENTIVE_UNAVAILABLE");

    // حتى توصية «إرسال حافز» سليمة: بلا قسيمة تصل للـ Guard ⇒ ممنوع.
    const sendable = baseRec({
      strategy: "INCENTIVE_CANDIDATE",
      incentiveMode: "RECOMMENDED",
      templateKey: "incentive_candidate",
      messageType: "incentive",
      cta: "COMPLETE_CHECKOUT",
      body: "عميلنا، لديك استرداد بانتظارك لإتمام طلبك.\nاستخدم الكود GIFT10 عند الطلب.\n/checkout",
      title: "حافز بكود",
    });
    const noCoupon = guard({ recommendation: sendable });
    expect(noCoupon.allowed).toBe(false);
    if (!noCoupon.allowed) expect(noCoupon.reason).toBe("INCENTIVE_REQUIRED");
    const withCoupon = guard({ recommendation: sendable, coupon: couponView("GIFT10") });
    expect(withCoupon.allowed).toBe(true);
  });

  it("11b) قسيمة موجودة لكن الرسالة لا تعرض الكود ⇒ منع (وعد لا يُفي)", () => {
    const noCode = baseRec({
      strategy: "INCENTIVE_CANDIDATE",
      incentiveMode: "RECOMMENDED",
      templateKey: "incentive_candidate",
      messageType: "incentive",
      cta: "COMPLETE_CHECKOUT",
      body: "عميلنا، لديك استرداد بانتظارك لإتمام طلبك.\n/checkout",
      title: "حافز بلا كود",
    });
    const d = guard({ recommendation: noCode, coupon: couponView("GIFT10") });
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.reason).toBe("TEMPLATE_INVALID");
      expect(d.issues?.join(" ")).toContain("كود القسيمة غير ظاهر");
    }
  });

  it("12) DRY_RUN: وضع المعاينة يمنع أي إرسال مهما كان التقييم", () => {
    const d = guard({ cfg: baseCfg({ dryRun: true }) });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe("DRY_RUN");
    expect(d.message).toBeNull();
  });

  it("13) RECOVERY_DISABLED: النظام متوقف (enabled=false) = لا إرسال", () => {
    const d = guard({ cfg: baseCfg({ enabled: false }) });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe("RECOVERY_DISABLED");
  });
});

// ---------------------------------------------------------------
// الإذن + الحتمية + التكرار + المحتوى
// ---------------------------------------------------------------

describe("execution guard — الإذن والهوية والتكرار", () => {
  it("14) enabled+valid ⇒ allowed، بمفتاح idempotency حتمي وقناة whatsapp", () => {
    const d = guard({ caseState: baseCase({ messageCount: 1 }), recoveryDecision: "SEND_MESSAGE" });
    if (d.allowed) {
      expect(d.channel).toBe(EXECUTION_CHANNEL);
      expect(d.templateKey).toBe("cart_recovery");
      expect(d.message.length).toBeGreaterThan(0);
      expect(d.message).not.toContain("{{");
      expect(d.expectedMessageCount).toBe(2);

      // الحتمية: لحظات مختلفة ⇒ نفس المفتاح تمامًا.
      const later = guard({
        caseState: baseCase({ messageCount: 1 }),
        now: NOW + 999,
        recoveryDecision: "SEND_MESSAGE",
      });
      if (later.allowed) {
        expect(d.idempotencyKey).toBe(later.idempotencyKey);
        expect(buildExecutionIdempotencyKey({
          caseId: "case-1",
          messageCount: 1,
          templateKey: "cart_recovery",
          variantIndex: 0,
          recoveryDecision: "SEND_MESSAGE",
        })).toBe(d.idempotencyKey);
      }
    } else {
      // لا يجب أن تُمنع الحالة الصالحة.
      throw new Error(`guard حجب حالة صالحة بلا سبب: ${d.reason}`);
    }
  });

  it("15) DUPLICATE: نفس المفتاح سُجّل مسبقًا ⇒ لا إرسال مكرر", () => {
    const first = guard();
    expect(first.allowed).toBe(true);
    const idem = first.allowed ? first.idempotencyKey : "";
    const second = guard({ contact: { seenKeys: [idem] } });
    expect(second.allowed).toBe(false);
    if (!second.allowed) expect(second.reason).toBe("DUPLICATE");
  });

  it("16) CONCURRENT: تشغيلان متزامنان لنفس الحالة ينتجان نفس المفتاح ويمنعان التكرار", () => {
    const runA = guard();
    const runB = guard();
    expect(runA.allowed).toBe(true);
    expect(runB.allowed).toBe(true);
    if (runA.allowed && runB.allowed) {
      expect(runA.idempotencyKey).toBe(runB.idempotencyKey);
      // المشاركة: من رأى مفتاح A يرفض B (مثل دورة cron توازية).
      const second = guard({ contact: { seenKeys: [runA.idempotencyKey] } });
      expect(second.allowed).toBe(false);
      if (!second.allowed) expect(second.reason).toBe("DUPLICATE");
    }
  });

  it("17) PURCHASE RACE: شراء مُثبت قبل التنفيذ يمنع الإرسال حتى لو قال القرار أرسل", () => {
    const d = guard({
      caseState: baseCase({ status: "OPEN", purchased: true }),
    });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe("PURCHASED");
  });

  it("21) UNKNOWN VARIABLE: أي رمز متغير متبقٍ في النص النهائي يمنع الإرسال", () => {
    const d = guard({
      recommendation: baseRec({
        body: "أهلاً، استخدم كود {{coupon.code}} لإتمام طلبك:\n/checkout",
      }),
    });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe("TEMPLATE_INVALID");
  });

  it("22) UNSupported DISCOUNT CLAIM: ادعاء خصم/كوبون بلا بيانات حقيقية يمنع الإرسال", () => {
    const claim = guard({
      recommendation: baseRec({ body: "أكمل طلبك الآن بخصم 10%:\n/checkout" }),
    });
    expect(claim.allowed).toBe(false);
    if (!claim.allowed) expect(claim.reason).toBe("TEMPLATE_INVALID");
    const coupon = guard({
      recommendation: baseRec({ body: "لديك كوبون خصم بانتظارك:\n/checkout" }),
    });
    expect(coupon.allowed).toBe(false);
    if (!coupon.allowed) expect(coupon.reason).toBe("TEMPLATE_INVALID");
  });
});

// ---------------------------------------------------------------
// الربط بمسار الإرسال الموجود + التسوية الصحيحة
// ---------------------------------------------------------------

/** بوابة وهمية تطابق واجهة RecoveryContactGateway الموجود — بلا أي شبكة. */
class FakeGateway implements RecoveryContactGateway {
  created: RecoveryContactPayload[] = [];
  deliveries: RecoveryDeliveryRow[] = [];
  private seq = 0;

  async createWhatsAppContact(payload: RecoveryContactPayload): Promise<CreateContactResult> {
    if (this.created.some((c) => c.notificationId === payload.notificationId)) {
      return { created: false, duplicate: true };
    }
    this.created.push(payload);
    // يحاكي createDeliveries: صف تسليم pending يلتقطه qr-server.
    this.deliveries.push({
      deliveryId: `d${++this.seq}`,
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
    return [...new Set(this.created.map((c) => c.caseId))];
  }

  async listRecoveryDeliveries(caseIds: string[]): Promise<RecoveryDeliveryRow[]> {
    return this.deliveries.filter((d) => caseIds.includes(d.caseId));
  }

  async readTemplates(): Promise<DispatchTemplate[]> {
    return [];
  }
}

function makeCase(over: Partial<RecoveryCase> = {}): RecoveryCase {
  return {
    id: "case-1",
    customerId: "cust-1",
    customerPhone: "966500000001",
    visitorId: "v-1",
    sessionId: "s-1",
    caseType: "ADD_TO_CART",
    status: "OPEN",
    score: 50,
    cartValue: 200,
    productIds: ["p1"],
    preferredProductId: "p1",
    preferredProductSlug: "bag",
    firstDetectedAt: NOW - 40 * MIN,
    lastActivityAt: NOW - 10 * MIN,
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
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

const OUTCOME: ContactOutcome = {
  caseId: "case-1",
  decision: "REMINDER_ONLY",
  wouldSend: true,
  recommendedAction: "تذكير أول",
  recommendedDiscount: null,
  nextActionAt: null,
};

describe("execution guard — الربط بمسار الإرسال الموجود والتسوية", () => {
  it("18) valid message ⇒ يُنفَّذ عبر RecoveryDispatcher الموجود فقط (نفس المفتاح والجدول)", async () => {
    const allowed = guard();
    expect(allowed.allowed).toBe(true);
    if (!allowed.allowed) return;

    const plan = buildDispatchPlan(allowed, baseCase());
    // نفس مفتاح enqueue الحتمي ونفس نوع الإشعار والقناة في dispatcher الموجود.
    expect(plan.notificationType).toBe(RECOVERY_CONTACT_TYPE);
    expect(plan.notificationId).toBe(deterministicNotificationId("case-1", 0));
    expect(plan.channel).toBe("whatsapp");
    expect(plan.expectedMessageCount).toBe(1);

    // التنفيذ الفعلي عبر RecoveryDispatcher الموجود ببوابة وهمية (بلا شبكة).
    const store = new InMemoryRecoveryStore();
    await store.create(makeCase());
    const gateway = new FakeGateway();
    const dispatcher = new RecoveryDispatcher(store, gateway, baseCfg(), () => NOW);

    const first = await dispatcher.dispatch([makeCase()], [OUTCOME]);
    expect(first.queued).toBe(1);
    expect(gateway.created.length).toBe(1);
    expect(gateway.created[0].notificationId).toBe(deterministicNotificationId("case-1", 0));

    // دورة مكررة/متزامنة: لا مصدر إرسال ثانٍ ولا رسالة مكررة.
    const second = await dispatcher.dispatch([makeCase()], [OUTCOME]);
    expect(second.queued).toBe(0);
    expect(second.skippedAlreadyInFlight + second.skippedDuplicate).toBeGreaterThan(0);
  });

  it("19) settlement بعد إرسال فعلي فقط: الإدراج لا يُعدّ إرسالًا أبدًا", async () => {
    const store = new InMemoryRecoveryStore();
    await store.create(makeCase());
    const gateway = new FakeGateway();
    const dispatcher = new RecoveryDispatcher(store, gateway, baseCfg(), () => NOW);

    const summary = await dispatcher.dispatch([makeCase()], [OUTCOME]);
    expect(summary.queued).toBe(1);

    // الإدراج وحده (notification + delivery pending) ليس إثبات إرسال.
    expect((await store.listInterventions()).size).toBe(0);
    const caseAfterEnqueue = (await store.findByIds(["case-1"])).get("case-1");
    expect(caseAfterEnqueue?.messageCount).toBe(0);
    expect(caseAfterEnqueue?.lastMessageAt).toBeNull();

    // qr-server يؤكد التسليم (status='sent' + sent_at) ⇒ التسوية الآن فقط.
    gateway.deliveries = [];
    const sentAt = NOW + 5 * 1000;
    gateway.deliveries.push({
      deliveryId: "d-sent",
      notificationId: deterministicNotificationId("case-1", 0),
      caseId: "case-1",
      channel: "whatsapp",
      status: "sent",
      sentAt,
      expectedMessageCount: 1,
    });
    const settled = await dispatcher.settle();
    expect(settled.sent).toBe(1);

    const interventions = await store.listInterventions(["case-1"]);
    expect(interventions.get("case-1")?.length).toBe(1);
    const caseAfterSettle = (await store.findByIds(["case-1"])).get("case-1");
    expect(caseAfterSettle?.messageCount).toBe(1);
    expect(caseAfterSettle?.lastMessageAt).toBe(sentAt);
  });

  it("20) failed delivery ⇒ بلا intervention كاذبة وبلا ترقية عدّاد", async () => {
    const store = new InMemoryRecoveryStore();
    await store.create(makeCase());
    const gateway = new FakeGateway();
    const dispatcher = new RecoveryDispatcher(store, gateway, baseCfg(), () => NOW);

    await dispatcher.dispatch([makeCase()], [OUTCOME]);

    // فشل التسليم ليس إثبات إرسال — تُترك للآلية الحالية، ولا تُسجَّل استعادة.
    gateway.deliveries = [];
    gateway.deliveries.push({
      deliveryId: "d-failed",
      notificationId: deterministicNotificationId("case-1", 0),
      caseId: "case-1",
      channel: "whatsapp",
      status: "failed",
      sentAt: null,
      expectedMessageCount: 1,
    });
    const settled = await dispatcher.settle();
    expect(settled.failed).toBe(1);
    expect(settled.sent).toBe(0);

    expect((await store.listInterventions(["case-1"])).size).toBe(0);
    const unchanged = (await store.findByIds(["case-1"])).get("case-1");
    expect(unchanged?.messageCount).toBe(0);
    expect(unchanged?.lastMessageAt).toBeNull();
  });
});
/**
 * Phase 5–6 — محرك القرار: أدلة + نية + ثقة ← قرار خالص قابل للشرح.
 *
 * حدود صارمة:
 *  - لا يفعل شيئًا قبل القرار وبعده: لا إرسال، لا كوبون، لا كتابة، لا تغيير حالة.
 *  - لا يقرأ analytics_events ولا حالة النظام: المسؤول عنها طبقة الأدلة.
 *  - حتمي بالكامل: `now` يُمرَّر مدخلًا، لا وقت نظام ولا random ولا أي side effect.
 *
 * سلسلة الأولوية (لا تكسر قاعدة حماية أعلى بقاعدة لاحقة):
 *   PURCHASED / طلب مكتمل / حالة مغلقة / انتهاء مهلة → STOP
 *   مجهول الهوية (بلا قناة) → WAIT (الحالة تبقى مفتوحة)
 *   بلوغ الحد الأقصى للرسائل → STOP
 *   تواصل حديث (cooldown) → WAIT
 *   لا إشارة صالحة ضمن النافذة → NO_ACTION
 *   مبكر جدًا / بين المراحل   → WAIT
 *   ثقة منخفضة           → قرار متحفّظ (لا تسويق قوي)
 *   نية منخفضة           → NO_ACTION
 *   نية متوسطة           → رسالة المرحلة
 *   نية عالية            → تسويق
 *   نية شديدة + أدلة إتمام/دفع + ثقة عالية → ترشيح حافز (لا إنشاء)
 *
 * مبدأ الحافز: HIGH ≠ خصم تلقائي. الحافز يتطلب مجموعة شروط كاملة،
 * ونقص أي دليل مهم = لا حافز. الحافز هنا «ترشيح» فقط، لا إنشاء كوبون مطلقًا.
 */

import type { RecoveryConfig } from "./config";
import type { CaseStatus, DiscountProposal } from "./types";
import { buildReminderSchedule, discountProposal } from "./decisions";
import { selectStageAt, type RecoveryStage } from "./stages";
import type { RecoveryEvidence } from "./evidence";
import type { IntentLevel, IntentResult } from "./intent";
import type { ConfidenceLevel, ConfidenceResult } from "./confidence";

const HOUR = 3600_000;

/** حالات العميل — لا نعلن حالة أقوى من الأدلة المميّزة. */
export const CUSTOMER_STATES = [
  "BROWSING",
  "INTERESTED",
  "REPEATED_INTEREST",
  "CART_CREATED",
  "CHECKOUT_STARTED",
  "PAYMENT_INTENT",
  "HIGH_INTENT",
  "INCENTIVE_CANDIDATE",
  "PURCHASED",
  "SUPPRESSED",
  "WAITING",
] as const;

export type CustomerState = (typeof CUSTOMER_STATES)[number];

/** القرار — توصية نقيّة، التنفيذ يأتي لاحقًا خارج هذه الوحدة. */
export const RECOVERY_DECISIONS = [
  "NO_ACTION",
  "WAIT",
  "SEND_MESSAGE",
  "SEND_PRODUCT_MESSAGE",
  "SEND_MARKETING_MESSAGE",
  "RECOMMEND_INCENTIVE",
  "STOP",
] as const;

export type RecoveryDecisionValue = (typeof RECOVERY_DECISIONS)[number];

/** قرار الحافز — دون ربط بنظام الكوبونات بعد. */
export const INCENTIVE_DECISIONS = ["NO_INCENTIVE", "INCENTIVE_NOT_JUSTIFIED", "INCENTIVE_CANDIDATE"] as const;
export type IncentiveDecision = (typeof INCENTIVE_DECISIONS)[number];

/** سبب قرار التواصل (صح/خطأ). */
export type ContactGate =
  | "CONTACT_ALLOWED"
  | "LOW_INTENT"
  | "LOW_CONFIDENCE"
  | "RECENT_CONTACT"
  | "PURCHASED"
  | "SUPPRESSED"
  | "NO_VALID_SIGNAL"
  | "WAITING";

export type DecisionCaseContext = {
  /** لحظة التقييم (مللي ثانية) — يُمرَّر دائمًا، لا وقت نظام. */
  now: number;
  caseId?: string;
  status?: CaseStatus;
  firstDetectedAt?: number | null;
  lastActivityAt?: number | null;
  lastMessageAt?: number | null;
  messageCount?: number;
  cartValue?: number | null;
  preferredProductId?: string | null;
  discountCount?: number;
  lastDiscountAt?: number | null;
  discountRef?: string | null;
  /** طلب سابق مكتمل للعميل — قاعدة «لا رسالة مع طلب مكتمل». */
  hasCompletedOrder?: boolean;
  customerPhone?: string | null;
};

export type RecoveryDecisionInput = {
  evidence: RecoveryEvidence;
  intent: IntentResult;
  confidence: ConfidenceResult;
  context: DecisionCaseContext;
  cfg: RecoveryConfig;
};

export type RecoveryDecision = {
  decision: RecoveryDecisionValue;
  customerState: CustomerState;
  /** واحدة عربية تلخّص القرار ووجهته. */
  reason: string;
  /** جمل عربية تُفسّر لماذا (أدلة مشاهدة فعلًا). */
  reasons: string[];
  intentScore: number;
  intentLevel: IntentLevel;
  confidenceScore: number;
  confidenceLevel: ConfidenceLevel;
  /** مرحلة المحفّز المقترحة (من خطة المراحل) — تُملأ عند قرار تواصل/حافز فقط. */
  recommendedStage: string | null;
  recommendedAction: string;
  shouldContact: boolean;
  contactReason: ContactGate;
  shouldOfferIncentive: boolean;
  incentiveDecision: IncentiveDecision;
  incentiveReason: string;
  /** موعد التقييم التالي (من الجدول الحالي 30م/6س/24س) — إن وُجد. */
  nextActionAt: number | null;
  suppressionReason: string | null;
  /** مقترح قيمة الحافز (رقم فقط) — لا كوبون ولا إنشاء. */
  recommendedDiscount: DiscountProposal | null;
};

const STATE_LABELS: Record<CustomerState, string> = {
  BROWSING: "تصفّح",
  INTERESTED: "اهتمام",
  REPEATED_INTEREST: "اهتمام متكرر",
  CART_CREATED: "سلة منشأة",
  CHECKOUT_STARTED: "بدأ الإتمام",
  PAYMENT_INTENT: "نية دفع",
  HIGH_INTENT: "نية عالية",
  INCENTIVE_CANDIDATE: "مرشح حافز",
  PURCHASED: "شراء",
  SUPPRESSED: "ممنوع",
  WAITING: "انتظار",
};

const DECISION_LABELS: Record<RecoveryDecisionValue, string> = {
  NO_ACTION: "لا إجراء",
  WAIT: "انتظار",
  SEND_MESSAGE: "رسالة المرحلة",
  SEND_PRODUCT_MESSAGE: "رسالة تسويق المنتج",
  SEND_MARKETING_MESSAGE: "رسالة تسويق",
  RECOMMEND_INCENTIVE: "ترشيح حافز",
  STOP: "إيقاف",
};

const SEND_DECISIONS: readonly RecoveryDecisionValue[] = ["SEND_MESSAGE", "SEND_PRODUCT_MESSAGE", "SEND_MARKETING_MESSAGE", "RECOMMEND_INCENTIVE"];

/**
 * الحالة من الأدلة المميّزة فقط. الحالات الأعلى (HIGH_INTENT / INCENTIVE_CANDIDATE)
 * تُرفع لاحقًا بعد دمج النية والثقة — «لا حالة أقوى من الأدلة» هنا حرفيًا.
 */
export function customerStateFromEvidence(evidence: RecoveryEvidence): CustomerState {
  const o = evidence.observations;
  if (o.hasRecentPurchase) return "PURCHASED";
  if (evidence.inference.paymentReached) return "PAYMENT_INTENT";
  if (evidence.inference.checkoutReached) return "CHECKOUT_STARTED";
  if (evidence.inference.addToCartReached) return "CART_CREATED";
  if (evidence.inference.repeatedProductInterest) return "REPEATED_INTEREST";
  if (o.uniqueProducts > 0 || o.uniqueSessions > 0) return "BROWSING";
  return "WAITING";
}

/** هل التشخيص مرتفع بما يكفي لمنح حافز (يعني النية شديدة)؟ */
function intentIsExtreme(intent: IntentResult): boolean {
  return intent.level === "EXTREME";
}

/** رفع الحالة بالنية والثقة معًا — CONF لا تُعلَّم القرار بل تُضعفه. */
function elevateState(base: CustomerState, intent: IntentResult, conf: ConfidenceResult): CustomerState {
  if ((intent.level === "HIGH" || intentIsExtreme(intent)) && (conf.level === "MEDIUM" || conf.level === "HIGH")) {
    return "HIGH_INTENT";
  }
  return base;
}

/** قيمة السلة الموثقة: أدلة analytics أولًا ثم snapshot الحالة. */
function resolvedCartValue(e: RecoveryEvidence, ctx: DecisionCaseContext): number | null {
  const v = e.observations.cartValue;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return typeof ctx.cartValue === "number" && Number.isFinite(ctx.cartValue) ? ctx.cartValue : null;
}

/**
 * ترشيح الحافز — مجموعة شروط كاملة؛ نقص أي دليل مهم = لا حافز.
 * لا يُستدعى آلا في طبقة النية الشديدة + ثقة عالية (EXTREME + HIGH).
 * ليس قرار «إنشاء كوبون»؛ ترشيح قابل للشرح يُربط بنظام الكوبونات لاحقًا.
 */
function assessIncentive(e: RecoveryEvidence, ctx: DecisionCaseContext, cfg: RecoveryConfig): { decision: IncentiveDecision; reason: string } {
  const notJustified = (why: string) => ({ decision: "INCENTIVE_NOT_JUSTIFIED" as const, reason: why });
  const none = (why: string) => ({ decision: "NO_INCENTIVE" as const, reason: why });

  // الحماية الاقتصادية الأساسية: لا حافز بلا أدلة إتمام/دفع قوية.
  if (!e.inference.checkoutReached && !e.inference.paymentReached) return none("لا أدلة إتمام/دفع قوية — تكرار مشاهدات أو سلة وحده لا يستدعي حافزًا");
  const cart = resolvedCartValue(e, ctx);
  if (cart === null || cart < cfg.minCartValueForDiscount) {
    return notJustified(cart === null ? "قيمة السلة غير موثقة — لا يمكن تقدير حافز" : "قيمة السلة دون الحد الأدنى لمنح الحافز");
  }
  const ageHours = ctx.firstDetectedAt ? (ctx.now - ctx.firstDetectedAt) / HOUR : 0;
  if (cfg.discountEligibleAfterHours > 0 && ageHours < cfg.discountEligibleAfterHours) {
    return notJustified("الحالة ما زالت مبكرة — الحافز في مرحلة لاحقة من الاسترجاع");
  }
  if (cfg.discountRequiresPriorReminder && (ctx.messageCount ?? 0) < 1) {
    return notJustified("لا حافز قبل تذكير سابق — العميل سيشتري على الأغلب بدون حافز");
  }
  if (ctx.lastDiscountAt && ctx.now - ctx.lastDiscountAt < cfg.discountCooldownHours * HOUR) {
    return notJustified("حافز قريب سابق — مهلة الخصم لم تنتهِ");
  }
  if ((ctx.discountCount ?? 0) >= cfg.maxDiscountsPerCase || ctx.discountRef) {
    return notJustified("بلغت الحالة سقف الخصومات — لا حافز إضافي");
  }
  return { decision: "INCENTIVE_CANDIDATE", reason: "نية شديدة + أدلة إتمام/دفع + ثقة عالية + لا شراء + لا تواصل/حافز حديث → يليق الترشيح" };
}

function buildReasons(e: RecoveryEvidence, ctx: DecisionCaseContext, intent: IntentResult, state: CustomerState): string[] {
  const o = e.observations;
  const out: string[] = [];
  if (intent.level === "EXTREME" || intent.level === "HIGH") out.push(intent.level === "EXTREME" ? "نية شراء شديدة" : "نية شراء عالية");
  if (state === "CHECKOUT_STARTED" && e.inference.checkoutReached) out.push("أُثبت الإتمام (checkout_start)");
  if (state === "PAYMENT_INTENT" && e.inference.paymentReached) out.push("أُثبت بدء الدفع (payment_started)");
  if (e.inference.addToCartReached) out.push("أُثبتت إضافة إلى السلة");
  if (e.inference.repeatedProductInterest && o.preferredProduct) out.push(`المنتج شوهد عبر ${o.preferredProduct.sessions} جلسات مختلفة`);
  if (o.lastActivityAt !== null) {
    const freshHours = (e.coverage.windowEndMs - o.lastActivityAt) / HOUR;
    if (freshHours < 12) out.push("آخر نشاط حديث");
  }
  if (o.identity === "logged_in") out.push("العميل معرّف");
  if (intent.strongSignal) out.push("إشارة قوية (إتمام/دفع)");
  if (ctx.hasCompletedOrder) out.push("طلب سابق مكتمل");
  return out.slice(0, 5);
}

/** قيد فهرس المرحلة (عدد الرسائل المؤكدة) إلى نطاق الجدول السليم. */
function clampStep(messageCount: number | undefined, scheduleLength: number): number {
  const n = Number.isFinite(messageCount as number) ? Math.trunc((messageCount as number) || 0) : 0;
  if (scheduleLength <= 0) return 0;
  return Math.max(0, Math.min(n, scheduleLength - 1));
}

type BuildArgs = {
  decision: RecoveryDecisionValue;
  state: CustomerState;
  contact: boolean;
  gate: ContactGate;
  action: string;
  nextAt: number | null;
  suppression: string | null;
  /** مرحلة المحفّز (تظهر مع قرارات التواصل فقط). */
  stage?: string | null;
  /** أسباب مخصصة (STOP) بدل أسطر الأدلة. */
  reasons?: string[];
  incentives?: { decision: IncentiveDecision; reason: string };
  discount?: DiscountProposal | null;
};

/**
 * القرار المركزي — دالة نقية (now مدخل).
 * تُرجع توصية كاملة قابلة للعرض، دون أي تأثير جانبي.
 */
export function decideRecoveryAction(input: RecoveryDecisionInput): RecoveryDecision {
  const { evidence: e, intent, confidence: conf, cfg } = input;
  const ctx: DecisionCaseContext = input.context;
  const now = Number.isFinite(ctx.now) ? ctx.now : 0;

  const baseReasons = buildReasons(e, ctx, intent, customerStateFromEvidence(e));

  const firstAt = Number.isFinite(ctx.firstDetectedAt ?? 0) ? (ctx.firstDetectedAt as number) : now;
  const schedule = buildReminderSchedule(firstAt, cfg);
  const stepIndex = clampStep(ctx.messageCount ?? 0, schedule.length);
  const currentStageAt = schedule[stepIndex]?.at ?? null;
  const followingStageAt = schedule[stepIndex + 1]?.at ?? null;
  const recommendedStage: RecoveryStage | null = selectStageAt(cfg.stages, stepIndex);
  const cartVal = resolvedCartValue(e, ctx);

  const build = (a: BuildArgs): RecoveryDecision => {
    const incentivise = a.incentives ?? { decision: "NO_INCENTIVE", reason: "لا حافز في هذا المسار" };
    const willSend = SEND_DECISIONS.includes(a.decision);
    const offerIncentive = a.decision === "RECOMMEND_INCENTIVE" && incentivise.decision === "INCENTIVE_CANDIDATE";
    const discount = offerIncentive && cartVal !== null ? discountProposal(cartVal, cfg) : null;
    return {
      decision: a.decision,
      customerState: a.state,
      reason: `${DECISION_LABELS[a.decision]} — ${STATE_LABELS[a.state]}`,
      reasons: a.reasons ?? baseReasons,
      intentScore: intent.score,
      intentLevel: intent.level,
      confidenceScore: conf.score,
      confidenceLevel: conf.level,
      recommendedStage: willSend ? a.stage ?? recommendedStage?.key ?? null : null,
      recommendedAction: a.action,
      shouldContact: a.contact,
      contactReason: a.gate,
      shouldOfferIncentive: offerIncentive,
      incentiveDecision: incentivise.decision,
      incentiveReason: incentivise.reason,
      nextActionAt: a.nextAt,
      suppressionReason: a.suppression,
      recommendedDiscount: discount,
    };
  };

  // ======== سلسلة الأولوية (لا تُكسر بقاعدة لاحقة) ========

  // P0 — شراء/إغلاق: STOP دائمًا (لا رسالة تعقب الشراء، والإكمال يمنع Recovery).
  if (e.observations.hasRecentPurchase || ctx.status === "PURCHASED") {
    return build({
      decision: "STOP",
      state: "PURCHASED",
      contact: false,
      gate: "PURCHASED",
      action: "إيقاف تام — لا تواصل ولا حافز",
      nextAt: null,
      suppression: "purchased",
      reasons: ["قُيّد شراء حديثًا — لا نية للمتابعة ولا حافز"],
      incentives: { decision: "NO_INCENTIVE", reason: "الحالة ممنوعة/مغلقة — لا حافز" },
    });
  }
  if (ctx.hasCompletedOrder) {
    return build({
      decision: "STOP",
      state: "SUPPRESSED",
      contact: false,
      gate: "SUPPRESSED",
      action: "إيقاف تام — لا تواصل ولا حافز",
      nextAt: null,
      suppression: "order_completed",
      reasons: ["طلب سابق مكتمل — لا رسالة Recovery"],
      incentives: { decision: "NO_INCENTIVE", reason: "الحالة ممنوعة/مغلقة — لا حافز" },
    });
  }
  if (ctx.status === "EXPIRED" || ctx.status === "CANCELLED" || ctx.status === "SUPPRESSED") {
    return build({
      decision: "STOP",
      state: "SUPPRESSED",
      contact: false,
      gate: "SUPPRESSED",
      action: "إيقاف تام — لا تواصل ولا حافز",
      nextAt: null,
      suppression: `status:${ctx.status.toLowerCase()}`,
      reasons: ["الحالة مغلقة/ممنوعة — لا تواصل"],
      incentives: { decision: "NO_INCENTIVE", reason: "الحالة ممنوعة/مغلقة — لا حافز" },
    });
  }
  const ageExpired = cfg.expiryHours > 0 && (now - firstAt) / HOUR >= cfg.expiryHours;
  if (ageExpired) {
    return build({
      decision: "STOP",
      state: "SUPPRESSED",
      contact: false,
      gate: "SUPPRESSED",
      action: "إيقاف تام — لا تواصل ولا حافز",
      nextAt: null,
      suppression: "expired",
      reasons: ["انتهت مهلة الاسترجاع — لا تُجدول رسالة"],
      incentives: { decision: "NO_INCENTIVE", reason: "الحالة ممنوعة/مغلقة — لا حافز" },
    });
  }

  // P1 — بلا قناة تواصل (زائر مجهول): لا تواصل، الحالة تبقى مفتوحة.
  const baseState = customerStateFromEvidence(e);
  if (!ctx.customerPhone) {
    return build({
      decision: "WAIT",
      state: baseState,
      contact: false,
      gate: "SUPPRESSED",
      action: "زائر مجهول — لا تواصل (العميل المُعرَّف فقط مؤهل)",
      nextAt: null,
      suppression: "anonymous",
    });
  }

  // P2 — بلوغ الحد الأقصى من الرسائل.
  if ((ctx.messageCount ?? 0) >= cfg.maxMessages) {
    return build({
      decision: "STOP",
      state: "SUPPRESSED",
      contact: false,
      gate: "SUPPRESSED",
      action: "إيقاف — بلغت الحالة الحد الأقصى من الرسائل",
      nextAt: null,
      suppression: "max_messages",
      reasons: ["بلغت الحالة الحد الأقصى من الرسائل"],
      incentives: { decision: "NO_INCENTIVE", reason: "الحالة ممنوعة/مغلقة — لا حافز" },
    });
  }

  // P3 — تواصل حديث (cooldown عمومي): لا يرسل الآن.
  if (ctx.lastMessageAt && now - ctx.lastMessageAt < cfg.globalCooldownHours * HOUR) {
    return build({
      decision: "WAIT",
      state: baseState,
      contact: false,
      gate: "RECENT_CONTACT",
      action: "تواصل حديث — العميل في فترة cooldown عامة",
      nextAt: (ctx.lastMessageAt as number) + cfg.globalCooldownHours * HOUR,
      suppression: null,
      incentives: { decision: "NO_INCENTIVE", reason: "لا تواصل — لا حافز (قناع أعلى حسم القرار)" },
    });
  }

  // P4 — لا إشارة صالحة ضمن النافذة.
  if (e.observations.eventsUsedCount === 0) {
    return build({
      decision: "NO_ACTION",
      state: "WAITING",
      contact: false,
      gate: "NO_VALID_SIGNAL",
      action: "لا أدلة حديثة ضمن النافذة — لا إجراء",
      nextAt: null,
      suppression: null,
    });
  }

  // P5 — مبكر جدًا: قبل التذكير الأول / بين مراحل الجدول الحالي (30م / 6س / 24س).
  if (currentStageAt !== null && now < currentStageAt) {
    return build({
      decision: "WAIT",
      state: baseState,
      contact: false,
      gate: "WAITING",
      action: `انتصار المرحلة — التذكير القادم في الموعد المحدد (لم يحن بعد)`,
      nextAt: currentStageAt,
      suppression: null,
    });
  }

  // P6 — ثقة منخفضة: لا قرارات تسويقية قوية.
  if (conf.level === "LOW") {
    return build({
      decision: "WAIT",
      state: baseState,
      contact: false,
      gate: "LOW_CONFIDENCE",
      action: "ثقة منخفضة (بيانات ناقصة/متقادمة/مجهولة) — لا تسويق قوي",
      nextAt: null,
      suppression: null,
    });
  }

  // P7 — نية منخفضة: لا إجراء.
  if (intent.level === "VERY_LOW" || intent.level === "LOW") {
    return build({
      decision: "NO_ACTION",
      state: baseState,
      contact: false,
      gate: "LOW_INTENT",
      action: "نية منخفضة — لا إجراء الآن",
      nextAt: null,
      suppression: null,
    });
  }

  // ======== تواصل مسموح (contact=true) من هنا ========

  // P8 — نية متوسطة + ثقة كافية (MEDIUM/HIGH): رسالة المرحلة الحالية.
  if (intent.level === "MEDIUM") {
    const stageLabel = cfg.stages[stepIndex]?.nameAr ?? `المرحلة ${stepIndex + 1}`;
    return build({
      decision: "SEND_MESSAGE",
      state: baseState,
      contact: true,
      gate: "CONTACT_ALLOWED",
      action: `رسالة ${stageLabel} — التواصل مسموح بلا حافز`,
      nextAt: followingStageAt,
      suppression: null,
      incentives: { decision: "NO_INCENTIVE", reason: "نية متوسطة — لا حافز في هذه المرحلة" },
    });
  }

  // P9 — نية عالية/شديدة + ثقة متوسطة/عالية: تسويق. الحافز فقط عند اكتمال شروطه.
  if (intent.level === "HIGH" || intentIsExtreme(intent)) {
    if (conf.level === "MEDIUM") {
      return build({
        decision: "SEND_PRODUCT_MESSAGE",
        state: elevateState(baseState, intent, conf),
        contact: true,
        gate: "CONTACT_ALLOWED",
        action: `رسالة تسويق المنتج — نية ${intentIsExtreme(intent) ? "شديدة" : "عالية"} بثقة متوسطة`,
        nextAt: followingStageAt,
        suppression: null,
        incentives: { decision: "NO_INCENTIVE", reason: "الحافز يتطلب ثقة عالية مع النية الشديدة" },
      });
    }

    // ثقة عالية: تسويق؛ والترشيح يُقيَّم حصريًا للنية الشديدة (EXTREME).
    if (!intentIsExtreme(intent)) {
      return build({
        decision: "SEND_MARKETING_MESSAGE",
        state: elevateState(baseState, intent, conf),
        contact: true,
        gate: "CONTACT_ALLOWED",
        action: "رسالة تسويق — نية عالية دون شدّة قصوى (لا حافز)",
        nextAt: followingStageAt,
        suppression: null,
        incentives: { decision: "INCENTIVE_NOT_JUSTIFIED", reason: "نية عالية دون شدّة قصوى — لا حافز" },
      });
    }

    const incentive = assessIncentive(e, ctx, cfg);
    if (incentive.decision === "INCENTIVE_CANDIDATE") {
      return build({
        decision: "RECOMMEND_INCENTIVE",
        state: "INCENTIVE_CANDIDATE",
        contact: true,
        gate: "CONTACT_ALLOWED",
        action: "ترشيح حافز للاسترجاع (لا إنشاء كوبون — يُربط لاحقًا)",
        nextAt: followingStageAt,
        suppression: null,
        incentives: incentive,
      });
    }
    return build({
      decision: "SEND_MARKETING_MESSAGE",
      state: elevateState(baseState, intent, conf),
      contact: true,
      gate: "CONTACT_ALLOWED",
      action: `رسالة تسويق — ${incentive.reason}`,
      nextAt: followingStageAt,
      suppression: null,
      incentives: incentive,
    });
  }

  // لا يُصل إلى هنا عمليًا — أمان من كل السيناريوهات.
  return build({
    decision: "NO_ACTION",
    state: baseState,
    contact: false,
    gate: "LOW_INTENT",
    action: "لا إجراء",
    nextAt: null,
    suppression: null,
  });
}
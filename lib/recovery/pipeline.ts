/**
 * G4 — Runtime integration: تشغيل سلسلة الذكاء الجديدة على الـruntime القائم.
 *
 *   analytics_events (قراءة فقط)
 *     → buildRecoveryEvidence
 *     → computeIntent / computeConfidence   (بالإعدادات الفعلية، بلا thresholds ثابتة)
 *     → decideRecoveryAction                (بلا DB داخلي وبلا side effects)
 *     → recommendMarketingAction            (قرار نص/استراتيجية، لا إرسال)
 *     → guardExecution                      (الإذن الحاسم الوحيد — لا bypass)
 *     → ContactOutcome (adapter)            (الشكل القديم الذي يفهمه dispatcher فقط)
 *     → RecoveryDispatcher الموجود          (notifications → delivery واتساب → qr-server)
 *
 * قواعد هذا الملف (G4):
 *  - قراءة وقرار فقط. لا إنشاء notification، لا delivery، لا WhatsApp، لا كتابة
 *    حالة، لا كوبون. التسوية تبقى لـ dispatcher.settle() وحده.
 *  - بوابة Execute ضيّقة عمدًا: Pick<RecoveryContactGateway, "readTemplates" |
 *    "listRecoveryDeliveries"> — لا تملك method إنشاء الاتصال أصلًا، فلا يمكن
 *    أن يتجاوز هذا الملف الـdispatcher ولو أُخطئ.
 *  - مصدر الحقيقة للإرسال واحد: guardExecution. هل أرسل؟ = guard.allowed.
 *    لا تُستشار evaluateContact القديمة في هذا المسار إطلاقًا، ولا تُدمج نتيجتها
 *    مع نتيجة المحرك الجديد (لا مصدران متنافسان للقرار).
 *  - نص الرسالة الذي يفحصه الـGuard هو نفسه نص الإرسال: يُبنى مسبقًا بنفس
 *    الدالة النقية buildDispatchMessage وبنفس المدخلات التي يستخدمها
 *    dispatcher، ثم تُعاد الصفوف نفسها إلى الـdispatcher ⇒ ما يُفحص = ما يُدرَج.
 *
 * حدود الانتقال (seam) — حذف المحرك القديم لاحقًا بسطر واحد:
 *   Legacy: RecoveryEngine.evaluate → decisions.evaluateContact → ContactOutcome
 *   New:    runRecoveryPipeline     → pipeline.toContactOutcome  → ContactOutcome
 * كلاهما ينتج ContactOutcome، لكن Runtime واحد فقط هو المستخدم في دورة التشغيل.
 */

import type { RecoveryConfig } from "./config";
import type { RecoveryCaseStore } from "./store";
import type { ContactDecision, ContactOutcome, DiscountProposal, RecoveryCase, RecoveryCouponView } from "./types";
import { computeConfidence, type ConfidenceLevel } from "./confidence";
import { computeIntent, type IntentLevel } from "./intent";
import { decideRecoveryAction } from "./decision";
import type { CustomerState, RecoveryDecision, RecoveryDecisionValue } from "./decision";
import { recommendMarketingAction } from "./marketing";
import type { MarketingRecommendation, MarketingStrategy } from "./marketing";
import type { Cta, IncentiveMode, MessageType } from "./marketing";
import { toConfidenceEvidence, toIntentEvidence } from "./evidence";
import type { EvidenceIdentity, RecoveryEvidence } from "./evidence";
import { EXECUTION_BLOCK_REASONS, guardExecution } from "./execution-guard";
import type { ExecutionBlockReason, ExecutionDecision } from "./execution-guard";
import { buildDispatchMessage, decisionLabelAr } from "./dispatch-message";
import type { DispatchMessageBlockReason, DispatchTemplate } from "./dispatch-message";
import type { RecoveryContactGateway, RecoveryDeliveryRow } from "./dispatcher";
import { activeStages, selectStageAt } from "./stages";
import { buildRecoveryVariables } from "./variables";

/**
 * البوابة الوحيدة التي يقرأ منها هذا الملف: قوالب المراحل وصفوف التسليم.
 * createWhatsAppContact غير مُدرَج — الإدراج يبقى حكرًا على RecoveryDispatcher.
 */
export type PipelineReadGateway = Pick<RecoveryContactGateway, "readTemplates" | "listRecoveryDeliveries">;

/** قراءة الأدلة لزائر واحد — تُحقن من الراوت (قراءة analytics_events فقط). */
export type PipelineEvidenceReader = (input: { c: RecoveryCase; asOf: number; identity: EvidenceIdentity }) => Promise<RecoveryEvidence>;

export type RecoveryPipelineDeps = {
  cfg: RecoveryConfig;
  store: Pick<RecoveryCaseStore, "listActive" | "findByIds">;
  gateway: PipelineReadGateway;
  readEvidence: PipelineEvidenceReader;
  /** فحص «طلب سابق مكتمل» إن توفّر في المسار القائم (يُمرَّر كـ hasCompletedOrder). */
  hasCompletedOrder?: (phone: string) => Promise<boolean>;
  /**
   * G6-C: القسيمة الحقيقية لهذه الحالة أو null. صارت غير متزامنة وقابلة
   * للإنشاء: الـadapter في الراوت هو من يمرّر `createIncentive`، وهذه الوحدة
   * لا تعرف شيئًا عن القاعدة ولا تُنشئ كودًا. غائبة ⇒ لا حافز إطلاقًا.
   *
   * تُستدعى بعد حساب القرار، ويُمرَّر معها في `context` — فالمرشّح الفعلي هو
   * `RECOMMEND_INCENTIVE` من هذه الدورة لا `recovery_cases.decision` القديمة.
   */
  resolveCoupon?: (
    c: RecoveryCase,
    context: { decision: RecoveryDecision; now: number }
  ) => Promise<RecoveryCouponView | null> | RecoveryCouponView | null;
  /**
   * G6-D: سبب فشل إنشاء القسيمة من البوابة. يُمرَّر إلى التسويق ليميّز
   * «فشل الإنشاء» عن «لا قسيمة متاحة» في سبب الحجب. null = لا محاولة فاشلة.
   */
  couponFailure?: string | null;
  now?: () => number;
};

/** أين توقفت الحالة في السلسلة — للتشخيص (لا يؤثر على الإذن). */
export type PipelineBlockStage = "evidence" | "decision" | "marketing" | "render" | "guard";

export type PipelineBlock = {
  stage: PipelineBlockStage;
  /** رمز حتمي (سبب الـdispatcher أو الـguard). */
  reason: string;
  reasonAr: string;
};

export type PipelineMarketingView = {
  strategy: MarketingStrategy;
  shouldSend: boolean;
  templateKey: string | null;
  messageType: MessageType;
  variantIndex: number | null;
  cta: Cta | null;
  incentiveMode: IncentiveMode;
  blockedReason: string | null;
  reason: string;
};

export type PipelineCaseResult = {
  caseId: string;
  /** الصف الطازج الذي حُوِّم عليه (نفس الكائن الذي يُسلَّم للـdispatcher). */
  case: RecoveryCase;
  identity: EvidenceIdentity;
  customerState: CustomerState;
  recoveryDecision: RecoveryDecisionValue;
  contactDecision: ContactDecision;
  /** بوابة التواصل من محرك القرار (السبب الأدقّ حين يكون الـGuard قدّم سببًا عامًّا). */
  contactReason: RecoveryDecision["contactReason"];
  decisionReasonAr: string;
  intentLevel: IntentLevel;
  intentScore: number;
  confidenceLevel: ConfidenceLevel;
  confidenceScore: number;
  marketing: PipelineMarketingView;
  /** القرار الحاسم: هل يُسمح بالتنفيذ الآن؟ */
  guard: ExecutionDecision;
  block: PipelineBlock | null;
  /** ناتج adapter — كل ما يراه الـdispatcher. */
  outcome: ContactOutcome;
};

export type PipelineCounters = {
  considered: number;
  allowed: number;
  blockedBy: Record<ExecutionBlockReason, number>;
  /** حالات توقف عند تصيير نص الإرسال نفسه (قالب المرحلة). */
  renderBlocked: number;
  /** رسائل قُيّمت بنص الإرسال الحقيقي (لا رسالة افتراضية). */
  templated: number;
};

export type PipelineCycle = {
  now: number;
  /** الصفوف الطازجة — تُمرَّر كما هي إلى dispatcher.dispatch. */
  cases: RecoveryCase[];
  /** outcomes: مرتّبة، المسموح أولًا (ترتيب عرض فقط — دلالات dispatch لم تتغيّر). */
  outcomes: ContactOutcome[];
  results: PipelineCaseResult[];
  counters: PipelineCounters;
};

function emptyBlockCounts(): Record<ExecutionBlockReason, number> {
  return Object.fromEntries(EXECUTION_BLOCK_REASONS.map((r) => [r, 0])) as Record<ExecutionBlockReason, number>;
}

/**
 * هوية الأدلة من سياق الحالة فقط — لا تُستنتج من analytics ولا تُخترع.
 * customerId ⇒ عميل معرّف؛ وإلا فالحالة نفسها دليل على وجود زائر بلا هوية عميل.
 */
export function evidenceIdentityForCase(c: RecoveryCase): EvidenceIdentity {
  return c.customerId ? "logged_in" : "anonymous";
}

/** قرار المحرك الجديد ← نوع القرار القديم الذي يفهمه dispatcher (للعرض فقط). */
export function contactDecisionFor(decision: RecoveryDecisionValue, allowed: boolean): ContactDecision {
  if (!allowed) return "NO_INCENTIVE";
  return decision === "RECOMMEND_INCENTIVE" ? "DISCOUNT_ELIGIBLE" : "REMINDER_ONLY";
}

/**
 * الـadapter — نقطة migration seam الوحيدة.
 * يحوّل (قرار جديد + إذن الـGuard) إلى ContactOutcomeLegacy الذي يقرأه
 * dispatcher.dispatch. القاعدة الحاكمة: wouldSend = guard.allowed فقط.
 * فلا يمكن أن يقول المحرك الجديد «أرسل» ويقول القديم «لا» ويخترع النظام
 * اختيارًا بينهما: القديم لا يُستشار في هذا المسار، والقديم يُشتقّ من الجديد.
 */
export function toContactOutcome(input: {
  caseId: string;
  decision: RecoveryDecision;
  guard: ExecutionDecision;
  discount: DiscountProposal | null;
  /** G6-C: القسيمة التي بُني عليها النص المفحوص. */
  coupon?: RecoveryCouponView | null;
  runtimeBlock: PipelineBlock | null;
}): ContactOutcome {
  const { decision, guard, discount, runtimeBlock } = input;
  const allowed = guard.allowed === true && runtimeBlock === null;
  const contactDecision = contactDecisionFor(decision.decision, allowed);
  return {
    caseId: input.caseId,
    decision: contactDecision,
    wouldSend: allowed,
    suppressReason: allowed ? undefined : guard.allowed ? runtimeBlock?.reason : guard.reason,
    recommendedAction: allowed ? decision.recommendedAction : guard.allowed ? runtimeBlock?.reasonAr ?? decision.reason : guard.reasonAr,
    recommendedDiscount: allowed ? discount : null,
    // القسيمة تنتقل مع الـoutcome: هي التي بُني منها النص الذي فُحص، وفقدانها
    // هنا كان سيجعل الـdispatcher يعيد بناء نص بلا كود.
    coupon: allowed ? input.coupon ?? null : null,
    nextActionAt: decision.nextActionAt,
  };
}

/** سبب تصيير القالب ← مفردات حجب التوصية (ليقرأها reasonFromRefusal في الـGuard). */
const RENDER_BLOCK_TO_MARKETING: Record<DispatchMessageBlockReason, string> = {
  no_stage: "template_missing",
  template_missing: "template_missing",
  template_inactive: "template_inactive",
  template_invalid: "template_invalid",
  render_unknown: "render_unknown",
  empty_message: "empty_message",
  coupon_required: "template_invalid",
};

type CaseRuntime = {
  c: RecoveryCase;
  stage: ReturnType<typeof selectStageAt>;
  decision: RecoveryDecision;
  marketing: MarketingRecommendation;
  contactDecision: ContactDecision;
  discount: DiscountProposal | null;
  /** G6-C: القسيمة الفعلية المعروضة في الرسالة (إن وُجدت). */
  coupon: RecoveryCouponView | null;
  runtimeBlock: PipelineBlock | null;
  guard: ExecutionDecision;
  identity: EvidenceIdentity;
  evidence: RecoveryEvidence;
  intent: ReturnType<typeof computeIntent>;
  confidence: ReturnType<typeof computeConfidence>;
};

/**
 * تقييم حالة واحدة عبر السلسلة كاملة — قراءة وقرار فقط.
 * الترتيب مقصود: الأدلة ← النية/الثقة ← القرار ← التسويق ← تصيير نص الإرسال
 * الحقيقي ← الحارس. التصيير قبل الحارس لأن الحارس لا يستطيع التحقق من نص
 * غير موجود؛ فالنص المُفحَص هو نفسه نص الإرسال (نفس الدالة النقية ونفس
 * المدخلات التي يستخدمها dispatcher).
 */
async function evaluateCase(
  c: RecoveryCase,
  deps: RecoveryPipelineDeps,
  templates: DispatchTemplate[],
  inFlightIds: Set<string>,
  asOf: number,
): Promise<CaseRuntime> {
  const { cfg } = deps;
  const identity = evidenceIdentityForCase(c);

  // 1) الأدلة — قراءة فقط، وخطأ القراءة يُعالَج fail-safe داخل evidence.ts.
  const evidence = await deps.readEvidence({ c, asOf, identity });

  // 2) النية والثقة — بالإعدادات الفعلية (IntentConfig/ConfidenceConfig من cfg).
  const intCtx = {
    caseType: c.caseType,
    preferredProductId: c.preferredProductId ?? null,
    caseCartValue: c.cartValue ?? null,
    identity,
  };
  const intent = computeIntent(toIntentEvidence(evidence, intCtx), cfg);
  const confidence = computeConfidence(toConfidenceEvidence(evidence, intCtx), cfg);

  // 3) القرار — context صريح (الحالة + الوقت)، بلا قراءة DB وبلا side effects.
  const hasCompletedOrder = deps.hasCompletedOrder && c.customerPhone ? await deps.hasCompletedOrder(c.customerPhone) : false;
  const decision = decideRecoveryAction({
    evidence,
    intent,
    confidence,
    context: {
      now: asOf,
      caseId: c.id,
      status: c.status,
      firstDetectedAt: c.firstDetectedAt,
      lastActivityAt: c.lastActivityAt,
      lastMessageAt: c.lastMessageAt,
      messageCount: c.messageCount,
      cartValue: c.cartValue,
      preferredProductId: c.preferredProductId ?? null,
      discountCount: c.discountCount,
      lastDiscountAt: c.lastDiscountAt,
      discountRef: c.discountRef,
      hasCompletedOrder,
      customerPhone: c.customerPhone,
    },
    cfg,
  });

  // 4) القسيمة والتسويق — المرحلة نفسها التي يختارها dispatcher
  //    (messageCount)، وبلا تنفيذ. القسيمة تُحلّ قبل بناء القيم لأن
  //    متغيرات {{coupon.*}} جزء من رسالة الإرسال نفسها.
  const stage = selectStageAt(cfg.stages, c.messageCount);
  const discount = decision.recommendedDiscount;
  const contactDecision = contactDecisionFor(decision.decision, true);
  const coupon = deps.resolveCoupon ? await deps.resolveCoupon(c, { decision, now: asOf }) : null;
  const couponFailure = deps.couponFailure ?? null;
  const values = stage
    ? buildRecoveryVariables({
        case: c,
        stage,
        stageIndex: stage.position,
        stageTotal: cfg.stages.length,
        discount,
        coupon,
        now: asOf,
        expiryHours: cfg.expiryHours,
        decisionAr: decisionLabelAr(contactDecision),
      })
    : {};
  const marketing = recommendMarketingAction({ decision, evidence, intent, confidence, stage, values, coupon, couponFailure });

  // 5) نص الإرسال الحقيقي — نفس دالة dispatcher ونفس المدخلات.
  //    فالنص الذي يفحصه الـGuard أدناه هو النص الذي سيُدرَج فعلًا.
  //
  //    G6-C: الحافز مسار منفصل عن قوالب المرحلة. القسيمة وحدها لا تعني
  //    «أرسل قسيمة»: المهم أن يوصي القرار بالحافز وأن يجيء النص من قالب
  //    الحافز (.catalog) لا من رسالة استرجاع محايدة. شرطان معًا.
  const incentiveBody =
    marketing.shouldSend && coupon && marketing.incentiveMode === "RECOMMENDED"
      ? { body: marketing.body ?? "", title: marketing.title }
      : null;
  const built = buildDispatchMessage({
    case: c,
    stages: cfg.stages,
    templates,
    discount,
    coupon,
    incentiveBody,
    now: asOf,
    expiryHours: cfg.expiryHours,
    decisionAr: decisionLabelAr(contactDecision),
  });

  // 6) حارس واحد بلا bypass: إمّا نص حقيقي يفحصه، أو رفض موصوف بمفردة التوصية.
  let runtimeBlock: PipelineBlock | null = null;
  let runtimeRec: MarketingRecommendation = marketing;
  if (built.status === "block" && marketing.shouldSend) {
    runtimeBlock = { stage: "render", reason: built.reason, reasonAr: built.reasonAr };
    runtimeRec = {
      ...marketing,
      shouldSend: false,
      body: null,
      title: marketing.title,
      blockedReason: RENDER_BLOCK_TO_MARKETING[built.reason],
      reasons: [...marketing.reasons, built.reasonAr],
    };
  } else if (built.status === "send" && marketing.shouldSend) {
    runtimeRec = { ...marketing, body: built.message, title: built.title };
  }

  // 7) الحارس: لقطة الحالة الحالية (شراء/إغلاق) + قيد التنفيذ + الرسالة نفسها.
  const guard = guardExecution({
    recommendation: runtimeRec,
    caseState: {
      id: c.id,
      status: c.status,
      customerId: c.customerId,
      customerPhone: c.customerPhone,
      messageCount: c.messageCount,
      lastMessageAt: c.lastMessageAt,
      purchaseRef: c.purchaseRef,
      completedAt: c.completedAt,
      suppressReason: c.suppressReason,
      // أدلة شراء على مستوى analytics قد تسبق تحديث صف الحالة (purchase race).
      purchased: evidence.inference.purchasedRecently === true,
      suppressed: Boolean(c.suppressReason) && c.status !== "PURCHASED",
    },
    cfg,
    stage: stage ? { key: stage.key, maxTotalMessages: stage.maxTotalMessages } : null,
    contact: { inFlight: inFlightIds.has(c.id) },
    coupon,
    now: asOf,
    recoveryDecision: decision.decision,
  });

  return { c, stage, decision, marketing, contactDecision, discount, coupon, runtimeBlock, guard, identity, evidence, intent, confidence };
}

function toResult(r: CaseRuntime): PipelineCaseResult {
  const outcome = toContactOutcome({
    caseId: r.c.id,
    decision: r.decision,
    guard: r.guard,
    discount: r.discount,
    coupon: r.coupon,
    runtimeBlock: r.runtimeBlock,
  });
  return {
    caseId: r.c.id,
    case: r.c,
    identity: r.identity,
    customerState: r.decision.customerState,
    recoveryDecision: r.decision.decision,
    contactDecision: outcome.decision,
    contactReason: r.decision.contactReason,
    decisionReasonAr: r.decision.reason,
    intentLevel: r.intent.level,
    intentScore: r.intent.score,
    confidenceLevel: r.confidence.level,
    confidenceScore: r.confidence.score,
    marketing: {
      strategy: r.marketing.strategy,
      shouldSend: r.marketing.shouldSend,
      templateKey: r.marketing.templateKey,
      messageType: r.marketing.messageType,
      variantIndex: r.marketing.variantIndex,
      cta: r.marketing.cta,
      incentiveMode: r.marketing.incentiveMode,
      blockedReason: r.marketing.blockedReason,
      reason: r.marketing.reason,
    },
    guard: r.guard,
    block: r.guard.allowed ? r.runtimeBlock : r.runtimeBlock
      ? { ...r.runtimeBlock, stage: "render" }
      : { stage: "guard", reason: r.guard.reason, reasonAr: r.guard.reasonAr },
    outcome,
  };
}

/**
 * دورة القرار الكاملة — تُستدعى من /api/recovery/run بعد التسوية.
 *
 * 1) الحالات النشطة.
 * 2) لقطة طازجة منها (findByIds) قبل كل قرار ⇒ فحص purchase race حقيقي:
 *    إن أُغلقت الحالة بالشراء بعد قراءتها الأولى، التقطتها اللقطة وهنا يتوقف
 *    الحارس (PURCHASED) قبل أي إدراج.
 * 3) صفوف التسليم غير المسوّاة ⇒ inFlight (نفس تعريف dispatcher).
 * 4) قوالب المراحل المربوطة (نفس مجموعة dispatcher).
 * 5) لكل حالة: السلسلة كاملة ثم adapter.
 *
 * لا يكتب هذا الملف شيئًا: لا notification، لا delivery، لا WhatsApp، ولا حالة.
 * القسيمة تُحلّ من `resolveCoupon` (وهي الوحيدة التي تنشئ، في الـadapter)؛
 * هنا تُقرأ وتُعرض فقط.
 */
export async function runRecoveryPipeline(deps: RecoveryPipelineDeps): Promise<PipelineCycle> {
  const { cfg, store, gateway } = deps;
  const asOf = deps.now ? deps.now() : Date.now();

  const active = await store.listActive();
  const fresh = active.length ? await store.findByIds(active.map((c) => c.id)) : new Map<string, RecoveryCase>();
  // الصف الطازج عند توفره، وإلا الصف الأصلي (لا نُسقط حالة بسبب فشل القراءة).
  const cases: RecoveryCase[] = active.map((c) => fresh.get(c.id) ?? c);

  const deliveries: RecoveryDeliveryRow[] = cases.length ? await gateway.listRecoveryDeliveries(cases.map((c) => c.id)) : [];
  const inFlightIds = new Set<string>();
  for (const row of deliveries) if (row.status !== "sent") inFlightIds.add(row.caseId);

  const templateIds = cases.length
    ? [...new Set(activeStages(cfg.stages).map((s) => s.templateId).filter((n): n is number => n !== null))]
    : [];
  const templates: DispatchTemplate[] = templateIds.length ? await gateway.readTemplates(templateIds) : [];

  const counters: PipelineCounters = { considered: cases.length, allowed: 0, blockedBy: emptyBlockCounts(), renderBlocked: 0, templated: 0 };
  const results: PipelineCaseResult[] = [];
  for (const c of cases) {
    const runtime = await evaluateCase(c, deps, templates, inFlightIds, asOf);
    const result = toResult(runtime);
    if (runtime.runtimeBlock) counters.renderBlocked++;
    if (runtime.marketing.shouldSend && result.guard.allowed) {
      counters.allowed++;
      counters.templated++;
    } else if (!result.guard.allowed) {
      counters.blockedBy[result.guard.reason]++;
    }
    results.push(result);
  }

  // المسموح أولًا: سلوك dispatch لا يتغير، فقط ترتيب يعرض الأقرب للتنفيذ.
  const outcomes = results
    .filter((r) => r.outcome.wouldSend)
    .map((r) => r.outcome)
    .concat(results.filter((r) => !r.outcome.wouldSend).map((r) => r.outcome));

  return { now: asOf, cases, outcomes, results, counters };
}

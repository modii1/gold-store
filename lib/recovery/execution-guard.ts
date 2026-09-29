/**
 * G3 — Execution Guard: طبقة نقية بين توصية Marketing ومسار الإرسال الموجود.
 *
 * السلسلة الكاملة بعد G3:
 *   Evidence → Intent → Confidence → Decision → Marketing Recommendation
 *     → Execution Guard ← (هذه الوحدة)
 *     → RecoveryDispatcher الموجود (notifications → delivery واتساب → qr-server → sent)
 *
 * فصل الطبقات (لا يُخلط):
 *  - Marketing (marketing.ts): «ماذا نريد أن نفعل؟» — قرار النص/الاستراتيجية.
 *  - Execution Guard (هنا): «هل مسموح التنفيذ الآن؟» — مَن يقرر الإذن، لا يُنشئ رسالة.
 *  - Dispatcher (dispatcher.ts): «نفّذ عبر المسار الموجود فقط» — لا يُحسَم هنا أي إذن.
 *
 * هذه الوحدة خالصة تمامًا:
 *  - لا شبكة، لا Supabase، لا إنشاء notification، لا delivery، لا WhatsApp،
 *    لا كتابة حالة، لا كوبون. هي دالة قرار فقط.
 *  - حتمية: نفس المدخلات ⇒ نفس القرار ونفس مفتاح idempotency (بلا timestamp).
 *
 * القرار يجيب على: allowed · reason · channel · templateKey · message · idempotencyKey.
 * ولماذا لا إرسال (عند المنع) من القائمة المغلقة التالية:
 *   RECOVERY_DISABLED | DRY_RUN | PURCHASED | SUPPRESSED | NO_PHONE |
 *   INVALID_PHONE | NO_ACTION | LOW_CONFIDENCE | RECENT_CONTACT |
 *   MESSAGE_LIMIT | TEMPLATE_INVALID | TEMPLATE_MISSING | INCENTIVE_REQUIRED |
 *   DUPLICATE | ALREADY_IN_FLIGHT
 *
 * عندما يسمح الـ Guard: الإدراج الفعلي يمر حصريًا عبر RecoveryDispatcher الموجود
 * (المفتاح الأساسي الحتمي deterministicNotificationId(caseId, messageCount) بقاعدة
 * 23505 هو الحارس النهائي للتكرار). مفتاح idempotency هنا أغنَى:
 * (caseId + stage + messageCount + variant + template + recovery decision).
 *
 * Settlement: لا يُعدّ الإرسال ناجحًا بمجرد الإذن أو إنشاء notification؛ التسوية
 * (recordIntervention + messageCount + lastMessageAt) تبقى مسؤولية dispatcher.settle()
 * بعد قراءة delivery حالتها 'sent' وsent_at موجود.
 */

import type { RecoveryConfig } from "./config";
import type { MarketingRecommendation, MarketingStrategy } from "./marketing";
import { MARKETING_TEMPLATES, templateIntegrity, unprovenClaims } from "./marketing";
import { listTemplateTokens, validateTemplate } from "./variables";
import { TEMPLATE_BODY_MAX } from "./template-control";
import { normalizePhoneInternational } from "@/lib/format";
import { normalizeCouponCode } from "@/lib/coupons/policy";
import { deterministicNotificationId, RECOVERY_CONTACT_TYPE } from "./dispatcher";
import type { RecoveryDecisionValue } from "./decision";
import type { RecoveryCouponView } from "./incentive";

/** القناة الوحيدة في هذا النظام — نفس CONTACT_CHANNEL في dispatcher الموجود. */
export const EXECUTION_CHANNEL = "whatsapp";

/** رموز القالب التي تُوصل كود القسيمة فعليًا للعميل. */
const COUPON_CODE_TOKENS = new Set(["coupon.code"]);

/** الإجراء الافتراضي لحالة ما (نفس dispatcher). */
export const EXECUTION_ACTION_URL = "/cart";

/** أسباب المنع الخمسة عشر — قائمة مغلقة. */
export const EXECUTION_BLOCK_REASONS = [
  "RECOVERY_DISABLED",
  "DRY_RUN",
  "PURCHASED",
  "SUPPRESSED",
  "NO_PHONE",
  "INVALID_PHONE",
  "NO_ACTION",
  "LOW_CONFIDENCE",
  "RECENT_CONTACT",
  "MESSAGE_LIMIT",
  "TEMPLATE_INVALID",
  "TEMPLATE_MISSING",
  "INCENTIVE_REQUIRED",
  "INCENTIVE_UNAVAILABLE",
  "DUPLICATE",
  "ALREADY_IN_FLIGHT",
] as const;

export type ExecutionBlockReason = (typeof EXECUTION_BLOCK_REASONS)[number];

/** شرح عربي لكل سبب منع — للعرض والتشخيص. */
export const EXECUTION_BLOCK_LABELS: Record<ExecutionBlockReason, string> = {
  RECOVERY_DISABLED: "النظام غير مفعّل (recovery_enabled=OFF) — لا إرسال.",
  DRY_RUN: "وضع المعاينة (dryRun) — لا إرسال إطلاقًا.",
  PURCHASED: "العميل اشترى أو الشراء مكتمل — لا رسالة بعد الشراء.",
  SUPPRESSED: "الحالة مغلقة/ممنوعة (SUPPRESSED/EXPIRED/CANCELLED) — لا إرسال.",
  NO_PHONE: "حالة بلا رقم/معرّف عميل — لا إرسال.",
  INVALID_PHONE: "رقم العميل ليس رقمًا دوليًا صالحًا — لا إرسال.",
  NO_ACTION: "القرار بلا إجراء — لا يُخترع إرسال بلا داعٍ.",
  LOW_CONFIDENCE: "ثقة منخفضة — لا إرسال رسالة تسويقية على بيانات ناقصة.",
  RECENT_CONTACT: "تواصل حديث مع العميل (cooldown عام) — لا إرسال الآن.",
  MESSAGE_LIMIT: "بلغت الحالة الحد الأقصى من الرسائل — لا إرسال.",
  TEMPLATE_INVALID: "القالب أو الرسالة النهائية معطوبة — لا إرسال (fail-safe).",
  TEMPLATE_MISSING: "القالب المطلوب غير موجود — لا إرسال (لا fallback عشوائي).",
  INCENTIVE_REQUIRED: "الحافز مطلوب قبل الإرسال ولا يوجد كوبون فعلي — لا إرسال.",
  INCENTIVE_UNAVAILABLE: "فشل إنشاء القسيمة (سباق/نفاد/خطأ قاعدة) — لا إرسال رسالة حافز.",
  DUPLICATE: "نفس الرسالة سُجّلت/أُرسلت مسبقًا (نفس مفتاح idempotency) — لا تكرار.",
  ALREADY_IN_FLIGHT: "رسالة للحالة قيد التنفيذ بالفعل — لا إرسال ثانٍ.",
};

/** صورة الحالة التي يحتاجها الـ Guard — إسقاط لا استعلام كامل. */
export type ExecutionCaseState = {
  id: string;
  /** حالة الحالة كما هي في اللحظة الحالية (ربما أحدث من قرار التوصية). */
  status?: string | null;
  customerId?: string | null;
  customerPhone?: string | null;
  messageCount?: number | null;
  lastMessageAt?: number | null;
  purchaseRef?: string | null;
  completedAt?: number | null;
  suppressReason?: string | null;
  /** شراء مُثبت على مستوى الأدلة (قد يسبق تحديث حالة القاعدة) — guard race. */
  purchased?: boolean;
  /** حالة ممنوعة على مستوى القرار (مثل STOP بلا شراء). */
  suppressed?: boolean;
};

/** سياق من مسار الإرسال الموجود — يمنح الـ Guard قراءة وضع الجدولة. */
export type ExecutionContactContext = {
  /** توجد رسالة غير مسوّاة للحالة (pending/sending/failed…) عند dispatcher. */
  inFlight?: boolean;
  /** مفاتيح idempotency معروفة (سُجّلت/أُرسلت/قيد الجدولة) — لمنع التكرار. */
  seenKeys?: readonly string[];
};

export type ExecutionGuardInput = {
  recommendation: MarketingRecommendation;
  caseState: ExecutionCaseState;
  cfg: RecoveryConfig;
  /** المرحلة الحالية (مفتاحها وسقفها فقط) — للمفتاح ولمرسومة الحد الخاص بها. */
  stage?: { key?: string | null; maxTotalMessages?: number | null } | null;
  contact?: ExecutionContactContext | null;
  /** قسيمة حقيقية من نظام الكوبونات (خارج هذه الطبقة) — absent = لا حافز. */
  coupon?: RecoveryCouponView | null;
  /** لحظة التقييم (ms) — تُمرَّر دائمًا، بلا وقت نظام (حتمية). */
  now?: number;
  /** القرار الترويجي الأصلي الذي أنتج التوصية — جزء من مفتاح idempotency. */
  recoveryDecision?: RecoveryDecisionValue | string | null;
};

/** قرار تنفيذ مسموح — يُنفَّذ حصريًا عبر RecoveryDispatcher الموجود. */
export type AllowedExecution = {
  allowed: true;
  reason: "OK";
  reasonAr: string;
  channel: typeof EXECUTION_CHANNEL;
  strategy: MarketingStrategy;
  templateKey: string;
  message: string;
  title: string;
  idempotencyKey: string;
  /** القيمة التي يجب أن يبلغها messageCount بعد تأكيد الإرسال (قائمة بالفعل). */
  expectedMessageCount: number;
};

/** قرار تنفيذ ممنوع — سبب واحد محدد، بلا أي رسالة. */
export type BlockedExecution = {
  allowed: false;
  reason: ExecutionBlockReason;
  reasonAr: string;
  /**
   * تفاصيل التشخيص (Issues) — سبب داخلي لا يُعرض للعميل ولا يُدخَل في
   * أي كود. الغرض: عند منع `TEMPLATE_INVALID` نعرف أي فحص فشل (كود
   * القسيمة غير ظاهر؟ رمز باقٍ؟ ادعاء بلا بيانات؟). قائمة الأسباب
   * المغلقة أعلاه تبقى كما هي — هذه طبقة تفصيل لا طبقة قرار.
   */
  issues?: string[];
  channel: null;
  strategy: MarketingStrategy;
  templateKey: string | null;
  message: null;
  title: null;
  idempotencyKey: null;
  expectedMessageCount: null;
};

export type ExecutionDecision = AllowedExecution | BlockedExecution;

// ---------------------------------------------------------------
// مفتاح idempotency حتمي — أغنَى من مفتاح enqueue الحالي
// ---------------------------------------------------------------

/**
 * مفتاح idempotency على مستوى التنفيذ.
 *
 * حتمي بالكامل (بلا timestamp): نفس (caseId, stage, messageCount, variant,
 * template, recovery decision) ⇒ نفس المفتاح، في أي وقت وأي دورة وأي عملية
 * متزامنة. هذا ما يمنع cron retry / duplicate event / concurrent run من إرسال
 * نفس الرسالة مرتين.
 *
 * لماذا هذه المكوّنات تحديدًا:
 *  - caseId: عمود فقري.
 *  - stageKey: مرحلة الحالة (لا نفس مرحلة=مرحلة مغايرة).
 *  - messageCount: خطوة الإرسال (Nth رسالة للحالة).
 *  - variantIndex + templateKey: صياغة الرسالة الفعلية.
 *  - recoveryDecision: قرار المحرك الذي أنتج التوصية.
 *
 * ملاحظة: dispatcher الموجود يحرس الإدراج بمفتاحه الخاص
 * deterministicNotificationId(caseId, messageCount) عبر 23505؛ هذا المفتاح
 * طبقة أخصّ تتضمن الصياغة والقرار.
 */
export function buildExecutionIdempotencyKey(input: {
  caseId: string;
  stageKey?: string | null;
  messageCount?: number | null;
  templateKey?: string | null;
  variantIndex?: number | null;
  recoveryDecision?: string | null;
}): string {
  const parts = [
    "recovery.exec.guard",
    String(input.caseId ?? ""),
    String(input.stageKey ?? ""),
    String(Number.isFinite(input.messageCount as number) ? String(input.messageCount) : ""),
    String(input.templateKey ?? ""),
    String(input.variantIndex === null || input.variantIndex === undefined ? "" : String(input.variantIndex)),
    String(input.recoveryDecision ?? ""),
  ];
  return deterministicUuid(parts.join(":"));
}

/** FNV-1a 32-bit — حتمي بلا اعتماديات؛ ليس بديلًا أمنيًا. */
function fnv1a(str: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** UUID حتمي (شكل v4) من نص — بذور مختلفة عن dispatcher عمدًا. */
function deterministicUuid(input: string): string {
  const bytes = new Uint8Array(16);
  const h1 = fnv1a(input, 0x811c9dc5);
  const h2 = fnv1a(`${input}#exec-guard`, 0x9e3779b1);
  for (let i = 0; i < 4; i++) {
    bytes[i] = (h1 >>> (8 * i)) & 0xff;
    bytes[4 + i] = (h2 >>> (8 * i)) & 0xff;
    bytes[8 + i] = (h1 >>> (8 * (i + 1))) & 0xff;
    bytes[12 + i] = (h2 >>> (8 * (i + 1))) & 0xff;
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// ---------------------------------------------------------------
// الـ Guard المركزي
// ---------------------------------------------------------------

const HOUR_MS = 3_600_000;

/** ← ما الذي يمنع التوصية نفسها (قبل فحص حالة الحالة/المحتوى). */
function reasonFromRefusal(rec: MarketingRecommendation): ExecutionBlockReason | null {
  if (rec.shouldSend) return null;
  switch (rec.blockedReason) {
    case "incentive_required_before_send":
      return "INCENTIVE_REQUIRED";
    case "incentive_unavailable":
      return "INCENTIVE_UNAVAILABLE";
    case "low_confidence":
      return "LOW_CONFIDENCE";
    case "template_missing":
      return "TEMPLATE_MISSING";
    case "template_inactive":
    case "template_invalid":
    case "cta_missing":
    case "render_unknown":
    case "empty_message":
    case "product_missing":
    case "cart_data_missing":
      return "TEMPLATE_INVALID";
    case "purchased":
      return "PURCHASED";
    case "decision_stop":
      return "SUPPRESSED";
    default:
      return "NO_ACTION";
  }
}

function block(
  reason: ExecutionBlockReason,
  rec: MarketingRecommendation,
  templateKey: string | null,
  issues?: string[],
): BlockedExecution {
  return {
    allowed: false,
    reason,
    reasonAr: EXECUTION_BLOCK_LABELS[reason],
    ...(issues && issues.length ? { issues } : {}),
    channel: null,
    strategy: rec.strategy,
    templateKey,
    message: null,
    title: null,
    idempotencyKey: null,
    expectedMessageCount: null,
  };
}

/**
 * فحص محتوى الرسالة النهائية — أي خلل = TEMPLATE_INVALID (fail-safe).
 *
 * G6-C: القسيمة تُعرض للعميل أو لا تُرسل الرسالة أصلًا.
 *
 * قاعدتان متلاصقتان:
 *  1) ادعاء الخصم يُقبل فقط إن ظهر كود القسيمة في نفس النص — رسالة تَعِد
 *     بخصم بلا كود تبقى ممنوعة مهما وُجدت قسيمة elsewhere في الحالة.
 *  2) رسالة حافز بلا كود ظاهر = وعد لا يستطيع العميل الوفاء به: إشعار فيه
 *     «discount» دون الكود يجعل الاعتماد على وعد ميّت. لذلك يُمرَّر
 *     `couponCodeVisible` لتمييز «القالب لم يعرض الكود» عن «الكود قُصّ
 *     لاحقًا»، ويبقى المنع واحدًا في الحالتين.
 */
function contentIssues(
  bodyValue: unknown,
  title: string,
  coupon: RecoveryCouponView | null,
  couponCodeVisible: boolean
): string[] {
  const issues: string[] = [];
  const body = String(bodyValue ?? "");
  if (!body.trim()) issues.push("رسالة فارغة");
  if (body.length > TEMPLATE_BODY_MAX) issues.push(`أطول من ${TEMPLATE_BODY_MAX} حرفًا`);
  const tokens = listTemplateTokens(body);
  if (tokens.length) issues.push(`رموز متغيرات متبقية في النص النهائي (${tokens.join("، ")})`);
  const validation = validateTemplate(body);
  if (validation.unknown.length) issues.push(`متغيرات غير معروفة (${validation.unknown.join("، ")})`);
  if (validation.blockedInternal.length) issues.push(`متغيرات خصم داخلية ممنوعة (${validation.blockedInternal.join("، ")})`);
  const code = normalizeCouponCode(coupon?.code ?? "");
  const couponShown = code.length > 0 && body.includes(code);
  if (coupon && !couponShown) {
    issues.push(`كود القسيمة غير ظاهر في الرسالة${couponCodeVisible ? "" : " (والمتغيّر غير مستخدَم في القالب)"}`);
  }
  const claims = unprovenClaims(body, { allowDiscountClaim: couponShown });
  if (claims.length) issues.push(`ادعاءات بلا بيانات (${claims.join("، ")})`);
  if (!String(title ?? "").trim()) issues.push("عنوان فارغ");
  return issues;
}

/**
 * قرار التنفيذ — دالة نقية حتمية.
 *
 * سلسلة الأولوية (مقصودة، لا تُكسر):
 *   1) مفتاح النظام (ممكّن؟ معاينة؟)
 *   2) الشراء/الإغلاق على مستوى حالة الحالة (power race snapshot) وقرار التوصية.
 *   3) رفض التوصية نفسها (لا إجراء/ثقة/قالب/حافز…).
 *   4) الهوية والقناة (رقم صالح دوليًا فقط).
 *   5) الحد الأقصى للرسائل ثم cooldown العام.
 *   6) الحافز: مرشّح حافز بلا كوبون حقيقي = ممنوع نهائيًا (لا رسالة توحي بخصم).
 *   7) القالب والمحتوى: قالب معروف سليم، رسالة غير فارغة بلا رموز/ادعاءات.
 *   8) تكرار/قيد التنفيذ: مفتاح idempotency مستعمل؟ رسالة في الطريق؟
 */
export function guardExecution(input: ExecutionGuardInput): ExecutionDecision {
  const { recommendation: rec, caseState: state, cfg } = input;
  const stage = input.stage ?? null;
  const contact = input.contact ?? null;
  const coupon = input.coupon ?? null;
  const now = Number.isFinite(input.now as number) ? (input.now as number) : Date.now();

  // 1) مفتاح النظام.
  if (!cfg.enabled) return block("RECOVERY_DISABLED", rec, rec.templateKey ?? null);
  if (cfg.dryRun) return block("DRY_RUN", rec, rec.templateKey ?? null);

  // 2) الشراء/الإغلاق — تفحص لقطة الحالة الحالية، لا قرار التوصية فقط (purchase race).
  const status = String(state.status ?? "").toUpperCase();
  const purchased =
    status === "PURCHASED" ||
    state.purchased === true ||
    rec.blockedReason === "purchased";
  const suppressed =
    !purchased &&
    (status === "SUPPRESSED" || status === "EXPIRED" || status === "CANCELLED" ||
      state.suppressed === true ||
      rec.blockedReason === "decision_stop");
  if (purchased) return block("PURCHASED", rec, rec.templateKey ?? null);
  if (suppressed) return block("SUPPRESSED", rec, rec.templateKey ?? null);

  // 3) رفض التوصية نفسها.
  const refusal = reasonFromRefusal(rec);
  if (refusal) return block(refusal, rec, rec.templateKey ?? null);

  // 4) الهوية والقناة.
  if (!state.customerId || !state.customerPhone) return block("NO_PHONE", rec, rec.templateKey ?? null);
  if (!normalizePhoneInternational(state.customerPhone)) return block("INVALID_PHONE", rec, rec.templateKey ?? null);

  // 5) الحد الأقصى ثم cooldown.
  const messageCount = Number.isFinite(state.messageCount as number) ? (state.messageCount as number) : 0;
  const maxMessages = stage?.maxTotalMessages ?? cfg.maxMessages;
  if (Number.isFinite(maxMessages as number) && (maxMessages as number) > 0 && messageCount >= (maxMessages as number)) {
    return block("MESSAGE_LIMIT", rec, rec.templateKey ?? null);
  }
  if (state.lastMessageAt && now - state.lastMessageAt < cfg.globalCooldownHours * HOUR_MS) {
    return block("RECENT_CONTACT", rec, rec.templateKey ?? null);
  }

  // 6) الحافز: لا حافز بلا كوبون فعلي — حتى إن وصلت توصية «إرسال حافز».
  const needsCoupon = rec.strategy === "INCENTIVE_CANDIDATE" || rec.incentiveMode === "REQUIRED_BEFORE_SEND";
  if (needsCoupon && !coupon) return block("INCENTIVE_REQUIRED", rec, rec.templateKey ?? null);

  // 7) القالب والمحتوى — دفاع ثانٍ مهما قالت التوصية.
  const templateKey = rec.templateKey;
  if (!templateKey) return block("TEMPLATE_MISSING", rec, null);
  const catalogTemplate = MARKETING_TEMPLATES.find((t) => t.key === templateKey);
  if (!catalogTemplate) return block("TEMPLATE_MISSING", rec, templateKey);
  if (catalogTemplate.isActive === false) return block("TEMPLATE_INVALID", rec, templateKey);
  const integrity = templateIntegrity(catalogTemplate);
  if (!integrity.ok) return block("TEMPLATE_INVALID", rec, templateKey);
  // القالب الذي لا يعرض `{{coupon.code}}` لن يوصل الكود، فالتوصية تُعدّ
  // ناقصة المحتوى حتى لو مُرّر الكود إليها.
  const couponCodeVisible = listTemplateTokens(String(rec.body ?? "")).some((t) =>
    COUPON_CODE_TOKENS.has(t)
  );
  const issues = contentIssues(rec.body, rec.title, coupon, couponCodeVisible);
  if (issues.length) return block("TEMPLATE_INVALID", rec, templateKey, issues);

  // 8) التكرار / قيد التنفيذ.
  const idempotencyKey = buildExecutionIdempotencyKey({
    caseId: state.id,
    stageKey: stage?.key ?? null,
    messageCount,
    templateKey,
    variantIndex: rec.variantIndex,
    recoveryDecision: input.recoveryDecision ?? null,
  });
  if (contact?.seenKeys && contact.seenKeys.includes(idempotencyKey)) {
    return block("DUPLICATE", rec, templateKey);
  }
  if (contact?.inFlight === true) return block("ALREADY_IN_FLIGHT", rec, templateKey);

  return {
    allowed: true,
    reason: "OK",
    reasonAr: "مسموح بالإرسال — يُنفَّذ عبر RecoveryDispatcher الموجود.",
    channel: EXECUTION_CHANNEL,
    strategy: rec.strategy,
    templateKey,
    message: String(rec.body ?? "").trim(),
    title: rec.title,
    idempotencyKey,
    expectedMessageCount: messageCount + 1,
  };
}

// ---------------------------------------------------------------
// الجسر إلى مسار الإرسال الموجود (لا حارس ولا إنشاء ثانٍ)
// ---------------------------------------------------------------

/**
 * إسقاط القرار المسموح إلى خطة إدراج بمفاهيم مسار الإرسال الموجود.
 *
 * هذه هي نقطة الربط الوحيدة بالتنفيذ: نفس جدول notifications ونفس المفتاح
 * الحتمي deterministicNotificationId(caseId, messageCount) ونفس القناة
 * whatsapp التي يستخدمها RecoveryDispatcher — لا مسار جديد ولا مكوّن واتساب
 * بديل. الدالة خالصة: لا تُدرج ولا تُرسل؛ من يستدعيها مسؤول عن استدعاء
 * RecoveryDispatcher الموجود لتنفيذها.
 */
export function buildDispatchPlan(decision: AllowedExecution, caseState: ExecutionCaseState): {
  notificationType: string;
  notificationId: string;
  caseId: string;
  expectedMessageCount: number;
  phone: string;
  title: string;
  message: string;
  actionUrl: string;
  channel: typeof EXECUTION_CHANNEL;
} {
  const messageCount = Number.isFinite(caseState.messageCount as number) ? (caseState.messageCount as number) : 0;
  return {
    notificationType: RECOVERY_CONTACT_TYPE,
    notificationId: deterministicNotificationId(caseState.id, messageCount),
    caseId: caseState.id,
    expectedMessageCount: messageCount + 1,
    phone: String(caseState.customerPhone ?? ""),
    title: decision.title,
    message: decision.message,
    actionUrl: EXECUTION_ACTION_URL,
    channel: EXECUTION_CHANNEL,
  };
}
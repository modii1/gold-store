/**
 * بناء رسالة الإرسال من المرحلة والقالب — وحدة نقية بلا أي اتصال (المرحلة 4).
 *
 * المصدر الوحيد للحقيقة لمساري الإرسال والمعاينة:
 *   - اختيار المرحلة الصحيحة للحالة (selectStageAt بالمؤكد messageCount).
 *   - القالب المربوط بها: مفقود/معطوب/غير مفعّل/متغيرات غير صالحة
 *     ⇒ fail-safe: لا تُبنى رسالة ولا يُرسل أي شيء.
 *   - بلا قالب (templateId = null) ⇒ الرسالة الافتراضية المحايدة كما هي.
 *   - المتغيرات تُبنى من بيانات الحالة الفعلية (buildRecoveryVariables)
 *     ويُصيَّر النص عبر renderTemplate بمسار العميل (discount.* داخلي لا
 *     يصل للعميل ويُسجَّل).
 *
 * النتيجة الواحدة سواء من dispatcher أو من محاكاة الإرسال: ما يُبنى هنا
 * هو ما سيُرسَل فعلًا، وما يُمنع هنا لا يصل لجدولة أبدًا.
 */

import { selectStageAt } from "./stages";
import type { RecoveryStage } from "./stages";
import { buildRecoveryVariables, renderTemplate } from "./variables";
import type { RenderResult } from "./variables";
import { templateRowHint } from "./template-control";
import type { ContactDecision, DiscountProposal, RecoveryCase, RecoveryCouponView } from "./types";

/** صورة قالب تُقرأ من القاعدة (أو من الواجهة) لبناء الرسالة. */
export type DispatchTemplate = {
  id: number;
  key: string;
  nameAr: string;
  title: string;
  body: string;
  isActive: boolean;
  version: number;
};

/**
 * الرسالة الافتراضية المحايدة — النص الثابت الحالي.
 *
 * لا تذكر نسبة خصم ولا كوبون، وrecommendedDiscount يبقى اقتراحًا داخليًا لا
 * يُصيَّر في النص أبدًا. الرسالة التي تَعِد بخصم لا تأتي من هنا: لا بدّ لها من
 * قالب مرتبط بقسيمة حقيقية.
 */
export function buildDefaultRecoveryMessage(c: RecoveryCase): { title: string; message: string } {
  const item = c.preferredProductSlug ? ` (${c.preferredProductSlug})` : "";
  return {
    title: "سلتك ما زالت محفوظة",
    message: `لاحظنا سلة غير مكتملة${item} في متجرنا، ونود إتمام طلبك. يمكنك الرجوع إلى سلتك في أي وقت لإكمال الشراء.`,
  };
}

export type DispatchMessageBlockReason =
  | "no_stage"
  | "template_missing"
  | "template_inactive"
  | "template_invalid"
  | "render_unknown"
  | "empty_message"
  /** G6-C: القالب يَعِد بقسيمة ولا توجد قسيمة حقيقية لهذه الحالة. */
  | "coupon_required";

export type DispatchMessageOutcome =
  | {
      status: "send";
      title: string;
      message: string;
      /** true = مرسلة من قالب؛ false = الرسالة الافتراضية (لا قالب مربوط). */
      usedTemplate: boolean;
    }
  | { status: "block"; reason: DispatchMessageBlockReason; reasonAr: string };

/** الترجمة العربية لقرار المحرك — تُستخدم كمصدر لمتغير {{recovery.decision_ar}}. */
export function decisionLabelAr(decision: ContactDecision | null | undefined): string {
  switch (decision) {
    case "DISCOUNT_ELIGIBLE":
      return "مؤهل للخصم";
    case "REMINDER_ONLY":
      return "تذكير فقط";
    case "NO_INCENTIVE":
      return "بلا حافز";
    default:
      return "";
  }
}

/**
 * بناء رسالة الإرسال لحالة واحدة.
 *
 * fail-safe صارم: أي شك في الجدولة (بلا مرحلة، قالب ناقص/معطوب/مغلق،
 * متغيرات غير معروفة، أو رسالة فارغة ناتجة) ⇒ block بلا إرسال. لا
 * نحاول «إصلاح» النص المنشق بالنية أبدًا: المالكة تقرره، والنظام يطبقه.
 */
export function buildDispatchMessage(input: {
  case: RecoveryCase;
  stages: RecoveryStage[];
  /** كل القوالب المعروفة (نشطة وغير نشطة) — البحث بالمعرّف. */
  templates: DispatchTemplate[];
  discount?: DiscountProposal | null;
  /** G6-C: القسيمة المعروضة (من الخادم) — تُصيَّر {{coupon.*}}. */
  coupon?: RecoveryCouponView | null;
  /**
   * G6-C: نص الحافز من كتالوج Marketing.
   *
   * الحافز ليس رسالة مرحلة: قوالب المراحل رسائل استرجاع محايدة (سلتك محفوظة،
   * أكملي الطلب) ولا يصح أن تُقحم قسيمة في كل رسالة مرحلة. فحين يوصي محرك
   * القرار بالحافز وتمر قسيمة حقيقية، يُبنى النص من قالب الحافز — نفس
   * الدالة ونفس المتغيرات ونفس الفحوص أدناه. الحارس يبقى الفيصل: إن لم يظهر
   * الكود في النص الناتج، يُمنع الإرسال.
   */
  incentiveBody?: { body: string; title: string } | null;
  now?: number;
  expiryHours?: number;
  decisionAr?: string | null;
}): DispatchMessageOutcome {
  const c = input.case;
  const stage = selectStageAt(input.stages, c.messageCount);
  if (!stage) {
    return {
      status: "block",
      reason: "no_stage",
      reasonAr: "لا توجد مرحلة مطابقة لعدد الرسائل — لا إرسال (fail-safe).",
    };
  }

  // G6-C — مسار الحافز: النص يأتي من كتالوج Marketing لا من قالب المرحلة،
  // لكن يمرّ بنفس المتغيرات ونفس الفحوص. لا يُغني ذلك عن الحارس.
  if (input.incentiveBody) {
    const body = input.incentiveBody;
    return renderIncentiveBody({ ...input, stage, label: body.title, incentiveBody: body });
  }

  // لا قالب مربوط بالمرحلة ⇒ الرسالة الافتراضية المحايدة، كما كان الحال دائمًا.
  if (stage.templateId === null) {
    return { status: "send", ...buildDefaultRecoveryMessage(c), usedTemplate: false };
  }

  const template = input.templates.find((t) => t.id === stage.templateId);
  if (!template) {
    return {
      status: "block",
      reason: "template_missing",
      reasonAr: `المرحلة «${stage.nameAr}» مرتبطة بقالب غير موجود (id=${stage.templateId}) — لا إرسال.`,
    };
  }
  if (!template.isActive) {
    return {
      status: "block",
      reason: "template_inactive",
      reasonAr: `القالب «${template.nameAr}» المرتبط بالمرحلة غير مفعّل — لا إرسال.`,
    };
  }

  // إعادة الفحص نفسها التي تراها لوحة الإدارة: صف معطوب لا يُرسَل منه شيء.
  const hint = templateRowHint({
    key: template.key,
    name_ar: template.nameAr,
    title: template.title,
    body: template.body,
    is_active: template.isActive,
    version: template.version,
  });
  if (hint !== null) {
    return {
      status: "block",
      reason: "template_invalid",
      reasonAr: `القالب «${template.nameAr}» معطوب (${hint}) — لا إرسال.`,
    };
  }

  const values = buildRecoveryVariables({
    case: c,
    stage,
    stageIndex: stage.position,
    stageTotal: input.stages.length,
    discount: input.discount ?? null,
    coupon: input.coupon ?? null,
    now: input.now,
    expiryHours: input.expiryHours,
    decisionAr: input.decisionAr ?? null,
  });

  // مسار العميل: discount.* داخلي يُحذف ويُسجَّل، والرموز غير المعروفة
  // لو وُجدت (مع ذلك) تمنع بناء رسالة صحيحة ⇒ لا إرسال.
  // G6-C: قالب فيه {{coupon.*}} بلا قسيمة حقيقية يُحجب كاملًا — لا نص ناقص
  // ولا كود مختلَق يصل العميل.
  const rendered = renderTemplate(template.body, values, { coupon: input.coupon ?? null });
  if (rendered.unknown.length) {
    return {
      status: "block",
      reason: "render_unknown",
      reasonAr: `متغيرات غير معروفة في القالب (${rendered.unknown.join("، ")}) — لا إرسال.`,
    };
  }
  if (rendered.blockedCoupon.length) {
    return {
      status: "block",
      reason: "coupon_required",
      reasonAr: `القالب «${template.nameAr}» يحتاج قسيمة حقيقية لهذه الحالة ولا توجد (${rendered.blockedCoupon.join("، ")}) — لا إرسال.`,
    };
  }

  const message = rendered.text.trim();
  if (!message) {
    return {
      status: "block",
      reason: "empty_message",
      reasonAr: "الرسالة الناتجة فارغة بعد التصيير (كل المتغيرات داخلية أو بدائل فارغة) — لا إرسال.",
    };
  }

  const title = template.title.trim() || buildDefaultRecoveryMessage(c).title;
  return { status: "send", title, message, usedTemplate: true };
}

/**
 * G6-C: تصيير نص الحافز بنفس قواعد تصيير القوالب.
 *
 * الفحوص هنا ليست مكرَّرة من باب الحذر: هي نفس الفحوص التي يمرّ بها قالب
 * المرحلة، ووجودها يمنع أن يصبح مسار الحافز أضعف من المسار العادي (قالب
 * فيه رمز مجهول، أو قسيمة مطلوبة بلا قسيمة، أو نص فارغ).
 */
function renderIncentiveBody(input: {
  case: RecoveryCase;
  stages: RecoveryStage[];
  discount?: DiscountProposal | null;
  coupon?: RecoveryCouponView | null;
  incentiveBody: { body: string; title: string };
  stage: RecoveryStage;
  label: string;
  now?: number;
  expiryHours?: number;
  decisionAr?: string | null;
}): DispatchMessageOutcome {
  const { stage } = input;
  const values = buildRecoveryVariables({
    case: input.case,
    stage,
    stageIndex: stage.position,
    stageTotal: input.stages.length,
    discount: input.discount ?? null,
    coupon: input.coupon ?? null,
    now: input.now,
    expiryHours: input.expiryHours,
    decisionAr: input.decisionAr ?? null,
  });
  const rendered = renderTemplate(input.incentiveBody.body, values, { coupon: input.coupon ?? null });
  if (rendered.unknown.length) {
    return {
      status: "block",
      reason: "render_unknown",
      reasonAr: `متغيرات غير معروفة في نص الحافز (${rendered.unknown.join("، ")}) — لا إرسال.`,
    };
  }
  if (rendered.blockedCoupon.length) {
    return {
      status: "block",
      reason: "coupon_required",
      reasonAr: `نص الحافز يحتاج قسيمة حقيقية لهذه الحالة ولا توجد (${rendered.blockedCoupon.join("، ")}) — لا إرسال.`,
    };
  }
  const message = rendered.text.trim();
  if (!message) {
    return {
      status: "block",
      reason: "empty_message",
      reasonAr: "نص الحافز فارغ بعد التصيير — لا إرسال.",
    };
  }
  return { status: "send", title: input.label.trim(), message, usedTemplate: true };
}

/** القيم والمصفّف الفعليان لحالة ما — للعرض في المحاكاة دون إعادة حساب. */
export type DispatchRenderTrace = {
  values: Record<string, string>;
  render: RenderResult;
};

export function renderDispatchTrace(input: {
  case: RecoveryCase;
  stages: RecoveryStage[];
  templates: DispatchTemplate[];
  discount?: DiscountProposal | null;
  /** G6-C: القسيمة المعروضة في المعاينة (تصل من production فقط، لا قيم وهمية). */
  coupon?: RecoveryCouponView | null;
  now?: number;
  expiryHours?: number;
  decisionAr?: string | null;
}): DispatchRenderTrace | null {
  const stage = selectStageAt(input.stages, input.case.messageCount);
  if (!stage || stage.templateId === null) return null;
  const template = input.templates.find((t) => t.id === stage.templateId);
  if (!template) return null;
  const values = buildRecoveryVariables({
    case: input.case,
    stage,
    stageIndex: stage.position,
    stageTotal: input.stages.length,
    discount: input.discount ?? null,
    coupon: input.coupon ?? null,
    now: input.now,
    expiryHours: input.expiryHours,
    decisionAr: input.decisionAr ?? null,
  });
  return { values, render: renderTemplate(template.body, values, { coupon: input.coupon ?? null }) };
}
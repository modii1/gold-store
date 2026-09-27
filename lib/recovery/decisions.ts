import type { RecoveryConfig } from "./config";
import type { ContactOutcome, DiscountProposal, RecoveryCase, ReminderStep } from "./types";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export type ContactContext = {
  now: number;
  /** العميل لديه طلب مكتمل — يُمنع التواصل (قاعدة "رسالة إذا كان هناك order مكتمل"). */
  hasCompletedOrder?: boolean;
};

/** جدول التذكيرات: 30د / 6س / 24س ثم STOP. */
export function buildReminderSchedule(firstAt: number, cfg: RecoveryConfig): ReminderStep[] {
  return cfg.remindersMinutes.map((offsetMinutes, index) => ({
    step: index + 1,
    offsetMinutes,
    at: firstAt + offsetMinutes * MINUTE,
  }));
}

function closedOutcome(c: RecoveryCase): ContactOutcome {
  return {
    caseId: c.id,
    decision: "NO_INCENTIVE",
    wouldSend: false,
    suppressReason: `closed:${c.status.toLowerCase()}`,
    recommendedAction: "الحالة مغلقة — لا تواصل",
    recommendedDiscount: null,
    nextActionAt: null,
  };
}

export function discountProposal(cartValue: number, cfg: RecoveryConfig): DiscountProposal | null {
  if (!Number.isFinite(cartValue) || cartValue <= 0) return null;
  const percent = Math.min(cfg.proposedRecoveryDiscountPercent, cfg.maxRecoveryDiscountPercent);
  const raw = (cartValue * percent) / 100;
  const value = Math.min(Math.round(raw * 100) / 100, cfg.maxRecoveryDiscountAmount);
  if (value <= 0) return null;
  return { percent, cap: cfg.maxRecoveryDiscountAmount, value };
}

/**
 * القرار المركزي: هل نتواصل، ومتى، وما الخصم المقترح.
 * في DRY_RUN: ناتج قرار فقط — بدون أي إرسال/إنشاء فعلي.
 */
export function evaluateContact(c: RecoveryCase, ctx: ContactContext, cfg: RecoveryConfig): ContactOutcome {
  if (c.status === "PURCHASED" || c.status === "CANCELLED" || c.status === "SUPPRESSED" || c.status === "EXPIRED") {
    return closedOutcome(c);
  }

  const ageMs = ctx.now - (c.firstDetectedAt || ctx.now);
  const ageHours = ageMs / HOUR;

  // انتهاء الحالة الزمني: لا نُجدِلها بعد expiryHours.
  if (cfg.expiryHours > 0 && ageHours >= cfg.expiryHours) {
    return {
      ...closedOutcome(c),
      suppressReason: "expired",
      recommendedAction: "انتهت مهلة الاسترجاع — تُغلق الحالة",
    };
  }

  // لا تواصل إذا وُجد طلب مكتمل.
  if (ctx.hasCompletedOrder) {
    return { ...closedOutcome(c), suppressReason: "order_completed", recommendedAction: "طلب مكتمل — لا رسالة" };
  }

  // بدون قناة تواصل موثوقة (زائر مجهول) — لا يُطلب تحديد هويته، يبقى OPEN.
  if (!c.customerPhone) {
    return {
      caseId: c.id,
      decision: "NO_INCENTIVE",
      wouldSend: false,
      suppressReason: "anonymous",
      recommendedAction: "زائر مجهول — لا تواصل (العميل المسجل فقط مؤهل)",
      recommendedDiscount: null,
      nextActionAt: null,
    };
  }

  // حد أقصى للرسائل.
  if (c.messageCount >= cfg.maxMessages) {
    return { ...closedOutcome(c), suppressReason: "max_messages", recommendedAction: "بلغت الحالة الحد الأقصى من الرسائل" };
  }

  // مهلة عمومية بين الرسائل.
  if (c.lastMessageAt && ctx.now - c.lastMessageAt < cfg.globalCooldownHours * HOUR) {
    return {
      caseId: c.id,
      decision: "REMINDER_ONLY",
      wouldSend: false,
      suppressReason: "cooldown",
      recommendedAction: "تُمنَع الرسالة — العميل في فترة cooldown عامة",
      recommendedDiscount: null,
      nextActionAt: (c.lastMessageAt ?? ctx.now) + cfg.globalCooldownHours * HOUR,
    };
  }

  const schedule = buildReminderSchedule(c.firstDetectedAt, cfg);
  const firstReminderAt = schedule[0]?.at ?? ctx.now;

  // مبكر جدًا: السلة حياة أقل من التذكير الأول (لا مكافأة ولا إزعاج).
  if (ctx.now < firstReminderAt) {
    return {
      caseId: c.id,
      decision: "NO_INCENTIVE",
      wouldSend: false,
      suppressReason: "too_early",
      recommendedAction: "لا إجراء بعد — التذكير الأول بعد دقائق",
      recommendedDiscount: null,
      nextActionAt: firstReminderAt,
    };
  }

  // مهلة الخصم (لا يُمنح خصم Recovery متكرر قريب).
  const discountCooled =
    !c.lastDiscountAt || ctx.now - c.lastDiscountAt >= cfg.discountCooldownHours * HOUR;
  const cartQualifies = c.cartValue !== null && c.cartValue >= cfg.minCartValueForDiscount;
  const seenReminder = !cfg.discountRequiresPriorReminder || c.messageCount >= 1;
  const discountEligible =
    discountCooled &&
    c.discountCount < cfg.maxDiscountsPerCase &&
    ageHours >= cfg.discountEligibleAfterHours &&
    cartQualifies &&
    seenReminder &&
    !c.discountRef;

  if (discountEligible) {
    const proposal = discountProposal(c.cartValue as number, cfg);
    if (proposal) {
      return {
        caseId: c.id,
        decision: "DISCOUNT_ELIGIBLE",
        wouldSend: true,
        recommendedAction: "عرض خصم استرجاع — المرحلة الأخيرة قبل الإغلاق",
        recommendedDiscount: proposal,
        nextActionAt: null,
      };
    }
  }

  // تذكير عادي (خطوة التذكير التالية في الجدول).
  const stepIndex = Math.min(c.messageCount, schedule.length - 1);
  const nextAt = schedule[stepIndex]?.at ?? ctx.now;
  const stepLabel = schedule[stepIndex]?.step ?? c.messageCount + 1;
  return {
    caseId: c.id,
    decision: "REMINDER_ONLY",
    wouldSend: true,
    recommendedAction: `تذكير ${stepLabel} — بعد ${schedule[stepIndex]?.offsetMinutes ?? 0} دقيقة من النشاط الأول`,
    recommendedDiscount: null,
    nextActionAt: ctx.now < nextAt ? nextAt : ctx.now,
  };
}
import type { RecoveryCase } from "./types";

export type RecoveryOrderSummary = { total: number; discount: number };

/**
 * دليل على أن Recovery نفّذ تدخلًا فعليًا قبل الشراء.
 * يُشتق من السجل الدائم recovery_contact_attempts (append-only) — لا من
 * decision ولا recommendedDiscount ولا wouldSend ولا nextActionAt: تلك كلها
 * نواتج تقييم، لا أفعال منفَّذة.
 */
export type RecoveryIntervention = {
  caseId: string;
  channel: string;
  sentAt: number;
  couponRef: string | null;
};

/**
 * مقاييس الاسترجاع.
 *
 * قاعدة ثابتة: recovered = شراءٌ سبقه تدخّل Recovery موثّق بسجل دائم.
 * شراء طبيعي (case + PURCHASED + purchase_ref) = conversion لا recovery،
 * ويُحتسب في naturalConversions ولا يدخل أي رقم استعادة.
 */
export type RecoveryMetrics = {
  /** حالات مفتوحة قيد المتابعة. */
  potentialRecoveryCandidates: number;
  /** عمليات غير مكتملة (حالات نشطة لم تُشترَ). */
  incompleteOperations: number;
  /** Checkout غير مكتمل تحديدًا. */
  incompleteCheckouts: number;
  /** مؤهلون للخصم (آخر قرار DISCOUNT_ELIGIBLE). */
  discountEligible: number;
  /**
   * استعادة مُثبتة: حالة لها purchase_ref AND تدخّل موثّق قبل وقت الطلب.
   * صفر اليوم — لا يوجد dispatcher يُسجّل تدخّلًا فعليًا.
   */
  recovered: number;
  /** معدل الاسترجاع % = استعادة مُثبتة / حالات كان يمكن التخلخل عليها. */
  recoveryRate: number;
  /** مبيعات استُرجعت فعليًا (طلبات ذات تدخّل موثّق سابق). */
  recoveredRevenue: number;
  /** تكلفة الخصومات فعلًا على الطلبات المسترجعة. */
  discountCost: number;
  /** صافي المبيعات المسترجعة. */
  netRecoveredRevenue: number;
  /** تحويلات طبيعية: case أُغلقت بالشراء بلا تدخّل Recovery. */
  naturalConversions: number;
  /** رسائل مُنعت بسبب cooldown. */
  cooldownBlocked: number;
};

const CLOSED: RecoveryCase["status"][] = ["PURCHASED", "EXPIRED", "CANCELLED", "SUPPRESSED"];

/**
 * هل تثبت هذه الحالة استعادة؟
 *
 * كل الشرط مطلوب — غياب أي واحد يعني "ليس recovery":
 *   1. الحالة مغلقة بالشراء فعلًا (PURCHASED).
 *   2. purchase_ref يشير إلى طلب حقيقي.
 *   3. يوجد تدخّل Recovery موثّق لهذه الحالة.
 *   4. زمن التدخّل سابق لزمن إنشاء الطلب (intervention.sent_at < order.created_at).
 *
 * لا يكفي وجود purchase_ref، ولا تطابق رقم الجوال، ولا messageCount،
 * ولا decision = DISCOUNT_ELIGIBLE: كلها لا تثبت تدخّلًا نُفِّذ.
 */
export function isVerifiedRecovery(args: {
  status: RecoveryCase["status"];
  purchaseRef: string | null;
  /** وقت إنشاء الطلب المرتبط (ms)، أو null إذا لم يُعرَف. */
  orderCreatedAt: number | null;
  /** كل التدخلات الموثّقة لهذه الحالة، مرتّبة زمنيًا. */
  interventions: RecoveryIntervention[];
  /** وقت بدء الحالة (ms) — للتأكد أن التدخّل يخصّ هذه الحالة لا غيرها. */
  caseCreatedAt?: number | null;
}): boolean {
  if (args.status !== "PURCHASED") return false;
  if (!args.purchaseRef) return false;
  const orderAt = args.orderCreatedAt;
  // بدون وقت الطلب لا يمكن إثبات أن التدخّل سبقه ⇒ لا استعادة.
  if (orderAt === null) return false;
  return args.interventions.some((i) => {
    // التدخّل يجب أن يسبق الطلب: intervention.sent_at < order.created_at
    if (!(i.sentAt < orderAt)) return false;
    // ويجب أن يخصّ هذه الحالة: لا يُقبل تدخّل سابق لبداية الحالة
    // (تدخّل على حالة أخرى أو على طلب أقدم).
    if (typeof args.caseCreatedAt === "number" && i.sentAt < args.caseCreatedAt) return false;
    return true;
  });
}

export function computeMetrics(
  cases: RecoveryCase[],
  ordersByRef: Map<string, RecoveryOrderSummary>,
  /**
   * سجل التدخلات الدائم مفهرسًا بمعرّف الحالة.
   * فارغ = لا يوجد أي تدخل مُنفَّذ (الوضع الحالي) ⇒ recovered = 0.
   */
  interventionsByCase: Map<string, RecoveryIntervention[]> = new Map(),
  /** وقت إنشاء كل طلب معرّف بـ purchase_ref (ms)، لإثبات السببية. */
  orderCreatedAtByRef: Map<string, number> = new Map()
): RecoveryMetrics {
  const active = cases.filter((c) => !CLOSED.includes(c.status));
  const discountEligible = cases.filter((c) => c.decision === "DISCOUNT_ELIGIBLE").length;
  const cooldownBlocked = cases.filter((c) => c.suppressReason === "cooldown").length;

  // classifications: مُثبتة (recovery) مقابل تحويل طبيعي.
  const verified: { c: RecoveryCase; order: RecoveryOrderSummary }[] = [];
  let naturalConversions = 0;
  const seenRefs = new Set<string>();

  for (const c of cases) {
    if (c.status !== "PURCHASED" || !c.purchaseRef) continue;
    // فك ازدواج على purchase_ref: لا يُحتسب الطلب مرتين مهما تعدّدت الحالات.
    if (seenRefs.has(c.purchaseRef)) continue;
    seenRefs.add(c.purchaseRef);

    const interventions = interventionsByCase.get(c.id) ?? [];
    const isRecovered = isVerifiedRecovery({
      status: c.status,
      purchaseRef: c.purchaseRef,
      orderCreatedAt: orderCreatedAtByRef.get(c.purchaseRef) ?? null,
      interventions,
      caseCreatedAt: c.firstDetectedAt,
    });

    if (isRecovered) {
      verified.push({ c, order: ordersByRef.get(c.purchaseRef) ?? { total: 0, discount: 0 } });
    } else {
      // شراء طبيعي: يغلق الحالة لكن ليس استعادة.
      naturalConversions++;
    }
  }

  const recovered = verified.length;
  let recoveredRevenue = 0;
  let discountCost = 0;
  for (const { order } of verified) {
    recoveredRevenue += order.total;
    discountCost += order.discount;
  }

  // المقام = الحالات التي كان يمكن للتخلخل أن ينطبق عليها: عميل معروف
  // وحالة نشطة أو أُغلقت بالشراء. لا تُحتسب الحالات الموقوفة.
  const eligibleDenominator = cases.filter(
    (c) => c.customerPhone && c.status !== "SUPPRESSED" && c.status !== "EXPIRED" && c.status !== "CANCELLED"
  ).length;
  const recoveryRate = eligibleDenominator > 0 ? Math.round((recovered / eligibleDenominator) * 1000) / 10 : 0;

  return {
    potentialRecoveryCandidates: active.length,
    incompleteOperations: active.filter((c) => c.status !== "PURCHASED").length,
    incompleteCheckouts: active.filter((c) => c.caseType === "CHECKOUT_STARTED" || c.caseType === "PAYMENT_STARTED").length,
    discountEligible,
    recovered,
    recoveryRate,
    recoveredRevenue: Math.round(recoveredRevenue * 100) / 100,
    discountCost: Math.round(discountCost * 100) / 100,
    netRecoveredRevenue: Math.round((recoveredRevenue - discountCost) * 100) / 100,
    naturalConversions,
    cooldownBlocked,
  };
}

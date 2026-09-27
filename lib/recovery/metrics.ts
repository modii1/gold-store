import type { RecoveryCase } from "./types";

export type RecoveryOrderSummary = { total: number; discount: number };

/**
 * مقاييس الاسترجاع — النجاح الحقيقي = Purchase فقط.
 * message sent ≠ success، click ≠ success، coupon created ≠ success.
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
  /** الحالات المغلفة بشراء. */
  recovered: number;
  /** معدل الاسترجاع % = مشتريات مسترجعة / حالات مؤهلة للتواصل. */
  recoveryRate: number;
  /** مبيعات مسترجعة (مجموع طلبات الحالات المسترجعة). */
  recoveredRevenue: number;
  /** تكلفة الخصومات فعلًا على الطلبات المسترجعة. */
  discountCost: number;
  /** صافي المبيعات المسترجعة. */
  netRecoveredRevenue: number;
  /** رسائل مُنعت بسبب cooldown. */
  cooldownBlocked: number;
};

const CLOSED: RecoveryCase["status"][] = ["PURCHASED", "EXPIRED", "CANCELLED", "SUPPRESSED"];

export function computeMetrics(cases: RecoveryCase[], ordersByRef: Map<string, RecoveryOrderSummary>): RecoveryMetrics {
  const active = cases.filter((c) => !CLOSED.includes(c.status));
  const discountEligible = cases.filter((c) => c.decision === "DISCOUNT_ELIGIBLE").length;
  const cooldownBlocked = cases.filter((c) => c.suppressReason === "cooldown").length;

  const recoveredRows = cases.filter((c) => c.status === "PURCHASED" && c.purchaseRef);
  // المسترجعات تُحصى مرة واحدة (فك الازدواج على purchase_ref).
  const uniqueRefs = new Set<string>();
  let recoveredRevenue = 0;
  let discountCost = 0;
  for (const row of recoveredRows) {
    if (!row.purchaseRef || uniqueRefs.has(row.purchaseRef)) continue;
    uniqueRefs.add(row.purchaseRef);
    const order = ordersByRef.get(row.purchaseRef);
    recoveredRevenue += order?.total ?? 0;
    discountCost += order?.discount ?? 0;
  }
  const recovered = uniqueRefs.size;

  // المقام = الحالات التي كانت مؤهلة للتواصل (عميل معروف).
  const eligibleDenominator = cases.filter((c) => c.customerPhone && c.status !== "SUPPRESSED").length;
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
    cooldownBlocked,
  };
}
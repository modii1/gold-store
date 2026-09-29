/**
 * نموذج الثقة (Phase 3) — مقدار اكتمال البيانات التي تدعم قرار الاسترجاع.
 *
 * العلاقة بـ «النية» مقصودة:
 *  - النية (computeIntent) تقيس قوّة الدلالة،
 *  - الثقة هنا تقيس مدى ثقة الدلالة نفسها: هل نعرف من هو العميل،
 *    هل نعرف المنتج والسلة، كم إشارة مميّزة، وكم مضى على الحدث.
 *
 * قاعدة الاستخدام: الثقة تضعف القرار لا تعلّمه. البيانات الناقصة تخفض
 * الثقة حتى مع نية عالية، والتقادم الشديد يحبسها في المستوى الأدنى
 * (maxScoreForExtremeStale) بدل إيقاف الحساب.
 *
 * الوحدة نقية وحتمية: بلا اتصال وبلا آثار جانبية.
 */

import type { RecoveryConfig } from "./config";

export type ConfidenceLevel = "LOW" | "MEDIUM" | "HIGH";

export type ConfidenceReasonKey =
  | "identified"
  | "anonymous"
  | "signals"
  | "no_product"
  | "no_cart_value"
  | "sessions"
  | "stale";

export type ConfidenceEvidence = {
  /** هل يعرف النظام هوية العميل (جوال مسجّل)؟ */
  identified: boolean;
  /** عدد الإشارات المميّزة للحالة (مشاهدة/إضافة/إتمام/دفع) — بلا عدّ مزدوج. */
  signalCount: number;
  /** هل المنتج المفضّل للحالة معروف؟ */
  hasProduct: boolean;
  /** هل قيمة السلة معلومة؟ */
  hasCartValue: boolean;
  /** عدد الجلسات المميّزة التي شهدت نشاطًا. */
  sessions: number;
  /** ساعات منذ آخر نشاط. */
  recencyHours: number;
};

export type ConfidenceResult = {
  /** درجة 0..100. */
  score: number;
  level: ConfidenceLevel;
  /** مفاتيح الأسباب النوعية (للشاشة والفلاتر). */
  reasons: ConfidenceReasonKey[];
  /** شرح عربي سطر واحد. */
  reason: string;
};

function clamp100(n: number): number {
  return Math.round(Math.min(100, Math.max(0, n)));
}

/**
 * المستوى من الدرجة: < levelLow ⇒ LOW، ≥ levelHigh ⇒ HIGH، وإلا MEDIUM.
 */
export function confidenceLevelFor(score: number, cfg: RecoveryConfig): ConfidenceLevel {
  const s = Number.isFinite(score) ? score : 0;
  if (s < cfg.confidence.levelLow) return "LOW";
  if (s >= cfg.confidence.levelHigh) return "HIGH";
  return "MEDIUM";
}

/**
 * حساب الثقة من الأدلة.
 *
 * القواعد الحتمية:
 *  1. الهوية: معرف معرفًا ⇒ +identifiedWeight (وإلا «زائر مجهول»).
 *  2. الإشارات: min(signalCount, سقف) × signalWeight.
 *  3. المنتج معلوم ⇒ +hasProductWeight، وإلا سبب no_product.
 *  4. السلة معلومة ⇒ +cartValueWeight، وإلا سبب no_cart_value.
 *  5. الجلسات: min(جلسات−1, سقف) × sessionWeight.
 *  6. الحداثة: stale ضمن stalenessHours..extremeStaleHours ⇒ −stalenessPenalty؛
 *     أقدم من extremeStaleHours ⇒ تُحبس الدرجة دون maxScoreForExtremeStale
 *     (لا تبلغ HIGH أبدًا ببيانات متقادمة).
 */
export function computeConfidence(evidence: ConfidenceEvidence, cfg: RecoveryConfig): ConfidenceResult {
  const c = cfg.confidence;
  const reasons: ConfidenceReasonKey[] = [];

  let score = 0;
  if (evidence.identified) {
    score += c.identifiedWeight;
    reasons.push("identified");
  } else {
    reasons.push("anonymous");
  }

  const signalExtra = Math.max(0, Math.min(evidence.signalCount, Math.floor(c.signalCap / Math.max(1, c.signalWeight))));
  score += signalExtra * c.signalWeight;
  if (evidence.signalCount < 2) reasons.push("signals");

  if (evidence.hasProduct) {
    score += c.hasProductWeight;
  } else {
    reasons.push("no_product");
  }

  if (evidence.hasCartValue) {
    score += c.cartValueWeight;
  } else {
    reasons.push("no_cart_value");
  }

  const sessionExtra = Math.max(0, Math.min(evidence.sessions - 1, Math.floor(c.sessionCap / Math.max(1, c.sessionWeight))));
  score += sessionExtra * c.sessionWeight;
  if (sessionExtra <= 0 && evidence.sessions <= 1) reasons.push("sessions");

  const recency = Number.isFinite(evidence.recencyHours) ? evidence.recencyHours : Number.POSITIVE_INFINITY;
  if (recency > c.extremeStaleHours) {
    // متقادم جدًا: تُحبس الدرجة تحت مستوى LOW — لا ثقة عالية ببيانات معتّقة.
    score = Math.min(score, Math.max(1, c.maxScoreForExtremeStale - 1));
    reasons.push("stale");
  } else if (recency > c.stalenessHours) {
    score -= c.stalenessPenalty;
    reasons.push("stale");
  }

  const finalScore = clamp100(score);
  return {
    score: finalScore,
    level: confidenceLevelFor(finalScore, cfg),
    reasons: dedupe(reasons),
    reason: buildConfidenceReason(finalScore, evidence, recency, cfg),
  };
}

function dedupe(keys: ConfidenceReasonKey[]): ConfidenceReasonKey[] {
  return [...new Set(keys)];
}

/** تفسير عربي سطر واحد — يذكر ما رفع وأما ما خفض. */
function buildConfidenceReason(score: number, e: ConfidenceEvidence, recencyHours: number, cfg: RecoveryConfig): string {
  const parts: string[] = [];
  if (e.identified) parts.push("عميل معرّف");
  else parts.push("زائر مجهول");
  if (e.hasProduct) parts.push("المنتج معلوم");
  if (e.hasCartValue) parts.push("قيمة السلة معلومة");
  if (e.sessions > 1) parts.push(`${e.sessions} جلسات`);
  if (recencyHours > cfg.confidence.extremeStaleHours) parts.push("بيانات متقادمة جدًا");
  else if (recencyHours > cfg.confidence.stalenessHours) parts.push("بيانات متقادمة");
  return `${parts.join(" · ")} ⇒ ${score}/100 (${confidenceLevelFor(score, cfg)})`;
}
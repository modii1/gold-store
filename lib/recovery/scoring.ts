import type { RecoveryConfig } from "./config";
import type { RecoveryCase, SignalType } from "./types";

const MINUTE = 60_000;

/**
 * Scoring هو أداة ترتيب أولوية فقط — ليس نموذج تنبؤ وليس احتمال شراء حقيقي.
 * لا يُعرض للمستخدم كنسبة شراء.
 */
export function eventScore(signalType: SignalType, cfg: RecoveryConfig): number {
  return cfg.scores[signalType];
}

/**
 * ترخيم النقاط مع تقادم النشاط: تتناقص خطيًّا إلى صفر بعد scoreDecayHours.
 * المرجع = آخر نشاط حتى يعود العميل وينعش حالته.
 */
export function applyAgePenalty(score: number, nowMs: number, lastActivityAt: number, decayHours: number): number {
  const ageHours = (nowMs - lastActivityAt) / MINUTE / 60;
  if (ageHours <= 0) return score;
  const factor = Math.max(0, 1 - ageHours / Math.max(1, decayHours));
  return Math.round(score * factor);
}

/**
 * خصم نقاط عن كل رسالة سابقة (كلما أرسلنا أكثر تصاعدت العتبة).
 */
export function applyMessagePenalty(score: number, messageCount: number, perMessage: number): number {
  return Math.round(score - messageCount * perMessage);
}

/**
 * نقاط الحالة بعد كل القيود — تُستخدم للترتيب فقط، لا تصل أبدًا للعميل.
 */
export function effectiveScore(c: Pick<RecoveryCase, "score" | "messageCount" | "lastActivityAt">, nowMs: number, cfg: RecoveryConfig): number {
  const aged = applyAgePenalty(c.score, nowMs, c.lastActivityAt, cfg.scoreDecayHours);
  return applyMessagePenalty(aged, c.messageCount, cfg.messagePenalty);
}
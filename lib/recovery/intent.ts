/**
 * نموذج النية (Phase 2) — درجة 0..100 ومستوى لنية الشراء من أدلة قابلة للقياس.
 *
 * وضوح أساسي (لا يُكسر):
 *  - ليست احتمال شراء (نسبة حتمية)، وليست ترتيب الأولوية في scoring.
 *  - هي درجة مواتاة مبنية على أدلة مسجّلة فعليًا فقط:
 *       قوة أقوى إشارة (سلة ← إتمام ← بدء دفع) ← caseType
 *    إعادة مشاهدة المنتج المفضّل عبر جلسات، عدد الجلسات، قيمة السلة
 *    وعدد أصنافها، والحداثة الزمنية.
 *  - كل مساهمة مقصوصة بسقف صريح: لا عدّ مزدوج لمنتج في نفس الجلسة،
 *    ولا تضخيم من أحداث خام. من يقيسها لاحقًا يقيس المقادير المميّزة.
 *  - الوحدة نقية: بلا اتصال، بلا قراءة حالة، بلا آثار جانبية. حتمية.
 */

import type { IntentConfig, RecoveryConfig } from "./config";
import type { CaseType } from "./types";

export type IntentLevel = "VERY_LOW" | "LOW" | "MEDIUM" | "HIGH" | "EXTREME";

export const INTENT_LEVELS: IntentLevel[] = ["VERY_LOW", "LOW", "MEDIUM", "HIGH", "EXTREME"];

/**
 * أدلة النية — كل ما يمكن قياسه اليوم عن حالة الاسترجاع دون اختراع بيانات:
 * المقادير هنا مميّزة (distinct) وليست عدد أحداث خام.
 */
export type IntentEvidence = {
  /** قوة أقوى إشارة مسجّلة فعليًا (النوع الحالي للحالة). */
  caseType: CaseType;
  /** عدد المشاهدات المميّزة للمنتج المفضّل عبر جلسات مفتوحة. */
  repeatedViews: number;
  /** عدد الجلسات المميّزة التي شهدت نشاطًا لهذه الحالة. */
  sessions: number;
  /** قيمة السلة من snapshot عند الإتمام/الدفع (قد تكون غير معلومة). */
  cartValue: number | null;
  /** عدد أصناف السلة التقريبي (قد يكون غير معلوم). */
  cartItems: number | null;
  /** ساعات منذ آخر نشاط — لتراخي الحداثة. */
  recencyHours: number;
  /** ساعات منذ أول نشاط — سياق فقط يظهر في التفسير لا في الحساب. */
  ageHours: number;
};

/** مساهمة واحدة في النتيجة — للعرض والتشخيص، لا للتخمين. */
export type IntentContribution = {
  key: string;
  labelAr: string;
  gained: number;
  capReached: boolean;
};

export type IntentResult = {
  /** درجة 0..100 (مقصوصة). */
  score: number;
  level: IntentLevel;
  /** شرح عربي سطر واحد — أين انتهى الحساب ولماذا. */
  reason: string;
  /** مساهمات أُنشئت بفعل الأدلة (لا القيم الصفرية). */
  contributors: IntentContribution[];
  /** أقوى إشارة كانت إتمامًا أو بدء دفع (لا مجرد مشاهدة/سلة). */
  strongSignal: boolean;
};

const STRENGTH: Record<Exclude<CaseType, "PURCHASED">, keyof IntentConfig["strengthBase"]> = {
  ADD_TO_CART: "add_to_cart",
  CHECKOUT_STARTED: "checkout_start",
  PAYMENT_STARTED: "payment_started",
};

function clamp100(n: number): number {
  return Math.round(Math.min(100, Math.max(0, n)));
}

/**
 * المستوى من الدرجة وفق عتبات الإعداد (VERY_LOW..EXTREME).
 * ترتيب صارم: الأقل عتبة يُفحص أولًا فلا يقع تداخل.
 */
export function intentLevelFor(score: number, cfg: RecoveryConfig): IntentLevel {
  const l = cfg.intent.levels;
  const s = Number.isFinite(score) ? score : 0;
  if (s < l.veryLow) return "VERY_LOW";
  if (s < l.low) return "LOW";
  if (s < l.medium) return "MEDIUM";
  if (s < l.high) return "HIGH";
  return "EXTREME";
}

/** عامل الحداثة: نصْف الحياة × تقادم؛ والحد الأدنى منه يحفظ أثر الأدلة لا يلغيه. */
function freshnessFactor(recencyHours: number, cfg: RecoveryConfig): number {
  const halfLife = Math.max(1, cfg.intent.freshnessHalfLifeHours);
  if (!Number.isFinite(recencyHours) || recencyHours <= 0) return 1;
  const f = Math.pow(0.5, recencyHours / halfLife);
  return Math.min(1, Math.max(cfg.intent.minFadeFactor, f));
}

/**
 * حساب نية الحالة.
 *
 * القواعد الحتمية:
 *  1. قاعدة الأقوى = strengthBase لأقوى إشارة مسجّلة (caseType).
 *  2. المشاهدات المتكررة: min(عدد مميّز, سقف/فرق) × فرق المرئية.
 *  3. الجلسات: min(جلسات−1, سقف) × فرق الجلسات (الجلسة الأولى في القاعدة).
 *  4. السلة: أول شريحة قيمة يصلها cartValue (مرة واحدة فقط).
 *  5. الأصناف: min(عدد متاح, سقف) × فرق الصنف.
 *  6. الحداثة: ضرب عامل النصف×التقادم، ولا يهبط الأثر دون minFadeFactor.
 *  7. الحالة المغلقة بالشراء: نية محسومة لا تُقاس (0).
 */
export function computeIntent(evidence: IntentEvidence, cfg: RecoveryConfig): IntentResult {
  const c = cfg.intent;

  // الشراء قد أغلق الحالة: لا «نية متابعة» بعد الشراء — صفر محسوم.
  if (evidence.caseType === "PURCHASED") {
    return {
      score: 0,
      level: "VERY_LOW",
      reason: "الحالة مغلقة بالشراء — لا نية للمتابعة",
      contributors: [],
      strongSignal: false,
    };
  }

  const strengthKey = STRENGTH[evidence.caseType];
  const base = c.strengthBase[strengthKey];

  const contributors: IntentContribution[] = [{ key: `strength:${strengthKey}`, labelAr: `أقوى إشارة (${strengthKey})`, gained: base, capReached: false }];

  const repeated = Math.max(0, Math.min(evidence.repeatedViews, Math.floor(c.repeatedViewCap / Math.max(1, c.repeatedViewDelta))));
  const repeatedGain = repeated * c.repeatedViewDelta;
  if (repeatedGain > 0) {
    contributors.push({
      key: "repeated_views",
      labelAr: `مشاهدات متكررة (${evidence.repeatedViews})`,
      gained: repeatedGain,
      capReached: evidence.repeatedViews > repeated,
    });
  }

  const sessionsExtra = Math.max(0, Math.min(evidence.sessions - 1, Math.floor(c.sessionCap / Math.max(1, c.sessionDelta))));
  const sessionGain = sessionsExtra * c.sessionDelta;
  if (sessionGain > 0) {
    contributors.push({
      key: "sessions",
      labelAr: `جلسات مميّزة (${evidence.sessions})`,
      gained: sessionGain,
      capReached: evidence.sessions - 1 > sessionsExtra,
    });
  }

  const tierGain = tierGainFor(evidence.cartValue, c.cartTiers);
  if (tierGain > 0) {
    contributors.push({ key: "cart_tier", labelAr: `قيمة السلة (${evidence.cartValue} ر.س)`, gained: tierGain, capReached: false });
  }

  const itemsExtra = Number.isFinite(evidence.cartItems as number)
    ? Math.max(0, Math.min(evidence.cartItems as number, Math.floor(c.cartItemCap / Math.max(1, c.cartItemDelta))))
    : 0;
  const itemsGain = itemsExtra * c.cartItemDelta;
  if (itemsGain > 0) {
    contributors.push({
      key: "cart_items",
      labelAr: `أصناف السلة (${evidence.cartItems})`,
      gained: itemsGain,
      capReached: (evidence.cartItems as number) > itemsExtra,
    });
  }

  const raw = base + repeatedGain + sessionGain + tierGain + itemsGain;
  const score = clamp100(raw * freshnessFactor(evidence.recencyHours, cfg));

  const strongSignal = evidence.caseType === "CHECKOUT_STARTED" || evidence.caseType === "PAYMENT_STARTED";
  return {
    score,
    level: intentLevelFor(score, cfg),
    reason: buildReason(evidence, contributors, score, strongSignal),
    contributors,
    strongSignal,
  };
}

/** أول شريحة قيمة يصلها cartValue (مفروزة تنازليًا، تُؤخذ مرة واحدة). */
function tierGainFor(cartValue: number | null, tiers: { value: number; gain: number }[]): number {
  if (!Number.isFinite(cartValue as number) || cartValue === null || cartValue <= 0) return 0;
  const sorted = [...tiers].sort((a, b) => b.value - a.value);
  const tier = sorted.find((t) => (cartValue as number) >= t.value);
  return tier ? tier.gain : 0;
}

/** تفسير عربي سطر واحد من المساهمات الفعلية. */
function buildReason(e: IntentEvidence, contributors: IntentContribution[], score: number, strongSignal: boolean): string {
  const parts: string[] = [];
  if (strongSignal) parts.push("إشارة قوية (إتمام/دفع)");
  else parts.push(`أقوى إشارة: ${e.caseType === "ADD_TO_CART" ? "إضافة إلى السلة" : e.caseType}`);
  const rest = contributors
    .filter((c) => c.key !== "strength:add_to_cart" && c.key !== "strength:checkout_start" && c.key !== "strength:payment_started")
    .map((c) => c.labelAr);
  for (const p of rest) if (parts.length < 4) parts.push(p);
  if (Number.isFinite(e.ageHours) && e.ageHours > 0) parts.push(`الحالة عمرها ${Math.round(e.ageHours)} ساعة`);
  return `${parts.join(" · ")} ⇒ ${score}/100`;
}
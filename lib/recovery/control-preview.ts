/**
 * معاينة مركز التحكم — «ما الذي سيحدث قبل الحفظ» (المرحلة 2).
 *
 * وحدة نقية: تُدخل الإعدادات/المراحل كما ستُحفظ (draft) وتُخرج صورة
 * قابلة للعرض عن أثرها الفعلي على التقييم والجدولة — بلا أي اتصال.
 *
 * مصدر الواحد للحقيقة: نفس دوال الدمج في config.ts. ما نجده هنا هو ما
 * سيراه المحرك فعلًا بعد التطبيق، فلا يخالف المعاينةُ الواقعَ.
 */

import {
  applyRecoverySettings,
  resolveRecoveryDryRun,
  loadRecoveryConfig,
} from "./config";
import type { RecoveryConfig, RecoverySettings } from "./config";
import { SETTING_FIELDS, SCORE_KEYS, simulateStageTimeline } from "./control-schema";
import type { StageTimeline, RecoveryStageWrite } from "./control-schema";
import { stageFromRow, stagesFromReminders } from "./stages";
import type { RecoveryStage } from "./stages";

/** الحقول الرقمية/المنطقية القابلة للعرض (بلا scores — تُعرض منفصلة). */
const DISPLAYABLE = SETTING_FIELDS.filter((f) => f.kind !== "score");

export type SettingChange = {
  key: string;
  labelAr: string;
  /** القيمة الفعّالة قبل. */
  before: string;
  /** القيمة الفعّالة بعد. */
  after: string;
};

export type EffectiveNumbers = Pick<
  RecoveryConfig,
  | "maxMessages"
  | "globalCooldownHours"
  | "messagePenalty"
  | "discountEligibleAfterHours"
  | "discountRequiresPriorReminder"
  | "minCartValueForDiscount"
  | "discountCooldownHours"
  | "maxDiscountsPerCase"
  | "maxRecoveryDiscountPercent"
  | "maxRecoveryDiscountAmount"
  | "proposedRecoveryDiscountPercent"
  | "expiryHours"
  | "scoreDecayHours"
> & { scores: RecoveryConfig["scores"] };

export type PlanPreview = {
  ok: boolean;
  errors: string[];
  /** القيم الفعّالة بعد تطبيق المسودة. */
  effective: EffectiveNumbers;
  /** تغييرات الأثر الفعلي مقارنة بما هو معمول به الآن. */
  changes: SettingChange[];
  dryRun: { before: boolean; after: boolean };
  timeline: StageTimeline;
};

function fmtBoolean(v: boolean): string {
  return v ? "نعم" : "لا";
}

function fmtNumber(v: number): string {
  return Number.isFinite(v) ? String(v) : "—";
}

function pickEffective(cfg: RecoveryConfig): EffectiveNumbers {
  return {
    maxMessages: cfg.maxMessages,
    globalCooldownHours: cfg.globalCooldownHours,
    messagePenalty: cfg.messagePenalty,
    discountEligibleAfterHours: cfg.discountEligibleAfterHours,
    discountRequiresPriorReminder: cfg.discountRequiresPriorReminder,
    minCartValueForDiscount: cfg.minCartValueForDiscount,
    discountCooldownHours: cfg.discountCooldownHours,
    maxDiscountsPerCase: cfg.maxDiscountsPerCase,
    maxRecoveryDiscountPercent: cfg.maxRecoveryDiscountPercent,
    maxRecoveryDiscountAmount: cfg.maxRecoveryDiscountAmount,
    proposedRecoveryDiscountPercent: cfg.proposedRecoveryDiscountPercent,
    expiryHours: cfg.expiryHours,
    scoreDecayHours: cfg.scoreDecayHours,
    scores: { ...cfg.scores },
  };
}

/**
 * الفروق بين إعدادين فعّالين (قبل/بعد) بالعربية.
 */
export function diffEffectiveSettings(before: RecoveryConfig, after: RecoveryConfig): SettingChange[] {
  const changes: SettingChange[] = [];
  for (const f of DISPLAYABLE) {
    const b = fieldDisplay(before, f.key);
    const a = fieldDisplay(after, f.key);
    if (b !== a) changes.push({ key: f.key, labelAr: f.labelAr, before: b, after: a });
  }
  for (const k of SCORE_KEYS) {
    const b = before.scores[k];
    const a = after.scores[k];
    if (b !== a) {
      changes.push({ key: `scores.${k}`, labelAr: labelForScore(k), before: String(b), after: String(a) });
    }
  }
  return changes;
}

function labelForScore(k: string): string {
  return SETTING_FIELDS.find((f) => f.key === `scores.${k}`)?.labelAr ?? k;
}

function fieldDisplay(cfg: RecoveryConfig, key: string): string {
  const f = SETTING_FIELDS.find((x) => x.key === key);
  const value = (cfg as unknown as Record<string, unknown>)[key];
  if (f?.kind === "boolean") return fmtBoolean(value === true);
  if (value === undefined || value === null) return "—";
  return fmtNumber(Number(value));
}

/**
 * معاينة إعدادات: مسودة إعدادات فوق خط الأساس، مع أثرها وسجل التغييرات.
 *
 * @param input.draft الإعدادات المراد حفظها (فراغ = لا تغيير).
 * @param input.saved الإعدادات المحفوظة حاليًا في القاعدة.
 * @param input.enabled مفتاح التشغيل الحالي.
 * @param input.stages المرحلة الحالية للخطة (للخط الزمني مع maxMessages).
 * @param input.parseErrors أخطاء فحص المسودة (إن كان الفحص سابقًا).
 */
export function buildRecoveryPlanPreview(input: {
  draft?: RecoverySettings | null;
  saved?: RecoverySettings | null;
  enabled: boolean;
  stages?: RecoveryStage[] | null;
  parseErrors?: string[] | null;
}): PlanPreview {
  const { draft = null, saved = null, enabled, stages = null, parseErrors = [] } = input;

  if (parseErrors && parseErrors.length) {
    return {
      ok: false,
      errors: parseErrors,
      effective: emptyEffective(),
      changes: [],
      dryRun: { before: false, after: false },
      timeline: { steps: [], warnings: [], usedFallback: false },
    };
  }

  const base = loadRecoveryConfig();
  const plan = stages && stages.length ? stages : base.stages;
  const after = applyRecoverySettings(base, draft ?? {}, plan);
  const before = applyRecoverySettings(base, saved ?? {}, plan);

  const changes = diffEffectiveSettings(before, after);
  const timeline = simulateStageTimeline(after.stages, after.maxMessages);

  return {
    ok: true,
    errors: [],
    effective: pickEffective(after),
    changes,
    dryRun: {
      before: resolveRecoveryDryRun(base, enabled, saved ?? {}),
      after: resolveRecoveryDryRun(base, enabled, draft ?? {}),
    },
    timeline,
  };
}

function emptyEffective(): EffectiveNumbers {
  const base = loadRecoveryConfig();
  return pickEffective(base);
}

export type StageDraft = RecoveryStageWrite;

/**
 * معاينة المراحل: خط زمني مصدره مراحل افتراضية (قد تحوي تعديلات لم تُحفظ).
 */
export function buildStagePlanPreview(input: {
  /** صفوف بصيغة كتابة المراحل (قد تكون مسودة بلا id بعد). */
  stages: StageDraft[];
  maxMessages: number | null | undefined;
}): { ok: boolean; timeline: StageTimeline; maxMessages: number; errors: string[] } {
  const { stages, maxMessages } = input;
  const errors: string[] = [];

  // تحويل المسودة إلى صورة المرحلة الصالحة؛ أي صف غير مكتمل = تحذير بدل تعطيل.
  const parsed: RecoveryStage[] = [];
  for (const s of stages) {
    const row = stageFromRow({
      key: s.key,
      name_ar: s.nameAr,
      position: s.position,
      delay_minutes: s.delayMinutes,
      template_id: s.templateId,
      is_active: s.isActive,
      is_terminal: s.isTerminal,
      max_total_messages: s.maxTotalMessages,
    });
    if (row) parsed.push(row);
    else errors.push(`المرحلة «${s.nameAr || s.key || "(بلا اسم)"}» غير مكتملة — لن تظهر في المعاينة.`);
  }

  const fallbackMax = Number.isFinite(maxMessages) ? Math.max(1, Math.trunc(maxMessages as number)) : 3;
  let timeline = parsed.length
    ? simulateStageTimeline(parsed, maxMessages)
    : simulateStageTimeline(stagesFromReminders([30, 360, 1440]), fallbackMax);
  if (!parsed.length) {
    timeline = {
      ...timeline,
      usedFallback: true,
      warnings: ["لا مراحل مُعرَّفة بعد — ستُستخدم الخطة الافتراضية الحالية (30 دقيقة / 6 ساعات / 24 ساعة).", ...timeline.warnings],
    };
  }

  return {
    ok: parsed.length > 0,
    timeline,
    maxMessages: fallbackMax,
    errors,
  };
}
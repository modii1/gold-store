/**
 * الإعدادات الافتراضية لنظام استرجاع العملاء — كلها قابلة للتهيئة.
 * المرحلة الأولى إلزاميًا DRY_RUN: لا رسائل، لا كوبونات، لا كتابة إنتاج.
 *
 * ترتيب المصادر (مهم):
 *   1) قيم بيئة النشر (RECOVERY_*) = خط الأساس، والبديل الآمن دائمًا.
 *   2) قيم قاعدة البيانات (recovery_settings) = تجاوز لكل حقل على حدة.
 *   3) إن لم يوجد أي مصدر = هذه القيم الافتراضية.
 * أي حقل غير موجود/فارغ في القاعدة لا يسقط قيمة البيئة — يُترك كما هو.
 */

import type { RecoveryStage } from "./stages";
import { stagesFromReminders } from "./stages";

const bool = (v: string | undefined, fallback: boolean) => (v === undefined ? fallback : v === "1" || v.toLowerCase() === "true");


export type RecoveryConfig = {
  /** مفتاح التبديل الكلي للاستهلاك (لا يُفعَّل إلا عند الجاهزية). */
  enabled: boolean;
  /** DRY_RUN=true في المرحلة الأولى — ممنوع أي إرسال/إنشاء حقيقي. */
  dryRun: boolean;
  /** أوزان إشارات السلوك لأغراض ترتيب الأولوية فقط (وليست احتمال شراء). */
  scores: {
    product_view: number;
    repeated_product_view: number;
    add_to_cart: number;
    checkout_start: number;
    payment_started: number;
    purchase: number;
  };
  /** تناقص النقاط مع تقادم النشاط (ساعات حتى صفر). */
  scoreDecayHours: number;
  /** خصم نقاط لكل رسالة مرسلة سابقًا. */
  messagePenalty: number;
  /** جدول التذكيرات (بالدقائق بعد أول نشاط): 30د ثم 6س ثم 24س ثم توقف. */
  remindersMinutes: number[];
  /** الحد الأقصى للرسائل في الحالة الواحدة. */
  maxMessages: number;
  /** مهلة عمومية بين أي رسالتين لنفس العميل. */
  globalCooldownHours: number;
  /** انتهاء الحالة (لا تُجدول لاحقًا) بعد هذه الساعات من أول نشاط. */
  expiryHours: number;
  /** بعد كم ساعة يصبح الخصم ممكنًا (آخر مرحلة وليست أول خطوة). */
  discountEligibleAfterHours: number;
  /** الخصم يُعرض فقط بعد تذكير سابق. */
  discountRequiresPriorReminder: boolean;
  /** أهليّة الخصم تستلزم قيمة سلة صغرى. */
  minCartValueForDiscount: number;
  /** مهلة بين خصمي Recovery لنفس العميل. */
  discountCooldownHours: number;
  /** حد أقصى لعدد خصومات Recovery للعميل. */
  maxDiscountsPerCase: number;
  /** الحد الأعلى لنسبة الخصم — يحظره قرار الخصم ولا يتجاوزه أبدًا. */
  maxRecoveryDiscountPercent: number;
  /** الحد الأعلى لقيمة الخصم (ريب: cap بالريال). */
  maxRecoveryDiscountAmount: number;
  /** النسبة المقترحة (ضمن MAX). */
  proposedRecoveryDiscountPercent: number;
  /**
   * خطة المراحل المقروءة من recovery_stages (migration-038).
   *
   * في هذه المرحلة تُقرأ وتُعرض فقط، ولا يقرأها جدول التذكيرات بعد:
   * `loadRecoveryConfig` يملؤها بنفس القيم المشتقّة من remindersMinutes،
   * فسلوك المحرك لم يتغيّر. ربط المراحل بالقرار يأتي في مرحلة لاحقة.
   */
  stages: RecoveryStage[];
  /**
   * نموذج النية (Phase 2): درجة 0..100 ومستواها، ودلالة أنها ترتيب
   * إشارات لا احتمال شراء. كل مساهمة مقصوصة بسقف صريح (لا عدّ مزدوج).
   */
  intent: IntentConfig;
  /** نموذج الثقة (Phase 3): مقدار اكتمال البيانات التي تدعم القرار. */
  confidence: ConfidenceConfig;
};

/**
 * إعدادات نموذج النية — أوزان وحدود خالصة، لا تقترب أبدًا من العميل.
 *
 * كل مسار من مسارات المساهمة:
 *  - strengthBase: أقصى إشارة مسجّلة (سلة، إتمام، دفع).
 *  - مشاهدات متكررة: ×repeatedViewDelta وبسقف repeatedViewCap فرصة كاملة.
 *  - جلسات مميّزة: ×sessionDelta وبسقف sessionCap.
 *  - سلة/أصناف: شرائح قيمة cartTiers + نقاط لكل صنف بسقف cartItemCap.
 *  - حداثة: نصْف الحياة freshnessHalfLifeHours، ولا يهبط الأثر دون minFadeFactor.
 *  - levels: عتبات المستويات الخمسة (VERY_LOW..EXTREME).
 */
export type IntentConfig = {
  strengthBase: {
    add_to_cart: number;
    checkout_start: number;
    payment_started: number;
    purchase: number;
  };
  repeatedViewDelta: number;
  repeatedViewCap: number;
  sessionDelta: number;
  sessionCap: number;
  cartTiers: { value: number; gain: number }[];
  cartItemDelta: number;
  cartItemCap: number;
  freshnessHalfLifeHours: number;
  minFadeFactor: number;
  levels: { veryLow: number; low: number; medium: number; high: number };
};

/**
 * إعدادات نموذج الثقة — وزن كل دليل في اكتمال البيانات التي تدعم القرار.
 *
 * الثقة تُضعف القرار لا تعلّمه: البيانات الناقصة تخفض الثقة حتى مع نية عالية،
 * وليست شرطًا يوقف الحساب إلا عند التقادم الشديد (maxScoreForExtremeStale).
 */
export type ConfidenceConfig = {
  identifiedWeight: number;
  signalWeight: number;
  signalCap: number;
  hasProductWeight: number;
  cartValueWeight: number;
  sessionWeight: number;
  sessionCap: number;
  stalenessHours: number;
  stalenessPenalty: number;
  extremeStaleHours: number;
  maxScoreForExtremeStale: number;
  levelLow: number;
  levelHigh: number;
};

/** شرائح قيمة السلة الافتراضية لأثر النية (لا تأتي من بيئة؛ ضبط داخلي). */
const DEFAULT_INTENT_CART_TIERS = [
  { value: 1500, gain: 15 },
  { value: 500, gain: 10 },
  { value: 150, gain: 5 },
];

export function loadRecoveryConfig(env: NodeJS.ProcessEnv = process.env): RecoveryConfig {
  const remindersMinutes = [
    num(env.RECOVERY_REMINDER_1_MIN, 30),
    num(env.RECOVERY_REMINDER_2_MIN, 360),
    num(env.RECOVERY_REMINDER_3_MIN, 1440),
  ];
  return {
    enabled: bool(env.RECOVERY_ENABLED, false),
    dryRun: bool(env.RECOVERY_DRY_RUN, true),
    scores: {
      product_view: num(env.RECOVERY_SCORE_PRODUCT_VIEW, 10),
      repeated_product_view: num(env.RECOVERY_SCORE_REPEATED_VIEW, 15),
      add_to_cart: num(env.RECOVERY_SCORE_ADD_TO_CART, 25),
      checkout_start: num(env.RECOVERY_SCORE_CHECKOUT_START, 40),
      payment_started: num(env.RECOVERY_SCORE_PAYMENT_STARTED, 50),
      purchase: num(env.RECOVERY_SCORE_PURCHASE, -100),
    },
    scoreDecayHours: num(env.RECOVERY_SCORE_DECAY_HOURS, 168),
    messagePenalty: num(env.RECOVERY_MESSAGE_PENALTY, 10),
    remindersMinutes,
    maxMessages: num(env.RECOVERY_MAX_MESSAGES, 3),
    globalCooldownHours: num(env.RECOVERY_GLOBAL_COOLDOWN_HOURS, 24),
    expiryHours: num(env.RECOVERY_EXPIRY_HOURS, 96),
    discountEligibleAfterHours: num(env.RECOVERY_DISCOUNT_AFTER_HOURS, 24),
    discountRequiresPriorReminder: bool(env.RECOVERY_DISCOUNT_REQUIRE_REMINDER, true),
    minCartValueForDiscount: num(env.RECOVERY_MIN_CART_VALUE, 100),
    discountCooldownHours: num(env.RECOVERY_DISCOUNT_COOLDOWN_HOURS, 168),
    maxDiscountsPerCase: num(env.RECOVERY_MAX_DISCOUNTS_PER_CASE, 1),
    maxRecoveryDiscountPercent: num(env.RECOVERY_MAX_DISCOUNT_PERCENT, 10),
    maxRecoveryDiscountAmount: num(env.RECOVERY_MAX_DISCOUNT_AMOUNT, 50),
    proposedRecoveryDiscountPercent: num(env.RECOVERY_PROPOSED_DISCOUNT_PERCENT, 10),
    stages: stagesFromReminders(remindersMinutes),
    intent: {
      strengthBase: {
        add_to_cart: num(env.RECOVERY_INTENT_STRENGTH_ATC, 20),
        checkout_start: num(env.RECOVERY_INTENT_STRENGTH_CHECKOUT, 45),
        payment_started: num(env.RECOVERY_INTENT_STRENGTH_PAYMENT, 65),
        purchase: num(env.RECOVERY_INTENT_STRENGTH_PURCHASE, 0),
      },
      repeatedViewDelta: num(env.RECOVERY_INTENT_REPEATED_VIEW_DELTA, 6),
      repeatedViewCap: num(env.RECOVERY_INTENT_REPEATED_VIEW_CAP, 24),
      sessionDelta: num(env.RECOVERY_INTENT_SESSION_DELTA, 6),
      sessionCap: num(env.RECOVERY_INTENT_SESSION_CAP, 12),
      cartTiers: tiersDefault(),
      cartItemDelta: num(env.RECOVERY_INTENT_CART_ITEM_DELTA, 4),
      cartItemCap: num(env.RECOVERY_INTENT_CART_ITEM_CAP, 8),
      freshnessHalfLifeHours: num(env.RECOVERY_INTENT_FRESHNESS_HALF_LIFE_HOURS, 12),
      minFadeFactor: 0.2,
      levels: {
        veryLow: num(env.RECOVERY_INTENT_LEVEL_VERY_LOW, 30),
        low: num(env.RECOVERY_INTENT_LEVEL_LOW, 50),
        medium: num(env.RECOVERY_INTENT_LEVEL_MEDIUM, 70),
        high: num(env.RECOVERY_INTENT_LEVEL_HIGH, 85),
      },
    },
    confidence: {
      identifiedWeight: num(env.RECOVERY_CONF_IDENTIFIED_WEIGHT, 35),
      signalWeight: num(env.RECOVERY_CONF_SIGNAL_WEIGHT, 12),
      signalCap: num(env.RECOVERY_CONF_SIGNAL_CAP, 40),
      hasProductWeight: num(env.RECOVERY_CONF_PRODUCT_WEIGHT, 10),
      cartValueWeight: num(env.RECOVERY_CONF_CART_VALUE_WEIGHT, 8),
      sessionWeight: num(env.RECOVERY_CONF_SESSION_WEIGHT, 6),
      sessionCap: num(env.RECOVERY_CONF_SESSION_CAP, 12),
      stalenessHours: num(env.RECOVERY_CONF_STALENESS_HOURS, 48),
      stalenessPenalty: num(env.RECOVERY_CONF_STALENESS_PENALTY, 15),
      extremeStaleHours: num(env.RECOVERY_CONF_EXTREME_STALE_HOURS, 120),
      maxScoreForExtremeStale: num(env.RECOVERY_CONF_MAX_SCORE_STALE, 39),
      levelLow: num(env.RECOVERY_CONF_LEVEL_LOW, 40),
      levelHigh: num(env.RECOVERY_CONF_LEVEL_HIGH, 70),
    },
  };
}

/** شرائح القيمة الافتراضية — نسخة مستقلة في كل استدعاء (لا تشير إلى نفس المصفوفة). */
function tiersDefault(): { value: number; gain: number }[] {
  return DEFAULT_INTENT_CART_TIERS.map((t) => ({ ...t }));
}

function num(v: string | undefined, fallback: number): number {
  const n = v === undefined ? Number.NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const DEFAULT_RECOVERY_CONFIG = loadRecoveryConfig({} as NodeJS.ProcessEnv);

/**
 * قفل الكتابة — السلوك الفعلي كما هو اليوم:
 *
 * - enabled=false (المفتاح من settings.recovery_enabled): يتوقف كل شيء —
 *   لا استيعاب ولا تقييم ولا معالجة ولا كتابة. fail-closed.
 * - enabled=true: يسمح بتسجيل الحالات وتحديثها (canPersistCases أدناه)،
 *   وللمسارات الكتابية مثل completePurchaseByCustomer أن تكتب،
 *   لأن dryRun صار يُحسم في resolveRecoveryDryRun أدناه لا هنا.
 *
 * توضيح مهم بين مفتاحين كانا يختلطان:
 *  - enabled = مفتاح التشغيل (من لوحة الإدارة، قاعدة البيانات).
 *  - dryRun  = وضع المعاينة (يمنع الإرسال دون إيقاف التتبّع).
 * لم يعودا متساويين، وكل مسار يستدعي resolveRecoveryDryRun بدل ترك
 * قيمة البيئة تتسرّب إلى العرض.
 *
 * مسار الإرسال القائم في هذا النظام هو dispatcher.ts وهو قائم
 * (جدولة عبر notifications ثم qr-server). لا يوجد مسار كوبون إطلاقًا،
 * ولا يُنشأ أي خصم: كل قيم الخصم اقتراح داخلي فقط.
 */

export function canPersistCases(cfg: RecoveryConfig): boolean {
  return cfg.enabled;
}

// ============================================================
// الإعدادات من قاعدة البيانات (recovery_settings) — المراحل 1
// ============================================================

/**
 * تجاوزات اختيارية تُخزَّن في recovery_settings.config (jsonb).
 *
 * كل حقل `number | null | undefined`:
 *   null/undefined = «لم يُضبط» ⇒ تُبقى قيمة البيئة (fallback آمن).
 * كل حقل `boolean | null | undefined` بالمعنى نفسه.
 *
 * لا يوجد أي حقل هنا يكتب في orders/customers/products/coupons/notifications.
 */
export type RecoverySettings = {
  /** وضع المعاينة: true = لا إرسال إطلاقًا مهما بلغ التقييم. */
  dryRun?: boolean | null;
  maxMessages?: number | null;
  globalCooldownHours?: number | null;
  expiryHours?: number | null;
  scoreDecayHours?: number | null;
  messagePenalty?: number | null;
  discountEligibleAfterHours?: number | null;
  discountRequiresPriorReminder?: boolean | null;
  minCartValueForDiscount?: number | null;
  discountCooldownHours?: number | null;
  maxDiscountsPerCase?: number | null;
  maxRecoveryDiscountPercent?: number | null;
  maxRecoveryDiscountAmount?: number | null;
  proposedRecoveryDiscountPercent?: number | null;
  scores?: Partial<RecoveryConfig["scores"]> | null;
  /** تجاوزات نموذج النية (كل حقل غير مُضبَط = يُبقى خط الأساس). */
  intent?: Partial<IntentConfig> | null;
  /** تجاوزات نموذج الثقة (كل حقل غير مُضبَط = يُبقى خط الأساس). */
  confidence?: Partial<ConfidenceConfig> | null;
};

/** الأرقام المقبولة: 0 فأكثر. أي قيمة سالبة/غير منتهية تُرفض ⇒ يبقى خط الأساس. */
function overrideNumber(value: unknown, baseline: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(n) || n < 0) return baseline;
  return n;
}

function overrideBool(value: unknown, baseline: boolean): boolean {
  return typeof value === "boolean" ? value : baseline;
}

/** دمج خريطة أرقام (strengthBase/levels/scores…) فوق خط أساس — القيم غير الصالحة تُسقَط. */
function mergeNumberRecord<T extends string>(
  base: Record<T, number>,
  partial: Record<string, unknown> | null | undefined,
): Record<T, number> {
  const out: Record<T, number> = { ...base };
  if (!partial || typeof partial !== "object" || Array.isArray(partial)) return out;
  for (const [key, value] of Object.entries(partial)) {
    const k = key as T;
    if (!(k in out)) continue;
    out[k] = overrideNumber(value, out[k]);
  }
  return out;
}

/**
 * دمج تجاوزات نموذج النية. cartTiers لا تُتجاوز من القاعدة (شكله مصفوفة
 * وعرضها غير مدعوم) — تبقى من خط الأساس حصريًا.
 */
function mergeIntent(base: IntentConfig, intent: Partial<IntentConfig> | null | undefined): IntentConfig {
  if (!intent || typeof intent !== "object") return base;
  return {
    ...base,
    strengthBase: mergeNumberRecord(base.strengthBase, (intent as Record<string, unknown>).strengthBase as Record<string, unknown> | null),
    repeatedViewDelta: overrideNumber(intent.repeatedViewDelta, base.repeatedViewDelta),
    repeatedViewCap: overrideNumber(intent.repeatedViewCap, base.repeatedViewCap),
    sessionDelta: overrideNumber(intent.sessionDelta, base.sessionDelta),
    sessionCap: overrideNumber(intent.sessionCap, base.sessionCap),
    cartItemDelta: overrideNumber(intent.cartItemDelta, base.cartItemDelta),
    cartItemCap: overrideNumber(intent.cartItemCap, base.cartItemCap),
    freshnessHalfLifeHours: overrideNumber(intent.freshnessHalfLifeHours, base.freshnessHalfLifeHours),
    levels: mergeNumberRecord(base.levels, (intent as Record<string, unknown>).levels as Record<string, unknown> | null),
  };
}

/** دمج تجاوزات نموذج الثقة. */
function mergeConfidence(base: ConfidenceConfig, confidence: Partial<ConfidenceConfig> | null | undefined): ConfidenceConfig {
  if (!confidence || typeof confidence !== "object") return base;
  return {
    ...base,
    identifiedWeight: overrideNumber(confidence.identifiedWeight, base.identifiedWeight),
    signalWeight: overrideNumber(confidence.signalWeight, base.signalWeight),
    signalCap: overrideNumber(confidence.signalCap, base.signalCap),
    hasProductWeight: overrideNumber(confidence.hasProductWeight, base.hasProductWeight),
    cartValueWeight: overrideNumber(confidence.cartValueWeight, base.cartValueWeight),
    sessionWeight: overrideNumber(confidence.sessionWeight, base.sessionWeight),
    sessionCap: overrideNumber(confidence.sessionCap, base.sessionCap),
    stalenessHours: overrideNumber(confidence.stalenessHours, base.stalenessHours),
    stalenessPenalty: overrideNumber(confidence.stalenessPenalty, base.stalenessPenalty),
    extremeStaleHours: overrideNumber(confidence.extremeStaleHours, base.extremeStaleHours),
    maxScoreForExtremeStale: overrideNumber(confidence.maxScoreForExtremeStale, base.maxScoreForExtremeStale),
    levelLow: overrideNumber(confidence.levelLow, base.levelLow),
    levelHigh: overrideNumber(confidence.levelHigh, base.levelHigh),
  };
}

/**
 * قاعدة واحدة لتوحيد dryRun بين مسارات النظام (الإصلاح الجوهري):
 *
 *   - النظام متوقف (enabled=false) ⇒ لا إرسال إطلاقًا ⇒ dryRun = true.
 *   - النظام مفعّل + لا يوجد ضبط في القاعدة ⇒ نفّذ الموجود فعليًا
 *     (dryRun=false). هذا هو السلوك الحالي في مسار الـcron بالضبط،
 *     ويصلح الخلل الذي كانت لوحة الإدارة تعرض بسببه «DRY_RUN»
 *     بينما المسار الفعلي قادر على الإرسال.
 *   - النظام مفعّل + ضبط صريح في القاعدة ⇒ يُحترم الضبط (معاينة أو تشغيل).
 *
 * dryRun ليس مفتاح تشغيل: التشغيل يبقى محكومًا بـ settings.recovery_enabled.
 */
export function resolveRecoveryDryRun(base: RecoveryConfig, enabled: boolean, settings: RecoverySettings = {}): boolean {
  if (!enabled) return true;
  return overrideBool(settings.dryRun, false);
}

/**
 * دمج إعدادات القاعدة فوق خط أساس البيئة.
 *
 * قواعد ثابتة:
 *  - الحقل غير المضبوط (null/undefined/غير صالح) ⇒ خط الأساس كما هو.
 *  - dryRun لا يُنسخ هنا: يُحسم بـresolveRecoveryDryRun وحدها.
 *  - enabled لا يأتي من القاعدة إطلاقًا (مصدره settings.recovery_enabled).
 *  - dryRun لا يُقرأ من القاعدة هنا (لأن enabled يُضبط بعده).
 *  - المراحل تأتي كما هي من القاعدة، أو مشتقّة من remindersMinutes.
 */
export function applyRecoverySettings(
  base: RecoveryConfig,
  settings: RecoverySettings = {},
  stages?: RecoveryStage[] | null,
): RecoveryConfig {
  const scores = { ...base.scores };
  const rawScores = settings.scores ?? null;
  if (rawScores && typeof rawScores === "object") {
    for (const key of Object.keys(scores) as (keyof RecoveryConfig["scores"])[]) {
      scores[key] = overrideNumber((rawScores as Record<string, unknown>)[key], scores[key]);
    }
  }

  const plan = stages && stages.length ? stages : base.stages;

  return {
    ...base,
    scores,
    maxMessages: overrideNumber(settings.maxMessages, base.maxMessages),
    globalCooldownHours: overrideNumber(settings.globalCooldownHours, base.globalCooldownHours),
    expiryHours: overrideNumber(settings.expiryHours, base.expiryHours),
    scoreDecayHours: overrideNumber(settings.scoreDecayHours, base.scoreDecayHours),
    messagePenalty: overrideNumber(settings.messagePenalty, base.messagePenalty),
    discountEligibleAfterHours: overrideNumber(settings.discountEligibleAfterHours, base.discountEligibleAfterHours),
    discountRequiresPriorReminder: overrideBool(settings.discountRequiresPriorReminder, base.discountRequiresPriorReminder),
    minCartValueForDiscount: overrideNumber(settings.minCartValueForDiscount, base.minCartValueForDiscount),
    discountCooldownHours: overrideNumber(settings.discountCooldownHours, base.discountCooldownHours),
    maxDiscountsPerCase: overrideNumber(settings.maxDiscountsPerCase, base.maxDiscountsPerCase),
    maxRecoveryDiscountPercent: overrideNumber(settings.maxRecoveryDiscountPercent, base.maxRecoveryDiscountPercent),
    maxRecoveryDiscountAmount: overrideNumber(settings.maxRecoveryDiscountAmount, base.maxRecoveryDiscountAmount),
    proposedRecoveryDiscountPercent: overrideNumber(
      settings.proposedRecoveryDiscountPercent,
      base.proposedRecoveryDiscountPercent,
    ),
    stages: plan,
    intent: mergeIntent(base.intent, settings.intent),
    confidence: mergeConfidence(base.confidence, settings.confidence),
  };
}

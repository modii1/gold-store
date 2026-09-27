/**
 * الإعدادات الافتراضية لنظام استرجاع العملاء — كلها قابلة للتهيئة.
 * المرحلة الأولى إلزاميًا DRY_RUN: لا رسائل، لا كوبونات، لا كتابة إنتاج.
 */

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
};

export function loadRecoveryConfig(env: NodeJS.ProcessEnv = process.env): RecoveryConfig {
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
    remindersMinutes: [num(env.RECOVERY_REMINDER_1_MIN, 30), num(env.RECOVERY_REMINDER_2_MIN, 360), num(env.RECOVERY_REMINDER_3_MIN, 1440)],
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
  };
}

function num(v: string | undefined, fallback: number): number {
  const n = v === undefined ? Number.NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const DEFAULT_RECOVERY_CONFIG = loadRecoveryConfig({} as NodeJS.ProcessEnv);

/**
 * قفل Stage 1 — السلوك الفعلي كما هو اليوم:
 *
 * - dryRun=true (الافتراضي): وضع المراقبة. القراءة والتقييم يعملان، والكتابة
 *   المسموحة محصورة في تسجيل بيانات القرار عبر maybeIngestRecoverySignal
 *   (canPersistCases أدناه). أما مسارات الإغلاق الكتابية — مثل
 *   completePurchaseByCustomer التي تكتب status='PURCHASED' — فمحجوبة تمامًا
 *   في DRY_RUN: تُرجع 0 ولا تكتب شيئًا. لا رسائل ولا كوبونات.
 * - dryRun=false: هو الوضع الوحيد الذي يسمح بمسارات الكتابة تلك، وبشرط
 *   enabled=true. لم تُطبَّق بعد في Production ولا يوجد في المستودع أي مسار
 *   إرسال أو كوبون، فحتى هنا يبقى الإجراء محسوبًا بلا تنفيذ فعلي.
 *
 * ملاحظة: canPersistCases أدناه ما زالت تشترط dryRun (تخزين بيانات القرار
 * علامة DRY_RUN) بينما محركات الكتابة الفعلية تشترط ¬dryRun — القصد فصل
 * «تسجيل القرار» عن «تنفيذ الإجراء».
 *
 * There is no send/coupon execution layer yet, so no mode can actually
 * message a customer or mint a coupon.
 */
export function canPersistCases(cfg: RecoveryConfig): boolean {
  return cfg.enabled && cfg.dryRun;
}
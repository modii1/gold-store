/**
 * مراحل الاسترجاع — النموذج والمحوّلات (المرحلة 1 من مركز التحكم).
 *
 * الغرض في هذه المرحلة: قراءة المراحل من قاعدة البيانات عند توفّرها،
 * مع fallback آمن ومُثبَت على جدول التذكيرات الحالي (remindersMinutes).
 *
 * ما لا يُفعل هنا (عمدًا):
 *  - لا تعديل في decisions.ts: جدول التذكيرات ما زال يقرأ
 *    cfg.remindersMinutes. ربط المراحل بالمحرك يأتي في مرحلة منفصلة
 *    بعد أن تصبح المراحل قابلة للإدارة من الواجهة.
 *  - لا كتابة: هذه الوحدة قراءة/تحويل فقط.
 *
 * مبدأ الخطة (fallback آمن):
 *   صفوف موجودة في recovery_stages ⇒ هي المراحل.
 *   لا صفوف / خطأ / جدول غير موجود ⇒ مراحل مُشتقّة من remindersMinutes،
 *   أي نفس السلوك الحالي حرفيًا.
 */

/** مرحلة واحدة في مسار الاسترجاع. */
export type RecoveryStage = {
  /** مفتاح مستقر لا يتغيّر بتغيّر الترتيب (يُستخدم في السجل والقوالب). */
  key: string;
  /** اسم عربي للعرض في الواجهة فقط. */
  nameAr: string;
  /** الترتيب: 1 = أول خطوة. مستخدم للفرز، غير فريد عمدًا (إعادة الترتيب لا تكسر شيئًا). */
  position: number;
  /** التأخير بالدقائق منذ أول نشاط (first_detected_at). */
  delayMinutes: number;
  /** القالب المرتبط، null = لا قالب (تُستخدم الرسالة الافتراضية). */
  templateId: number | null;
  isActive: boolean;
  /** نهائية: بلا مرحلة تالية — تُغلق الحالة بعدها بدل المتابعة. */
  isTerminal: boolean;
  /** سقف رسائل اختياري لهذه المرحلة (null = يتبع السقف العام maxMessages). */
  maxTotalMessages: number | null;
};

/** أسماء عربية افتراضية للمراحل المشتقّة من جدول التذكيرات. */
const FALLBACK_NAMES = ["تذكير أول", "تذكير ثانٍ", "تذكير ثالث", "تذكير رابع", "تذكير خامس"];

/**
 * اشتقاق مراحل من جدول التذكيرات الحالي (30د / 6س / 24س).
 * هذا هو fallback المعتمد: بلا صفوف في قاعدة البيانات = نفس السلوك اليوم.
 */
export function stagesFromReminders(reminderMinutes: number[]): RecoveryStage[] {
  const list = Array.isArray(reminderMinutes) ? reminderMinutes : [];
  return list
    .map((minutes) => Number(minutes))
    .filter((minutes) => Number.isFinite(minutes) && minutes >= 0)
    .map((delayMinutes, index) => ({
      key: `reminder_${index + 1}`,
      nameAr: FALLBACK_NAMES[index] ?? `تذكير ${index + 1}`,
      position: index + 1,
      delayMinutes,
      templateId: null,
      isActive: true,
      isTerminal: false,
      maxTotalMessages: null,
    }));
}

/** نص/رقم → رقم صحيح موجب، أو null إن كان غير صالح. */
function positiveInt(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  return i >= 0 ? i : null;
}

const KEY_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/**
 * تحويل صف recovery_stages إلى RecoveryStage.
 * يُرجع null لأي صف غير صالح (مفتاح فارغ أو تأخير سالب) بدل رمي استثناء:
 * صف واحد سيء يجب ألا يوقف قراءة بقية المراحل.
 */
export function stageFromRow(row: Record<string, unknown>): RecoveryStage | null {
  const key = String(row.key ?? "").trim().toLowerCase();
  if (!KEY_RE.test(key)) return null;
  const delayMinutes = positiveInt(row.delay_minutes);
  if (delayMinutes === null) return null;
  // position مطابق لقيد قاعدة البيانات (>= 1). أي قيمة أدنى = صف معطوب يُسقَط.
  const position = positiveInt(row.position);
  if (position === null || position < 1) return null;
  const templateId = row.template_id === null || row.template_id === undefined ? null : Number(row.template_id);
  const maxTotalMessages = row.max_total_messages === null || row.max_total_messages === undefined ? null : positiveInt(row.max_total_messages);
  return {
    key,
    nameAr: String(row.name_ar ?? "").trim() || key,
    position,
    delayMinutes,
    templateId: Number.isFinite(templateId as number) ? (templateId as number) : null,
    isActive: row.is_active === undefined ? true : row.is_active === true,
    isTerminal: row.is_terminal === true,
    maxTotalMessages,
  };
}

/** ترتيب ثابت: بالـposition ثم بالمفتاح (لا يعتمد على ترتيب قاعدة البيانات). */
export function orderStages(stages: RecoveryStage[]): RecoveryStage[] {
  return [...stages].sort((a, b) => (a.position - b.position) || a.key.localeCompare(b.key));
}

/** المراحل الفعّالة فقط، مرتّبة. */
export function activeStages(stages: RecoveryStage[]): RecoveryStage[] {
  return orderStages(stages).filter((s) => s.isActive);
}

/**
 * المرحلة عند فهرس معيّن (0 = قبل أي رسالة).
 * الفهرس يقيس عدد الرسائل المؤكدة، فيحاول engine/dispatcher مطابقته.
 * خارج النطاق ⇒ null (لا اختراع مرحلة).
 */
export function selectStageAt(stages: RecoveryStage[], stepIndex: number): RecoveryStage | null {
  const list = activeStages(stages);
  if (!list.length) return null;
  const index = Number.isFinite(stepIndex) ? Math.trunc(stepIndex) : 0;
  if (index < 0 || index >= list.length) return null;
  return list[index];
}

/**
 * خطة المراحل الفعّالة:
 *   مراحل من قاعدة البيانات ⇒ تُستخدم كما هي.
 *   لا شيء صالح ⇒ اشتقاق من remindersMinutes (fallback آمن).
 */
export function resolveStagePlan(stages: RecoveryStage[] | null | undefined, reminderMinutes: number[]): RecoveryStage[] {
  const valid = orderStages((stages ?? []).filter((s): s is RecoveryStage => !!s && typeof s.key === "string" && s.key.length > 0));
  return valid.length ? valid : stagesFromReminders(reminderMinutes);
}

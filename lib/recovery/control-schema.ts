/**
 * مخطط مركز التحكم — تعريف الحقول والتحقق والمحاكاة (المرحلة 2).
 *
 * وحدة نقية بلا أي اتصال: كل تحويلات وقواعد الفحص في مكان واحد يستخدمه
 * كلٌّ من الواجهة (النماذج) والخادم (عمليات الكتابة) والمعاينة.
 *
 * قواعد fail-safe موحّدة:
 *  - أي إدخال غير صالح يُرفض مع رسالة عربية واضحة؛ لا إرسال أبدًا.
 *  - لا نكتب قيمة «قريبة الصحة»: إما أن يمرّ الإدخال كاملًا وإما نرفضه.
 *  - الحدود هنا أشدّ من قيود قاعدة البيانات (مثلاً مفتاح المرحلة)،
 *    والقاعدة هي الحاجز الأخير إن ماطل أي شيء هذا الفحص.
 */

import { stagesFromReminders, orderStages, activeStages } from "./stages";
import type { RecoveryStage } from "./stages";
import type { RecoverySettings } from "./config";

// ---------------------------------------------------------------
// الحقول القابلة للضبط — مصدر واحد للتعريف عرضًا وتحققًا وتذييلًا
// ---------------------------------------------------------------

export type SettingGroup = "messaging" | "timing" | "discount" | "scores" | "mode";

export type SettingFieldMeta = {
  /** مفتاح الإعداد (أو scores.<name>). */
  key: string;
  /** اسم عربي قصير للتسمية. */
  labelAr: string;
  /** شرح عربي واضح لما يغيّره هذا الإعداد. */
  helpAr: string;
  group: SettingGroup;
  kind: "number" | "boolean" | "score";
  /** أدنى قيمة مقبولة (للأرقام، غير السالبة في معظمها). */
  min?: number;
  /** أقصى قيمة مقبولة — درع أخطاء كتابة، لا حدّ منطقي صارم. */
  max?: number;
  /** وحدة العرض بجانب الحقل. */
  unitAr?: string;
  /** اختراع قيم غير مدعومة يُعرض هكذا. */
  readOnly?: boolean;
};

/** مجموعات الحقول بالعربية — لتنظيم النموذج في أقسام. */
export const SETTING_GROUPS: { key: SettingGroup; labelAr: string; hintAr: string }[] = [
  { key: "mode", labelAr: "وضع التشغيل", hintAr: "المعاينة (لا إرسال) مقابل التشغيل الفعلي." },
  { key: "messaging", labelAr: "الرسائل والمتابعة", hintAr: "سقوف وتوقيتات رسائل الاسترجاع." },
  { key: "timing", labelAr: "التوقيت والانتهاء", hintAr: "تناقص النقاط وانتهاء الحالة." },
  {
    key: "discount",
    labelAr: "الخصم المقترح (داخلي)",
    hintAr: "اقتراح تحليلي للمراجعة الداخلية فقط — لا يُرسل للعميل ولا يُنشأ كود.",
  },
  { key: "scores", labelAr: "أوزان الإشارات", hintAr: "تُستخدم لترتيب الأولوية فقط، وليست احتمال شراء." },
];

export const SETTING_FIELDS: SettingFieldMeta[] = [
  {
    key: "dryRun",
    labelAr: "وضع المعاينة",
    helpAr: "«نعم» = يُحسب كل شيء ويُترتيب ولا يُرسل شيء. «لا» = عند استيفاء الشروط تُجدول رسالة عبر المسار القائم.",
    group: "mode",
    kind: "boolean",
  },
  {
    key: "maxMessages",
    labelAr: "سقف الرسائل للحالة",
    helpAr: "الحد الأقصى لرسائل الاسترجاع في الحالة الواحدة، تفسيرًا لسقف السيرة استخدامًا فعليًا.",
    group: "messaging",
    kind: "number",
    min: 1,
    max: 100,
    unitAr: "رسالة",
  },
  {
    key: "globalCooldownHours",
    labelAr: "المهلة العمومية",
    helpAr: "فترة انتظار بين أي رسالتين للعميل نفسه (أيًّا كان مسار الرسالة). يمنع الإزعاج المتتالي.",
    group: "messaging",
    kind: "number",
    min: 0,
    max: 8760,
    unitAr: "ساعة",
  },
  {
    key: "messagePenalty",
    labelAr: "خصم نقاط لكل رسالة سابقة",
    helpAr: "كم تُخصم من أولوية الحالة بعد كل رسالة مرسلة، لتفضيل العملاء الأقل انزعاجًا.",
    group: "messaging",
    kind: "number",
    min: 0,
    max: 1000,
    unitAr: "نقطة",
  },
  {
    key: "discountRequiresPriorReminder",
    labelAr: "الخصم بعد تذكير سابق فقط",
    helpAr: "«نعم» = لا يُقترح خصم إلا لمن سبق وصله تذكير. «لا» = قد يُقترح من أول خطوة.",
    group: "discount",
    kind: "boolean",
  },
  {
    key: "discountEligibleAfterHours",
    labelAr: "أهليّة الخصم بعد",
    helpAr: "بعد كم ساعة من ترك السلة يصبح اقتراح الخصم ممكنًا (لا في أول خطوة).",
    group: "discount",
    kind: "number",
    min: 0,
    max: 8760,
    unitAr: "ساعة",
  },
  {
    key: "minCartValueForDiscount",
    labelAr: "أدنى قيمة سلة للخصم",
    helpAr: "الخصم يُقترح فقط لسلات تصل لـهذه القيمة أو أكثر.",
    group: "discount",
    kind: "number",
    min: 0,
    max: 1000000,
    unitAr: "ر.س",
  },
  {
    key: "discountCooldownHours",
    labelAr: "مهلة بين خصمين",
    helpAr: "فترة انتظار بعد عرض خصم قبل عرض خصم آخر لنفس العميل.",
    group: "discount",
    kind: "number",
    min: 0,
    max: 8760,
    unitAr: "ساعة",
  },
  {
    key: "maxDiscountsPerCase",
    labelAr: "حد الخصومات للحالة",
    helpAr: "أقصى عدد من اقتراحات الخصم للحالة الواحدة.",
    group: "discount",
    kind: "number",
    min: 1,
    max: 20,
    unitAr: "مرة",
  },
  {
    key: "maxRecoveryDiscountPercent",
    labelAr: "سقف نسبة الخصم",
    helpAr: "الحد الأعلى لنسبة الخصم — لا يتجاوزها أي اقتراح أبدًا.",
    group: "discount",
    kind: "number",
    min: 1,
    max: 100,
    unitAr: "%",
  },
  {
    key: "maxRecoveryDiscountAmount",
    labelAr: "سقف قيمة الخصم",
    helpAr: "الحد الأعلى لقيمة الخصم بالريال — مهما ارتفع، الاقتراح مقصوص عند هذا السقف.",
    group: "discount",
    kind: "number",
    min: 1,
    max: 1000000,
    unitAr: "ر.س",
  },
  {
    key: "proposedRecoveryDiscountPercent",
    labelAr: "النسبة المقترحة",
    helpAr: "النسبة الافتراضية المقترحة في القرار (ضمن سقف النسبة أعلاه).",
    group: "discount",
    kind: "number",
    min: 1,
    max: 100,
    unitAr: "%",
  },
  {
    key: "expiryHours",
    labelAr: "انتهاء الحالة بعد",
    helpAr: "بعد كم ساعة من أول نشاط تتوقف الحالة عن الجدولة وتُعتبر منتهية.",
    group: "timing",
    kind: "number",
    min: 1,
    max: 8760,
    unitAr: "ساعة",
  },
  {
    key: "scoreDecayHours",
    labelAr: "تناقص النقاط خلال",
    helpAr: "الإشارة تفقد قيمتها تدريجيًا حتى الصفر خلال هذه المدة.",
    group: "timing",
    kind: "number",
    min: 1,
    max: 8760,
    unitAr: "ساعة",
  },
  {
    key: "scores.product_view",
    labelAr: "مشاهدة منتج",
    helpAr: "وزن إشارة مشاهدة منتج — كلما زاد رجّح الأولوية.",
    group: "scores",
    kind: "score",
  },
  {
    key: "scores.repeated_product_view",
    labelAr: "مشاهدة متكررة",
    helpAr: "وزن إعادة مشاهدة نفس المنتج (اهتمام أكبر).",
    group: "scores",
    kind: "score",
  },
  {
    key: "scores.add_to_cart",
    labelAr: "إضافة إلى السلة",
    helpAr: "وزن إضافة منتج للسلة.",
    group: "scores",
    kind: "score",
  },
  {
    key: "scores.checkout_start",
    labelAr: "بدء إتمام الطلب",
    helpAr: "العميل بدأ خطوات الدفع وتراجع.",
    group: "scores",
    kind: "score",
  },
  {
    key: "scores.payment_started",
    labelAr: "بدء الدفع",
    helpAr: "العميل وصل لصفحة الدفع الفعلية.",
    group: "scores",
    kind: "score",
  },
  {
    key: "scores.purchase",
    labelAr: "شراء",
    helpAr: "وزن الإغلاق بالشراء — عادةً قيمة سالبة تُنهي الحالة.",
    group: "scores",
    kind: "score",
  },
];

/** أسماء أعضاء scores المعروفة (يُستخدم للتحقق من إدخال النموذج). */
export const SCORE_KEYS = ["product_view", "repeated_product_view", "add_to_cart", "checkout_start", "payment_started", "purchase"] as const;

const NUM_KEYS = SETTING_FIELDS.filter((f) => f.kind === "number").map((f) => f.key);
const BOOL_KEYS = SETTING_FIELDS.filter((f) => f.kind === "boolean").map((f) => f.key);

/** هل المفتاح معرف؟ (مستوى أعلى) */
export function isKnownSettingKey(key: string): boolean {
  return NUM_KEYS.includes(key) || BOOL_KEYS.includes(key) || (SCORE_KEYS as readonly string[]).includes(key.replace(/^scores\./, ""));
}

/**
 * فحص إدخال إعدادات من النموذج (قيم نصية من inputs).
 *
 * القاعدة: التحقق الكامل قبل القبول. أي حقل غير معروف أو قيمة غير صالحة
 * ⇒ خطأ عربي واضح، ونتيجة غير ناجحة لا تُكتب أبدًا.
 *
 * @param raw قيم النموذج النصية بمفاتيح الحقول (scores.* متداخلة).
 */
export function parseSettingsInput(raw: Record<string, unknown>): { ok: boolean; settings: RecoverySettings; errors: string[] } {
  const settings: RecoverySettings = {};
  const errors: string[] = [];
  const scoresRaw: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(raw)) {
    // «scores» المضمّنة (كائن) تُفكّ إلى أعضائها الستة المعروفة.
    if (key === "scores" && value && typeof value === "object" && !Array.isArray(value)) {
      for (const [sf, sv] of Object.entries(value as Record<string, unknown>)) {
        if (!(SCORE_KEYS as readonly string[]).includes(sf)) {
          errors.push(`وزن إشارة غير معروف: ${sf}`);
          continue;
        }
        const meta = SETTING_FIELDS.find((f) => f.key === `scores.${sf}`);
        const n = meta ? parseFinite(sv) : null;
        if (n === null) {
          errors.push(`«${meta?.labelAr ?? sf}» يجب أن تكون رقمًا (نقطة)`);
        } else {
          scoresRaw[sf] = n;
        }
      }
      continue;
    }

    const meta = SETTING_FIELDS.find((f) => f.key === key);
    if (!meta) {
      errors.push(`حقل غير معروف: ${key}`);
      continue;
    }
    if (meta.kind === "boolean") {
      const b = parseBool(value);
      if (b === null) {
        errors.push(`«${meta.labelAr}» يجب أن تكون نعم/لا`);
      } else {
        if (key === "dryRun") settings.dryRun = b;
        else if (key === "discountRequiresPriorReminder") settings.discountRequiresPriorReminder = b;
      }
      continue;
    }
    if (meta.kind === "score") {
      const n = parseFinite(value);
      if (n === null) {
        errors.push(`«${meta.labelAr}» يجب أن تكون رقمًا (نقطة)`);
      } else {
        scoresRaw[key.replace(/^scores\./, "")] = n;
      }
      continue;
    }
    // عدد
    const num = parseNumber(value, meta.min ?? 0, meta.max);
    if (num === null) {
      const range = meta.max !== undefined ? ` بين ${meta.min ?? 0} و ${meta.max}` : ` لا تقل عن ${meta.min ?? 0}`;
      errors.push(`«${meta.labelAr}» قيمة غير صالحة (يجب أن تكون رقمًا${range})`);
    } else {
      switch (key) {
        case "maxMessages":
          settings.maxMessages = num;
          break;
        case "globalCooldownHours":
          settings.globalCooldownHours = num;
          break;
        case "messagePenalty":
          settings.messagePenalty = num;
          break;
        case "discountEligibleAfterHours":
          settings.discountEligibleAfterHours = num;
          break;
        case "minCartValueForDiscount":
          settings.minCartValueForDiscount = num;
          break;
        case "discountCooldownHours":
          settings.discountCooldownHours = num;
          break;
        case "maxDiscountsPerCase":
          settings.maxDiscountsPerCase = num;
          break;
        case "maxRecoveryDiscountPercent":
          settings.maxRecoveryDiscountPercent = num;
          break;
        case "maxRecoveryDiscountAmount":
          settings.maxRecoveryDiscountAmount = num;
          break;
        case "proposedRecoveryDiscountPercent":
          settings.proposedRecoveryDiscountPercent = num;
          break;
        case "expiryHours":
          settings.expiryHours = num;
          break;
        case "scoreDecayHours":
          settings.scoreDecayHours = num;
          break;
      }
    }
  }

  if (Object.keys(scoresRaw).length) {
    const scores: Record<string, number> = {};
    for (const k of SCORE_KEYS) {
      const n = parseFinite(scoresRaw[k]);
      if (n !== null) scores[k] = n;
    }
    if (Object.keys(scores).length) settings.scores = scores as RecoverySettings["scores"];
  }

  return { ok: errors.length === 0, settings, errors };
}

function parseNumber(value: unknown, min: number, max: number | undefined): number | null {
  const n = parseFinite(value);
  if (n === null) return null;
  if (n < min) return null;
  if (max !== undefined && n > max) return null;
  return Math.trunc(n);
}

function parseFinite(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : null;
}

function parseBool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (v === "true" || v === "1" || v === "on" || v === "نعم") return true;
  if (v === "false" || v === "0" || v === "off" || v === "لا") return false;
  return null;
}

// ---------------------------------------------------------------
// مراحل الاسترجاع
// ---------------------------------------------------------------

/** مفتاح المرحلة: مطابق لقيد قاعدة البيانات بالضبط. */
const STAGE_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** كيان كتابة المرحلة — صورة صالحة تُرسل للقاعدة. */
export type RecoveryStageWrite = {
  id?: number;
  key: string;
  nameAr: string;
  position: number;
  delayMinutes: number;
  isActive: boolean;
  isTerminal: boolean;
  maxTotalMessages: number | null;
  templateId: number | null;
};

/**
 * فحص إدخال مرحلة من النموذج (قيم نصية بصورة عامة).
 *
 * @param raw الإدخال الخام (مفاتيح snake_case مطابقة للأعمدة، أو значений مختلطة).
 * @param nextPosition موضع «المرحلة الجديدة» الافتراضي (أقصى موجود + 1).
 * @param isNew true عند الإضافة؛ عند التعديل يُسمح بغياب حقل == إبقائها.
 */
export function parseStageInput(raw: Record<string, unknown>): { ok: boolean; stage?: RecoveryStageWrite; errors: string[] } {
  const errors: string[] = [];
  const empty = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

  const key = empty(raw.key) ? "" : String(raw.key).trim().toLowerCase();
  if (!key) errors.push("مفتاح المرحلة مطلوب (بالإنجليزية، أحرف صغيرة فقط).");
  else if (!STAGE_KEY_RE.test(key)) errors.push("المفتاح: يبدأ بحرف/رقم، ثم حروف/أرقام أو _ أو - (حتى 64 خانة).");

  const nameAr = empty(raw.nameAr ?? raw.name_ar) ? "" : String(raw.nameAr ?? raw.name_ar).trim();
  if (!nameAr) errors.push("اسم المرحلة بالعربية مطلوب.");
  else if (nameAr.length > 120) errors.push("اسم المرحلة أطول من 120 حرفًا.");

  // التأخير بالدقائق منذ أول نشاط (أخطر حقل — يُفحص بدقة).
  let delayMinutes: number | null = null;
  if (empty(raw.delayMinutes ?? raw.delay_minutes)) {
    errors.push("انتظار المرحلة مطلوب (بالدقائق).");
  } else {
    delayMinutes = intValue(raw.delayMinutes ?? raw.delay_minutes);
    if (delayMinutes === null || delayMinutes < 0 || delayMinutes > 525600) {
      errors.push("انتظار المرحلة: عدد صحيح من الدقائق بين 0 و 525600 (سنة).");
    }
  }

  // الموضع: إجباري صحيحًا عند الإضافة (أو يُسند تلقائيًا)، وبلا تغيير عند التعديل إن غاب.
  let position: number | null = null;
  const positionRaw = raw.position;
  const editing = raw.id !== undefined && raw.id !== null;
  if (!empty(positionRaw)) {
    position = intValue(positionRaw);
    if (position === null || position < 0) errors.push("الترتيب: عدد صحيح لا يقل عن 1 (أو اتركه فارغًا لترتيب تلقائي).");
  } else if (editing) {
    // تعديل دون موضع جديد ⇒ يُترك الموضع كما هو في القاعدة (0 إشارة «لا تغيّر»).
    position = 0;
  } else {
    // إضافة دون موضع ⇒ ترتيب تلقائي (أقصى موجود + 1) ما لم يُحدَّد nextPosition.
    const np = intValue(raw.nextPosition);
    position = np !== null && np >= 1 ? np : 0;
  }

  const isActive = boolLike(raw.isActive, raw.is_active);
  const isTerminal = boolLike(raw.isTerminal, raw.is_terminal);

  let maxTotalMessages: number | null = null;
  if (!empty(raw.maxTotalMessages ?? raw.max_total_messages) && String(raw.maxTotalMessages ?? raw.max_total_messages).trim() !== "") {
    const m = intValue(raw.maxTotalMessages ?? raw.max_total_messages);
    if (m === null || m < 1 || m > 10000) errors.push("سقف الرسائل لهذه المرحلة: صحيح موجب أو فارغ.");
    else maxTotalMessages = m;
  }

  let templateId: number | null = null;
  if (!empty(raw.templateId ?? raw.template_id)) {
    const t = intValue(raw.templateId ?? raw.template_id);
    if (t === null || t < 1) errors.push("القالب: اختيار غير صالح.");
    else templateId = t;
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    stage: {
      ...(raw.id !== undefined && raw.id !== null ? { id: Number(raw.id) } : {}),
      key,
      nameAr,
      position: position ?? 1,
      delayMinutes: delayMinutes as number,
      isActive,
      isTerminal,
      maxTotalMessages,
      templateId,
    },
    errors: [],
  };
}

function intValue(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value.trim()) : Number.NaN;
  return Number.isFinite(n) && Number.isInteger(n) ? n : null;
}

function boolLike(...values: unknown[]): boolean {
  for (const v of values) {
    if (v === undefined || v === null) continue;
    const b = parseBool(v);
    if (b !== null) return b;
  }
  return true;
}

/** تلميح عربي عن خلل صف مرحلة مقروء من القاعدة (للعرض)، أو null إن كان سليمًا. */
export function stageRowHint(row: Record<string, unknown>): string | null {
  const key = String(row.key ?? "").trim().toLowerCase();
  if (!STAGE_KEY_RE.test(key)) return "مفتاح المرحلة غير صالح.";
  const delay = intValue(row.delay_minutes);
  if (delay === null || delay < 0) return "انتظار المرحلة غير صالح.";
  const pos = intValue(row.position);
  if (pos === null || pos < 1) return "ترتيب المرحلة غير صالح.";
  if (row.max_total_messages !== null && row.max_total_messages !== undefined) {
    const m = intValue(row.max_total_messages);
    if (m === null || m < 1) return "سقف الرسائل غير صالح.";
  }
  return null;
}

// ---------------------------------------------------------------
// عرض المدد والمحاكاة
// ---------------------------------------------------------------

/** تنسيق مدة بالدقائق لعرض عربي إنساني. */
export function formatDurationAr(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "فورًا";
  const m = Math.round(minutes);
  if (m < 60) return `${m} دقيقة`;
  const hours = Math.floor(m / 60);
  const rest = m % 60;
  if (rest === 0) return hours === 1 ? "ساعة واحدة" : `${hours} ساعة`;
  return hours === 1 ? `ساعة و ${rest} دقيقة` : `${hours} ساعة و ${rest} دقيقة`;
}

export type StageTimelineStep = {
  /** ترتيب الرسالة ضمن السقف (يبدأ من 1). */
  step: number;
  key: string;
  nameAr: string;
  /** كم دقيقة منذ أول نشاط تُرسل فيها هذه الرسالة. */
  elapsedMinutes: number;
  elapsedLabel: string;
  isTerminal: boolean;
  templateBound: boolean;
};

export type StageTimeline = {
  steps: StageTimelineStep[];
  warnings: string[];
  /** true إن استُخدمت المراحل الافتراضية بدل صفوف القاعدة. */
  usedFallback: boolean;
};

/**
 * محاكاة خطة المراحل: ما الذي سيحدث فعليًا عند التقييم.
 *
 * القواعد:
 *  - المراحل المعطّلة تُستبعد من المحاكاة (والقرار).
 *  - لا مراحل صالحة ⇒ خطة افتراضية (30د/6س/24س) مع تحذير صريح.
 *  - الرسائل مقصوصة بعد سقف maxMessages.
 *  - إن لم تكن المدد متصاعدة زمنيًا: تحذير، لأن الترتيب يؤثر في ترتيب الوصول.
 */
export function simulateStageTimeline(stages: RecoveryStage[] | null | undefined, maxMessages: number | null | undefined): StageTimeline {
  const warnings: string[] = [];
  const cap = Number.isFinite(maxMessages) && (maxMessages as number) >= 1 ? Math.trunc(maxMessages as number) : 3;

  const active = activeStages(stages ?? []);
  if (!active.length) {
    const fallback = stagesFromReminders([30, 360, 1440]);
    warnings.push("لا مراحل مُعرَّفة بعد — ستُستخدم الخطة الافتراضية الحالية (30 دقيقة / 6 ساعات / 24 ساعة).");
    return { steps: buildSteps(fallback, cap), warnings, usedFallback: true };
  }

  if (active.length !== (stages ?? []).length) {
    warnings.push("توجد مراحل معطّلة بعيدًا عن الخطة — لن يُجدول عنها أي رسالة.");
  }

  // تأكيد مفتوح للترتيب بالـposition ثم المفتاح (حتمي).
  const ordered = orderStages(active);

  // رصد تتابع غير متصاعد: مرحلة تأتي بعد سابقة بانتظار أقصر.
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].delayMinutes < ordered[i - 1].delayMinutes) {
      warnings.push(`«${ordered[i].nameAr}» أسرع من المرحلة السابقة زمنيًا — قد تصل رسالتها قبل ترتيبها.`);
    }
    if (ordered[i].delayMinutes === 0) {
      warnings.push(`«${ordered[i].nameAr}» بانتظار صفر — ستُرسل رسالتها فور الكشف.`);
    }
  }

  if (ordered.length > cap) {
    warnings.push(`خطة المراحل أطول من سقف الرسائل (${cap}) — المراحل الأخيرة لن تصل أبدًا ضمن الحالة.`);
  }
  if (ordered.some((s) => s.templateId !== null)) {
    warnings.push("مراحل مرتبطة بقالب — سيُطبَّق الربط عند اكتمال مرحلة إدارة القوالب (لاحقًا).");
  }

  return { steps: buildSteps(ordered, cap), warnings, usedFallback: false };
}

function buildSteps(ordered: RecoveryStage[], cap: number): StageTimelineStep[] {
  const steps: RecoveryStage[] = [];
  for (const s of ordered) {
    if (steps.length >= cap) break;
    steps.push(s);
    if (s.isTerminal) break;
  }
  return steps.map((s, i) => ({
    step: i + 1,
    key: s.key,
    nameAr: s.nameAr,
    elapsedMinutes: s.delayMinutes,
    elapsedLabel: formatDurationAr(s.delayMinutes),
    isTerminal: s.isTerminal,
    templateBound: s.templateId !== null,
  }));
}

/** هل الصورة المخزنة في القاعدة (jsonb) صالحة للكتابة؟ — تُستخدم كحارس أخير. */
export function isValidRecoverySettings(config: unknown): boolean {
  if (!config || typeof config !== "object" || Array.isArray(config)) return false;
  const raw = config as Record<string, unknown>;
  for (const f of SETTING_FIELDS) {
    if (f.kind === "score") continue;
    const value = raw[f.key];
    if (value === undefined) continue;
    if (f.kind === "boolean") {
      if (typeof value !== "boolean") return false;
    } else if (typeof value !== "number" || !Number.isFinite(value)) {
      return false;
    }
  }
  const scores = raw.scores;
  if (scores !== undefined) {
    if (!scores || typeof scores !== "object" || Array.isArray(scores)) return false;
    for (const value of Object.values(scores as Record<string, unknown>)) {
      if (typeof value !== "number" || !Number.isFinite(value)) return false;
    }
  }
  // أسماء الحقول معروفة والحدود (min/max) سليمة.
  return parseSettingsInput(raw).ok;
}
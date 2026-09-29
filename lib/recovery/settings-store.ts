/**
 * مخزن إعدادات الاسترجاع ومراحله (مركز التحكم).
 *
 * مصدران، بدمج مُعرَّف صراحةً:
 *   1) خط الأساس = متغيرات البيئة (RECOVERY_*) عبر loadRecoveryConfig.
 *   2) التجاوز  = recovery_settings (صف واحد) + recovery_stages.
 *
 * fail-safe في كل الحالات: أي خطأ في القراءة (جدول غير مُطبَّق بعد، انقطاع
 * شبكة، صلاحية ناقصة) ⇒ نُرجع خط الأساس كما هو بدل الرمي أو الإيقاف.
 * هذا مهم لأن migrations 034/035/036/037/038 غير مُطبَّقة في Production:
 * قبل تطبيقها يجب أن يعمل كل شيء على_environment فقط، تمامًا كما اليوم.
 *
 * الكتابة (القسم السفلي) مقفلة الحماية أيضًا: كل عملية تبدأ بفحص، ولا
 * يصل أي طلب صالح جزئيًا إلى القاعدة. حالات الطبقة السفلية في كل عملية.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applyRecoverySettings, loadRecoveryConfig, resolveRecoveryDryRun } from "./config";
import type { RecoveryConfig, RecoverySettings } from "./config";
import { readRecoveryEnabled } from "./toggle";
import { resolveStagePlan, stageFromRow, orderStages, stagesFromReminders } from "./stages";
import type { RecoveryStage } from "./stages";
import { parseStageInput, parseSettingsInput, stageRowHint } from "./control-schema";
import { CONFIDENCE_SCALAR_KEYS, INTENT_NESTED_MEMBERS, INTENT_SCALAR_KEYS } from "./control-schema";
import type { RecoveryStageWrite } from "./control-schema";
import { parseTemplateInput, templateRowHint } from "./template-control";
import type { RecoveryTemplateWrite } from "./template-control";
import { MARKETING_TEMPLATES } from "./marketing";

/** جدول صف الإعدادات الوحيد. */
const SETTINGS_TABLE = "recovery_settings";
/** جدول المراحل. */
const STAGES_TABLE = "recovery_stages";

/** من أين جاءت القيم فعليًا — للعرض في اللوحة والتشخيص. */
export type RecoveryConfigSource = "db" | "env" | "empty";

export type RecoveryStagesResult = {
  stages: RecoveryStage[];
  source: RecoveryConfigSource;
  /** رسالة خطأ آمنة (بلا أسرار وبلا بيانات) عند تعذّر القراءة. */
  error: string | null;
};

export type RecoverySettingsResult = {
  settings: RecoverySettings;
  source: RecoveryConfigSource;
  error: string | null;
};

export type EffectiveRecoveryConfig = {
  /** الإعدادات الفعّالة بعد الدمج — ما يقرأه المحرك. */
  cfg: RecoveryConfig;
  /** مفتاح التشغيل كما هو من settings.recovery_enabled. */
  enabled: boolean;
  /** التجاوزات الخام كما وردت (فارغة = لا ضبط في القاعدة). */
  settings: RecoverySettings;
  settingsSource: RecoveryConfigSource;
  stages: RecoveryStage[];
  stagesSource: RecoveryConfigSource;
  /** أخطاء القراءة إن وُجدت — لا تُرمي، فقط تُعرض. */
  errors: { settings: string | null; stages: string | null };
};

export type RecoverySettingsStoreOptions = {
  /** للاختبارات: عميل service_role وهمي. */
  createClient?: () => SupabaseClient;
  /** للاختبارات: تجاوز قراءة مفتاح التشغيل. */
  readEnabled?: () => Promise<boolean>;
};

/** رسالة خطأ آمنة وقصيرة: رمز + نص، بلا أي بيانات صفوف. */
function safeError(error: unknown): string {
  const code = typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : "no-code";
  const message = typeof (error as { message?: unknown })?.message === "string" ? (error as { message: string }).message : "";
  return `${code} ${message}`.trim().slice(0, 200) || "unknown error";
}

/**
 * قراءة تجاوزات الإعدادات من recovery_settings (صف واحد id=1).
 *
 * `config` jsonb قد يحتوي أنواعًا غير متوقعة (تحرير يدوي، قيمة نصية
 * بدل رقم). لذلك لا نثق به: كل حدود تمرّ بـapplyRecoverySettings الذي يرفض
 * القيم غير الصالحة ويُبقي خط الأساس. هنا نُبقي فقط القيم من النوع
 * الصحيح (رقم/منطقي) لنقلها، والباقي يُترك ليُرفض في الدمج.
 */

const NUMERIC_KEYS = [
  "maxMessages",
  "globalCooldownHours",
  "expiryHours",
  "scoreDecayHours",
  "messagePenalty",
  "discountEligibleAfterHours",
  "minCartValueForDiscount",
  "discountCooldownHours",
  "maxDiscountsPerCase",
  "maxRecoveryDiscountPercent",
  "maxRecoveryDiscountAmount",
  "proposedRecoveryDiscountPercent",
] as const;

const BOOLEAN_KEYS = ["dryRun", "discountRequiresPriorReminder"] as const;

export async function readRecoverySettings(
  options: RecoverySettingsStoreOptions = {},
): Promise<RecoverySettingsResult> {
  const createClient = options.createClient ?? createAdminClient;
  try {
    const { data, error } = await createClient()
      .from(SETTINGS_TABLE)
      .select("config")
      .eq("id", 1)
      .maybeSingle();
    if (error) return { settings: {}, source: "empty", error: safeError(error) };
    const raw = (data as { config?: unknown } | null)?.config;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { settings: {}, source: "empty", error: null };
    }
    const config = raw as Record<string, unknown>;
    const settings: RecoverySettings = {};
    // ننسخ الحقول المعروفة فقط، وبنوعها الصحيح. أي مفتاح مجهول يُتجاهل.
    for (const key of NUMERIC_KEYS) {
      const value = config[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        (settings as Record<string, number>)[key] = value;
      }
    }
    for (const key of BOOLEAN_KEYS) {
      const value = config[key];
      if (typeof value === "boolean") (settings as Record<string, boolean>)[key] = value;
    }
    const scores = config.scores;
    if (scores && typeof scores === "object" && !Array.isArray(scores)) {
      const clean: Record<string, number> = {};
      for (const [k, v] of Object.entries(scores as Record<string, unknown>)) {
        if (typeof v === "number" && Number.isFinite(v)) clean[k] = v;
      }
      if (Object.keys(clean).length) settings.scores = clean as unknown as RecoverySettings["scores"];
    }
    const intent = copyRecoveryCompartment(config, "intent", INTENT_SCALAR_KEYS, INTENT_NESTED_MEMBERS);
    if (Object.keys(intent).length) settings.intent = intent as unknown as RecoverySettings["intent"];
    const confidence = copyRecoveryCompartment(config, "confidence", CONFIDENCE_SCALAR_KEYS, null);
    if (Object.keys(confidence).length) settings.confidence = confidence as unknown as RecoverySettings["confidence"];
    const hasAny = Object.keys(settings).length > 0;
    return { settings, source: hasAny ? "db" : "empty", error: null };
  } catch (e) {
    return { settings: {}, source: "empty", error: safeError(e) };
  }
}

/**
 * نسخ مقصورة (intent/confidence) من jsonb الإعدادات — ينسخ القيم الرقمية
 * المعروفة فقط، وبالشكل المتداخل (members داخل groups كـ strengthBase).
 * أي قيمة غير رقمية/غير معروفة تُتجاهل: لا تُنشر إلى المحرك أبدًا.
 */
function copyRecoveryCompartment(
  config: Record<string, unknown>,
  section: string,
  scalarKeys: readonly string[],
  nested: Record<string, readonly string[]> | null,
): Record<string, number | Record<string, number>> {
  const box = config[section];
  if (!box || typeof box !== "object" || Array.isArray(box)) return {};
  const raw = box as Record<string, unknown>;
  const out: Record<string, number | Record<string, number>> = {};
  for (const k of scalarKeys) {
    const v = raw[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  if (nested) {
    for (const [group, members] of Object.entries(nested)) {
      const g = raw[group];
      if (!g || typeof g !== "object" || Array.isArray(g)) continue;
      const clean: Record<string, number> = {};
      for (const m of members) {
        const v = (g as Record<string, unknown>)[m];
        if (typeof v === "number" && Number.isFinite(v)) clean[m] = v;
      }
      if (Object.keys(clean).length) out[group] = clean;
    }
  }
  return out;
}

/**
 * قراءة المراحل من recovery_stages.
 * صفوف غير صالحة تُسقَط ولا تُسقط البقية. جدول غير موجود ⇒ خطة فارغة،
 * وresolveStagePlan يبني منها خط الأساس المشتقّ من remindersMinutes.
 */
export async function readRecoveryStages(options: RecoverySettingsStoreOptions = {}): Promise<RecoveryStagesResult> {
  const createClient = options.createClient ?? createAdminClient;
  try {
    const { data, error } = await createClient()
      .from(STAGES_TABLE)
      .select("key, name_ar, position, delay_minutes, template_id, is_active, is_terminal, max_total_messages")
      .order("position", { ascending: true });
    if (error) return { stages: [], source: "empty", error: safeError(error) };
    const stages = orderStages(
      ((data as Record<string, unknown>[]) || [])
        .map((row) => stageFromRow(row))
        .filter((s): s is RecoveryStage => s !== null),
    );
    return { stages, source: stages.length ? "db" : "empty", error: null };
  } catch (e) {
    return { stages: [], source: "empty", error: safeError(e) };
  }
}

/**
 * نقطة الدخول الواحدة لكل مسارات الاسترجاع (cron + لوحة الإدارة).
 *
 * تجمع ثلاث قراءات صغيرة: مفتاح التشغيل (fail-closed)، ثم تجاوزات الإعدادات،
 * ثم المراحل. أي فشل ⇒ خط أساس البيئة. لا تكتب شيئًا.
 *
 * ترتيب الدمج (مقصود):
 *   1) base = loadRecoveryConfig()            ← البيئة، خط الأساس
 *   2) merged = applyRecoverySettings(base)  ← تجاوزات القاعدة لكل حقل
 *   3) merged.stages = resolveStagePlan()    ← المراحل أو المشتقّة
 *   4) enabled = settings.recovery_enabled   ← مصدر التشغيل الوحيد
 *   5) dryRun  = resolveRecoveryDryRun()     ← قاعدة موحّدة لكل المسارات
 */
export async function loadEffectiveRecoveryConfig(
  options: RecoverySettingsStoreOptions = {},
): Promise<EffectiveRecoveryConfig> {
  const readEnabled = options.readEnabled ?? readRecoveryEnabled;
  const [enabled, settingsResult, stagesResult] = await Promise.all([
    readEnabled(),
    readRecoverySettings(options),
    readRecoveryStages(options),
  ]);

  const base = loadRecoveryConfig();
  const stages = resolveStagePlan(stagesResult.stages, base.remindersMinutes);
  const merged = applyRecoverySettings(base, settingsResult.settings, stages);

  const cfg: RecoveryConfig = {
    ...merged,
    enabled,
    dryRun: resolveRecoveryDryRun(base, enabled, settingsResult.settings),
  };

  return {
    cfg,
    enabled,
    settings: settingsResult.settings,
    settingsSource: settingsResult.source,
    stages,
    stagesSource: stagesResult.source,
    errors: { settings: settingsResult.error, stages: stagesResult.error },
  };
}

// ============================================================
// القراءة الإضافية للوحة الإدارة (مرحلة 2)
// ============================================================

/** صف مرحلة للعرض، مع تقييم صلاحيته (حتى المعطوب يُعرض ليُصلَح لا ليُخفي). */
export type RecoveryStageRowView = {
  id: number | null;
  key: string;
  nameAr: string;
  position: number;
  delayMinutes: number;
  isActive: boolean;
  isTerminal: boolean;
  maxTotalMessages: number | null;
  templateId: number | null;
  valid: boolean;
  /** تلميح عربي لسبب عدم الصلاحية (null إن كان سليمًا). */
  hint: string | null;
  builtin?: boolean;
};

export type RecoveryStagesAllResult = {
  rows: RecoveryStageRowView[];
  source: RecoveryConfigSource;
  error: string | null;
};

const STAGE_COLUMNS = "id, key, name_ar, position, delay_minutes, template_id, is_active, is_terminal, max_total_messages";

const intOrNull = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.trim()) : Number.NaN;
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

const BUILTIN_STAGES: RecoveryStageRowView[] = stagesFromReminders([30, 360, 1440]).map((s) => ({
  id: null,
  key: s.key,
  nameAr: s.nameAr,
  position: s.position,
  delayMinutes: s.delayMinutes,
  isActive: true,
  isTerminal: s.isTerminal,
  maxTotalMessages: s.maxTotalMessages,
  templateId: s.templateId,
  valid: true,
  hint: null,
  builtin: true,
}));

/**
 * كل صفوف المراحل كما هي (بما فيها غير الصالحة ليصلحها المسؤول)، مرتّبة.
 * الصف غير الصالح يُعرض مع تلميح سبب — ولا يُسقط البقية.
 */
export async function readRecoveryStagesAll(options: RecoverySettingsStoreOptions = {}): Promise<RecoveryStagesAllResult> {
  const createClient = options.createClient ?? createAdminClient;
  try {
    const { data, error } = await createClient()
      .from(STAGES_TABLE)
      .select(STAGE_COLUMNS)
      .order("position", { ascending: true })
      .order("key", { ascending: true });
    if (error) return { rows: [], source: "empty", error: safeError(error) };

    const dbRows: RecoveryStageRowView[] = ((data as Record<string, unknown>[]) || []).map((row) => {
      const parsed = stageFromRow(row);
      const hint = stageRowHint(row);
      return {
        id: intOrNull(row.id) ?? 0,
        key: String(row.key ?? ""),
        nameAr: String(row.name_ar ?? "").trim() || String(row.key ?? ""),
        position: intOrNull(row.position) ?? 0,
        delayMinutes: intOrNull(row.delay_minutes) ?? 0,
        isActive: row.is_active === true,
        isTerminal: row.is_terminal === true,
        maxTotalMessages: intOrNull(row.max_total_messages),
        templateId: intOrNull(row.template_id),
        valid: parsed !== null && hint === null,
        hint,
        builtin: false,
      };
    });

    if (dbRows.length === 0) {
      return { rows: BUILTIN_STAGES, source: "empty", error: null };
    }

    const dbKeys = new Set(dbRows.map((r) => r.key));
    const builtinNotOverridden = BUILTIN_STAGES.filter((s) => !dbKeys.has(s.key));
    return { rows: [...dbRows, ...builtinNotOverridden], source: "db", error: null };
  } catch (e) {
    return { rows: [], source: "empty", error: safeError(e) };
  }
}

/** صف قالب للعرض والاختيار (قراءة فقط حتى مرحلة القوالب). */
export type RecoveryTemplateRow = {
  id: number | null;
  key: string;
  nameAr: string;
  title: string;
  body: string;
  isActive: boolean;
  version: number;
  builtin?: boolean;
};

export type RecoveryTemplatesResult = {
  templates: RecoveryTemplateRow[];
  source: RecoveryConfigSource;
  error: string | null;
};

const TEMPLATES_TABLE = "recovery_templates";

/** قراءة القوالب النشطة (مرتبة) لاختيار «ربط المرحلة بقالب». */
export async function listRecoveryTemplates(options: RecoverySettingsStoreOptions = {}): Promise<RecoveryTemplatesResult> {
  const createClient = options.createClient ?? createAdminClient;
  try {
    const { data, error } = await createClient()
      .from(TEMPLATES_TABLE)
      .select("id, key, name_ar, title, body, is_active, version")
      .eq("is_active", true)
      .order("key", { ascending: true });
    if (error) return { templates: [], source: "empty", error: safeError(error) };
    const templates: RecoveryTemplateRow[] = ((data as Record<string, unknown>[]) || []).map((row) => ({
      id: intOrNull(row.id) ?? 0,
      key: String(row.key ?? ""),
      nameAr: String(row.name_ar ?? "").trim() || String(row.key ?? ""),
      title: String(row.title ?? ""),
      body: String(row.body ?? ""),
      isActive: row.is_active === true,
      version: intOrNull(row.version) ?? 1,
    }));
    return { templates, source: templates.length ? "db" : "empty", error: null };
  } catch (e) {
    return { templates: [], source: "empty", error: safeError(e) };
  }
}

// ============================================================
// الكتابة (لوحة الإدارة — مرحلة 2). كلها fail-safe.
// ============================================================

export type RecoveryWritesResult = {
  ok: boolean;
  error: string | null;
};

/** اسم المسؤول (مدخل مؤقت — لا يُستعلم الآن من الجلسة). */
const ADMIN_LABEL = "لوحة الإدارة";

/**
 * حفظ تجاوزات الإعدادات في الصف الواحد (merge مع الموجود؛ لا يمسح حقولًا
 * غير معروضة). يفحص المسودة كاملةً قبل أي كتابة، ويعيد مدمجةً نظيفة.
 */
export async function saveRecoverySettings(
  config: RecoverySettings | null | undefined,
  options: RecoverySettingsStoreOptions = {},
): Promise<RecoveryWritesResult> {
  const createClient = options.createClient ?? createAdminClient;
  try {
    const clean = config ?? {};
    // دمج جزئي فوق الموجود: لا حقل يُمسح لأنه غاب من النموذج.
    const current = await readRecoverySettings(options);
    const existing = current.settings ?? {};
    const merged: Record<string, unknown> = { ...existing } as Record<string, unknown>;
    for (const [k, v] of Object.entries(clean)) {
      if (k === "scores" && v && typeof v === "object") {
        merged.scores = { ...((merged.scores as Record<string, unknown>) ?? {}), ...(v as Record<string, unknown>) };
      } else if (k !== "scores") {
        merged[k] = v;
      }
    }
    // (scores قد يكون موجودًا مسبقًا ولم يُعدّل — يبقى كما هو).

    const { ok, errors } = parseSettingsInput(merged);
    if (!ok) return { ok: false, error: errors.join(" · ") };

    const client = createClient();
    const { error } = await client
      .from(SETTINGS_TABLE)
      .upsert(
        { id: 1, config: merged, updated_at: new Date().toISOString(), updated_by: ADMIN_LABEL },
        { onConflict: "id" },
      );
    if (error) return { ok: false, error: safeError(error) };
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: safeError(e) };
  }
}

/** أكبر موضع مرحلة حاليًا (0 إن لم يوجد صف). */
async function nextStagePosition(client: SupabaseClient): Promise<number> {
  const { data, error } = await client
    .from(STAGES_TABLE)
    .select("position")
    .order("position", { ascending: false })
    .limit(1);
  if (error) return 0;
  const rows = (data as { position: number }[] | null) ?? [];
  if (!rows.length) return 0;
  const p = intOrNull(rows[0].position);
  return p ? p : 0;
}

/** أعمدة صورة المرحلة في القاعدة. */
function stageRow(input: RecoveryStageWrite): Record<string, unknown> {
  return {
    key: input.key,
    name_ar: input.nameAr,
    position: input.position,
    delay_minutes: input.delayMinutes,
    template_id: input.templateId,
    is_active: input.isActive,
    is_terminal: input.isTerminal,
    max_total_messages: input.maxTotalMessages,
  };
}

/** إضافة مرحلة أو تعديلها. التحقق الكامل في خندقين: هنا وفي القاعدة. */
export async function saveRecoveryStage(
  input: RecoveryStageWrite | null | undefined,
  options: RecoverySettingsStoreOptions = {},
): Promise<RecoveryWritesResult> {
  const createClient = options.createClient ?? createAdminClient;
  try {
    if (!input) return { ok: false, error: "بيانات المرحلة مفقودة." };

    // خندق الأول: فحص كامل بصيغة النموذج الأصلية (قبل الوصول للقاعدة).
    const raw = {
      id: input.id,
      key: input.key,
      name_ar: input.nameAr,
      position: input.position,
      delay_minutes: input.delayMinutes,
      is_active: input.isActive,
      is_terminal: input.isTerminal,
      max_total_messages: input.maxTotalMessages,
      template_id: input.templateId,
    };
    const parsed = parseStageInput(raw);
    if (!parsed.ok) return { ok: false, error: parsed.errors.join(" · ") };
    const stage = parsed.stage as RecoveryStageWrite;

    const client = createClient();
    if (stage.id) {
      const patch = stageRow(stage);
      if (stage.position < 1) delete patch.position; // تعديل بلا موضع جديد ⇒ باقٍ كما هو
      const { error } = await client
        .from(STAGES_TABLE)
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", stage.id);
      if (error) return { ok: false, error: safeError(error) };
      return { ok: true, error: null };
    }
    const position = stage.position >= 1 ? stage.position : (await nextStagePosition(client)) + 1;
    const { error: insertError } = await client.from(STAGES_TABLE).insert({ ...stageRow({ ...stage, position }) });
    if (insertError) return { ok: false, error: safeError(insertError) };
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: safeError(e) };
  }
}

/** حذف مرحلة (لا تُحذف الحالات ولا تُمسح البيانات؛ المواضع تُعيد تعبئة من جديد). */
export async function deleteRecoveryStage(id: unknown, options: RecoverySettingsStoreOptions = {}): Promise<RecoveryWritesResult> {
  const createClient = options.createClient ?? createAdminClient;
  try {
    const n = intOrNull(id);
    if (n === null || n < 1) return { ok: false, error: "معرّف مرحلة غير صالح." };
    const client = createClient();
    const { error } = await client.from(STAGES_TABLE).delete().eq("id", n);
    if (error) return { ok: false, error: safeError(error) };
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: safeError(e) };
  }
}

/** تفعيل/تعطيل مرحلة. */
export async function setRecoveryStageActive(
  id: unknown,
  isActive: boolean,
  options: RecoverySettingsStoreOptions = {},
): Promise<RecoveryWritesResult> {
  const createClient = options.createClient ?? createAdminClient;
  try {
    const n = intOrNull(id);
    if (n === null || n < 1) return { ok: false, error: "معرّف مرحلة غير صالح." };
    const client = createClient();
    const { error } = await client
      .from(STAGES_TABLE)
      .update({ is_active: isActive === true, updated_at: new Date().toISOString() })
      .eq("id", n);
    if (error) return { ok: false, error: safeError(error) };
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: safeError(e) };
  }
}

/**
 * إعادة ترتيب المراحل دفعة واحدة. التحقق: المجموعة المرسلة يجب أن تطابق
 * بالضبط مراحل القاعدة (نفس المعرّفات) ثم تُحدَّث المواضع 1..N.
 */
export async function reorderRecoveryStages(orderedIds: number[] | null | undefined, options: RecoverySettingsStoreOptions = {}): Promise<RecoveryWritesResult> {
  const createClient = options.createClient ?? createAdminClient;
  try {
    const ids = (Array.isArray(orderedIds) ? orderedIds : [])
      .map(intOrNull)
      .filter((n): n is number => n !== null && n >= 1);
    if (ids.length < 1 || ids.length !== (orderedIds?.length ?? 0)) {
      return { ok: false, error: "قائمة الترتيب غير صالحة." };
    }
    const client = createClient();
    const { data, error } = await client.from(STAGES_TABLE).select("id");
    if (error) return { ok: false, error: safeError(error) };
    const existing = new Set<number>(((data as { id: number }[] | null) ?? []).map((r) => Number(r.id)));
    if (existing.size !== ids.length || ids.some((n) => !existing.has(n))) {
      return { ok: false, error: "قائمة الترتيب لا تطابق مراحل القاعدة — عُدّلت قائمة من جهة أخرى." };
    }
    // تحديث موضعي واحدًا تلو الآخر (جدول صغير — مقبول).
    for (let i = 0; i < ids.length; i++) {
      const { error: err } = await client.from(STAGES_TABLE).update({ position: i + 1 }).eq("id", ids[i]);
      if (err) return { ok: false, error: safeError(err) };
    }
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: safeError(e) };
  }
}

// ============================================================
// القوالب (المرحلة 3) — قراءة كل الصفوف + كتابة CRUD
// ============================================================

/** صف قالب للوحة الإدارة، مع تقييم صلاحيته (المعطوب يُعرض ليُصلَح). */
export type RecoveryTemplateRowView = RecoveryTemplateRow & {
  valid: boolean;
  /** تلميح عربي لسبب عدم الصلاحية (null إن كان سليمًا). */
  hint: string | null;
};

export type RecoveryTemplatesAllResult = {
  templates: RecoveryTemplateRowView[];
  source: RecoveryConfigSource;
  error: string | null;
};

const BUILTIN_TEMPLATES: RecoveryTemplateRowView[] = MARKETING_TEMPLATES.map((t) => ({
  id: null,
  key: t.key,
  nameAr: t.nameAr,
  title: t.nameAr,
  body: t.variants[0] || "",
  isActive: true,
  version: 1,
  valid: true,
  hint: null,
  builtin: true,
}));

/** كل القوالب (نشطة وغير نشطة) مرتبة، مع تلميح صحة كل صف. */
export async function readRecoveryTemplatesAll(options: RecoverySettingsStoreOptions = {}): Promise<RecoveryTemplatesAllResult> {
  const createClient = options.createClient ?? createAdminClient;
  try {
    const { data, error } = await createClient()
      .from(TEMPLATES_TABLE)
      .select("id, key, name_ar, title, body, is_active, version")
      .order("key", { ascending: true });
    if (error) return { templates: [], source: "empty", error: safeError(error) };

    const dbTemplates: RecoveryTemplateRowView[] = ((data as Record<string, unknown>[]) || []).map((row) => {
      const hint = templateRowHint(row);
      return {
        id: intOrNull(row.id) ?? 0,
        key: String(row.key ?? ""),
        nameAr: String(row.name_ar ?? "").trim() || String(row.key ?? ""),
        title: String(row.title ?? ""),
        body: String(row.body ?? ""),
        isActive: row.is_active === true,
        version: intOrNull(row.version) ?? 1,
        valid: hint === null,
        hint,
        builtin: false,
      };
    });

    if (dbTemplates.length === 0) {
      return { templates: BUILTIN_TEMPLATES, source: "empty", error: null };
    }

    const dbKeys = new Set(dbTemplates.map((t) => t.key));
    const builtinNotOverridden = BUILTIN_TEMPLATES.filter((t) => !dbKeys.has(t.key));
    return { templates: [...dbTemplates, ...builtinNotOverridden], source: "db", error: null };
  } catch (e) {
    return { templates: [], source: "empty", error: safeError(e) };
  }
}

/** صورة صف القالب في القاعدة. */
function templateRow(input: RecoveryTemplateWrite): Record<string, unknown> {
  return {
    key: input.key,
    name_ar: input.nameAr,
    title: input.title,
    body: input.body,
    is_active: input.isActive,
  };
}

/**
 * إضافة قالب أو تعديله. فحص كامل أولًا (مفتاح/اسم/نص/رموز)، ثم فحص
 * تفرّد المفتاح، ثم الكتابة. عند التعديل تُرفع version تلقائيًا.
 */
export async function saveRecoveryTemplate(
  input: RecoveryTemplateWrite | null | undefined,
  options: RecoverySettingsStoreOptions = {},
): Promise<RecoveryWritesResult> {
  const createClient = options.createClient ?? createAdminClient;
  try {
    if (!input) return { ok: false, error: "بيانات القالب مفقودة." };

    // خندق أول: فحص كامل بصيغة النموذج (قبل أي وصول للقاعدة).
    const parsed = parseTemplateInput({
      id: input.id,
      key: input.key,
      name_ar: input.nameAr,
      title: input.title,
      body: input.body,
      is_active: input.isActive,
    });
    if (!parsed.ok) return { ok: false, error: parsed.errors.join(" · ") };
    const t = parsed.template as RecoveryTemplateWrite;

    const all = await readRecoveryTemplatesAll(options);
    if (all.error) return { ok: false, error: `تعذّرت قراءة القوالب: ${all.error}` };
    const duplicate = all.templates.find((r) => r.key === t.key && (t.id === undefined || r.id !== t.id));
    if (duplicate) return { ok: false, error: `مفتاح «${t.key}» مستخدم في قالب آخر.` };

    const client = createClient();
    if (t.id) {
      const version = (all.templates.find((r) => r.id === t.id)?.version ?? 1) + 1;
      const { error } = await client
        .from(TEMPLATES_TABLE)
        .update({ ...templateRow(t), version, updated_at: new Date().toISOString() })
        .eq("id", t.id);
      if (error) return { ok: false, error: safeError(error) };
      return { ok: true, error: null };
    }
    const { error: insertError } = await client.from(TEMPLATES_TABLE).insert({ ...templateRow(t), version: 1 });
    if (insertError) return { ok: false, error: safeError(insertError) };
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: safeError(e) };
  }
}

/** حذف قالب. الربط بالمراحل يُفك تلقائيًا (FK on delete set null). */
export async function deleteRecoveryTemplate(id: unknown, options: RecoverySettingsStoreOptions = {}): Promise<RecoveryWritesResult> {
  const createClient = options.createClient ?? createAdminClient;
  try {
    const n = intOrNull(id);
    if (n === null || n < 1) return { ok: false, error: "معرّف قالب غير صالح." };
    const client = createClient();
    const { error } = await client.from(TEMPLATES_TABLE).delete().eq("id", n);
    if (error) return { ok: false, error: safeError(error) };
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: safeError(e) };
  }
}

/** تفعيل/تعطيل قالب (لا يُحذف ولا يمسّ شيئًا). */
export async function setRecoveryTemplateActive(
  id: unknown,
  isActive: boolean,
  options: RecoverySettingsStoreOptions = {},
): Promise<RecoveryWritesResult> {
  const createClient = options.createClient ?? createAdminClient;
  try {
    const n = intOrNull(id);
    if (n === null || n < 1) return { ok: false, error: "معرّف قالب غير صالح." };
    const client = createClient();
    const { error } = await client
      .from(TEMPLATES_TABLE)
      .update({ is_active: isActive === true, updated_at: new Date().toISOString() })
      .eq("id", n);
    if (error) return { ok: false, error: safeError(error) };
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: safeError(e) };
  }
}

/** مرحلة واحدة مرتبطة بقالب (للعرض في صفحة القوالب). */
export type TemplateBinding = { key: string; nameAr: string };

export type TemplateBindingsResult = {
  /** map: templateId ⇒ المراحل المرتبطة به. */
  bindings: Record<number, TemplateBinding[]>;
  error: string | null;
};

/** أي مرحلة مرتبطة بأي قالب. يقرأ الجدولين بلا كتابة. */
export async function listStageTemplateBindings(options: RecoverySettingsStoreOptions = {}): Promise<TemplateBindingsResult> {
  try {
    const stages = await readRecoveryStagesAll(options);
    if (stages.error) return { bindings: {}, error: stages.error };
    const bindings: Record<number, TemplateBinding[]> = {};
    for (const row of stages.rows) {
      if (row.templateId === null) continue;
      const list = bindings[row.templateId] ?? [];
      list.push({ key: row.key, nameAr: row.nameAr });
      bindings[row.templateId] = list;
    }
    return { bindings, error: null };
  } catch (e) {
    return { bindings: {}, error: safeError(e) };
  }
}

"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth";
import {
  deleteRecoveryStage,
  loadEffectiveRecoveryConfig,
  reorderRecoveryStages,
  saveRecoverySettings,
  saveRecoveryStage,
  setRecoveryStageActive,
} from "@/lib/recovery/settings-store";
import { parseSettingsInput, parseStageInput } from "@/lib/recovery/control-schema";
import { buildRecoveryPlanPreview, buildStagePlanPreview } from "@/lib/recovery/control-preview";
import type { RecoverySettings } from "@/lib/recovery/config";
import type { RecoveryStageWrite } from "@/lib/recovery/control-schema";

/**
 * أكشنات مركز التحكم (المرحلة 2): حفظ إعدادات ومراحل من لوحة الإدارة.
 *
 * الأمان: كل عملية تبدأ بمصادقة المسؤول، ويُتجاهل غير المصرّح به بصمت.
 * الفحص: التحقق الكامل (control-schema) قبل أي كتابة — لا يصل طلب صالح
 * جزئيًا إلى القاعدة أبدًا. الحالة مقفلة: أي خطأ يُرجع بدون رمي.
 */

const REVALIDATE_PATHS = ["/admin/recovery", "/admin/recovery/settings", "/admin/recovery/stages"];

function invalidate() {
  for (const p of REVALIDATE_PATHS) revalidatePath(p);
}

const DENIED = { ok: false as const, error: "غير مصرَّح." };

export type RecoveryActionResult = { ok: boolean; error?: string };

function toResult(result: { ok: boolean; error: string | null }): RecoveryActionResult {
  if (result.ok) return { ok: true };
  return { ok: false, error: result.error ?? "تعذّر الحفظ." };
}

/** حفظ إعدادات الاسترجاع (إدخالات النموذج: قيم نصية). يرفض أي حقل غير صالح. */
export async function saveRecoverySettingsAction(draft: Record<string, unknown>): Promise<RecoveryActionResult> {
  if (!(await getAdminSession())) return DENIED;
  const parsed = parseSettingsInput(draft);
  if (!parsed.ok) return { ok: false, error: parsed.errors.join(" · ") };
  const result = toResult(await saveRecoverySettings(parsed.settings));
  if (result.ok) invalidate();
  return result;
}

/** حفظ مرحلة (إضافة جديدة أو تعديل قائمة). */
export async function saveRecoveryStageAction(input: Record<string, unknown>): Promise<RecoveryActionResult> {
  if (!(await getAdminSession())) return DENIED;
  const parsed = parseStageInput(input);
  if (!parsed.ok) return { ok: false, error: parsed.errors.join(" · ") };
  const result = toResult(await saveRecoveryStage(parsed.stage as RecoveryStageWrite));
  if (result.ok) invalidate();
  return result;
}

/** حذف مرحلة. */
export async function deleteRecoveryStageAction(id: number): Promise<RecoveryActionResult> {
  if (!(await getAdminSession())) return DENIED;
  const result = toResult(await deleteRecoveryStage(id));
  if (result.ok) invalidate();
  return result;
}

/** تفعيل/تعطيل مرحلة. */
export async function setRecoveryStageActiveAction(id: number, isActive: boolean): Promise<RecoveryActionResult> {
  if (!(await getAdminSession())) return DENIED;
  const result = toResult(await setRecoveryStageActive(id, isActive));
  if (result.ok) invalidate();
  return result;
}

/** إعادة ترتيب المراحل (قائمة معرّفات بالترتيب الجديد). */
export async function reorderRecoveryStagesAction(orderedIds: number[]): Promise<RecoveryActionResult> {
  if (!(await getAdminSession())) return DENIED;
  const result = toResult(await reorderRecoveryStages(orderedIds));
  if (result.ok) invalidate();
  return result;
}

// ============================================================
// المعاينة («ما الذي سيحدث قبل الحفظ») — قراءة فقط، بلا كتابة.
// ============================================================

export type RecoveryPlanPreviewResult = ReturnType<typeof buildRecoveryPlanPreview>;

/** معاينة أثر مسودة إعدادات فوق الوضع الحالي. */
export async function previewRecoverySettingsAction(draft?: Record<string, unknown>): Promise<RecoveryPlanPreviewResult> {
  if (!(await getAdminSession())) {
    return { ok: false, errors: ["غير مصرَّح."], effective: emptyEffectiveLike(), changes: [], dryRun: { before: false, after: false }, timeline: { steps: [], warnings: [], usedFallback: false } };
  }
  const parsed = draft ? parseSettingsInput(draft) : { ok: true as const, settings: null as RecoverySettings | null, errors: [] as string[] };
  const effective = await loadEffectiveRecoveryConfig();
  return buildRecoveryPlanPreview({
    draft: parsed.ok ? parsed.settings : null,
    saved: effective.settings,
    enabled: effective.enabled,
    stages: effective.stages,
    parseErrors: parsed.ok ? [] : parsed.errors,
  });
}

/** معاينة خطة المراحل من مسودة صفوف (قد تحتوي تغييرات غير محفوظة). */
export async function previewRecoveryStagesAction(stages: RecoveryStageWrite[]) {
  if (!(await getAdminSession())) {
    return { ok: false, timeline: { steps: [], warnings: ["غير مصرَّح."], usedFallback: false }, maxMessages: 0, errors: [] };
  }
  const effective = await loadEffectiveRecoveryConfig();
  return buildStagePlanPreview({ stages, maxMessages: effective.cfg.maxMessages });
}

// صورة فارغة آمنة ليست من buildRecoveryPlanPreview (لا تُستدعى على خطأ يُفضي للعرض).
function emptyEffectiveLike() {
  return {
    maxMessages: 0,
    globalCooldownHours: 0,
    messagePenalty: 0,
    discountEligibleAfterHours: 0,
    discountRequiresPriorReminder: false,
    minCartValueForDiscount: 0,
    discountCooldownHours: 0,
    maxDiscountsPerCase: 0,
    maxRecoveryDiscountPercent: 0,
    maxRecoveryDiscountAmount: 0,
    proposedRecoveryDiscountPercent: 0,
    expiryHours: 0,
    scoreDecayHours: 0,
    scores: { product_view: 0, repeated_product_view: 0, add_to_cart: 0, checkout_start: 0, payment_started: 0, purchase: 0 },
  };
}
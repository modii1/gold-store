"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth";
import {
  deleteRecoveryTemplate,
  saveRecoveryTemplate,
  setRecoveryTemplateActive,
} from "@/lib/recovery/settings-store";
import { parseTemplateInput, previewTemplate } from "@/lib/recovery/template-control";
import type { TemplatePreviewResult } from "@/lib/recovery/template-control";

/**
 * أكشنات قوالب الاسترجاع (المرحلة 3).
 *
 * الأمان: كل عملية تبدأ بمصادقة المسؤول، ويُتجاهل غير المصرّح به بصمت.
 * الفحص: التحقق الكامل (template-control) + تفرّد المفتاح قبل أي كتابة.
 * المعاينة: قراءة فقط بلا كتابة — تُصيَّر بالقيم التجريبية من قاموس
 * متغيرات الاسترجاع المركزي (variables.ts). لا إرسال حقيقي في هذه المرحلة.
 */

const REVALIDATE_PATHS = ["/admin/recovery", "/admin/recovery/stages", "/admin/recovery/settings", "/admin/recovery/templates"];

function invalidate() {
  for (const p of REVALIDATE_PATHS) revalidatePath(p);
}

const DENIED = { ok: false as const, error: "غير مصرَّح." };

export type RecoveryActionResult = { ok: boolean; error?: string };

function toResult(result: { ok: boolean; error: string | null }): RecoveryActionResult {
  if (result.ok) return { ok: true };
  return { ok: false, error: result.error ?? "تعذّر الحفظ." };
}

/** حفظ قالب (إضافة جديدة أو تعديل قائمة). يرفض غير الصالح، ويصعد version عند التعديل. */
export async function saveRecoveryTemplateAction(input: Record<string, unknown>): Promise<RecoveryActionResult> {
  if (!(await getAdminSession())) return DENIED;
  const parsed = parseTemplateInput(input);
  if (!parsed.ok) return { ok: false, error: parsed.errors.join(" · ") };
  const result = toResult(await saveRecoveryTemplate(parsed.template ?? null));
  if (result.ok) invalidate();
  return result;
}

/** حذف قالب (الربط بالمراحل يُفك تلقائيًا — on delete set null). */
export async function deleteRecoveryTemplateAction(id: number): Promise<RecoveryActionResult> {
  if (!(await getAdminSession())) return DENIED;
  const result = toResult(await deleteRecoveryTemplate(id));
  if (result.ok) invalidate();
  return result;
}

/** تفعيل/تعطيل قالب. */
export async function setRecoveryTemplateActiveAction(id: number, isActive: boolean): Promise<RecoveryActionResult> {
  if (!(await getAdminSession())) return DENIED;
  const result = toResult(await setRecoveryTemplateActive(id, isActive));
  if (result.ok) invalidate();
  return result;
}

/**
 * معاينة نص قالب بالقيم التجريبية (قراءة فقط).
 * customerView=true: عرض مسار العميل (الداخلي discount.* يُزال ويُسجَّل).
 */
export async function previewTemplateAction(body: string, customerView?: boolean): Promise<TemplatePreviewResult> {
  if (!(await getAdminSession())) {
    return {
      ok: false,
      text: "",
      tokens: [],
      unknown: [],
      blockedInternal: [],
      tokenCount: 0,
      warnings: ["غير مصرَّح."],
    };
  }
  return previewTemplate(String(body ?? ""), { customerView });
}
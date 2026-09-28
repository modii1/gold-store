/**
 * مخطط قوالب الاسترجاع — التحقق والمعاينة (المرحلة 3).
 *
 * وحدة نقية بلا أي اتصال:
 *  - فحص إدخال القالب (مفتاح/اسم/نص/حدود) قبل أي كتابة.
 *  - فحص نص الرسالة: أي متغير غير معروف يمنع الحفظ؛ أي متغير داخلي
 *    (discount.*) يُقبل مع تنبيه صريح أنه لن يُرسل للعميل.
 *  - معاينة بالكم بعينة عبر قاموس المتغيرات المركزي (variables.ts).
 *
 * القاعدة الثلاثية من variables.ts هي المرجع الوحيد:
 *   1) لا رمز متغير يصل للرسالة النهائية: غير المعروف/الفارغ ⇢ بديل آمن.
 *   2) discount.* داخلي دائمًا في مسار العميل (تُحذف القيمة وتسجَّل).
 *   3) نصّ عادي، لا HTML ولا JavaScript.
 */

import { findVariable, listTemplateTokens, renderTemplate, validateTemplate, RECOVERY_VARIABLES } from "./variables";
import type { RecoveryVariable } from "./variables";

export const TEMPLATE_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const TEMPLATE_NAME_MAX = 120;
export const TEMPLATE_TITLE_MAX = 200;
export const TEMPLATE_BODY_MAX = 2000;

/** كيان كتابة القالب — صورة صالحة تُرسل للقاعدة. */
export type RecoveryTemplateWrite = {
  id?: number;
  key: string;
  nameAr: string;
  title: string;
  body: string;
  isActive: boolean;
};

export type TemplateParseResult = {
  ok: boolean;
  template?: RecoveryTemplateWrite;
  /** أخطاء تمنع الحفظ. */
  errors: string[];
  /** تنبيهات لا تمنع الحفظ. */
  warnings: string[];
};

/**
 * فحص إدخال قالب من النموذج (قيم نصية عامة).
 * غير معروف في النص = خطأ يمنع الحفظ؛ discount.* = تنبيه فقط.
 */
export function parseTemplateInput(raw: Record<string, unknown>): TemplateParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const empty = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

  const key = empty(raw.key) ? "" : String(raw.key).trim().toLowerCase();
  if (!key) errors.push("مفتاح القالب مطلوب (بالإنجليزية، أحرف صغيرة فقط).");
  else if (!TEMPLATE_KEY_RE.test(key)) errors.push("المفتاح: يبدأ بحرف/رقم، ثم حروف/أرقام أو _ أو - (حتى 64 خانة).");

  const nameAr = empty(raw.nameAr ?? raw.name_ar) ? "" : String(raw.nameAr ?? raw.name_ar).trim();
  if (!nameAr) errors.push("اسم القالب بالعربية مطلوب.");
  else if (nameAr.length > TEMPLATE_NAME_MAX) errors.push(`اسم القالب أطول من ${TEMPLATE_NAME_MAX} حرفًا.`);

  const title = empty(raw.title) ? "" : String(raw.title).trim();
  if (title.length > TEMPLATE_TITLE_MAX) errors.push(`العنوان أطول من ${TEMPLATE_TITLE_MAX} حرفًا.`);

  const body = raw.body === undefined || raw.body === null ? "" : String(raw.body);
  if (!body.trim()) errors.push("نص رسالة القالب مطلوب — الرسالة لا تُكتب فارغة.");
  else if (body.length > TEMPLATE_BODY_MAX) errors.push(`نص الرسالة أطول من ${TEMPLATE_BODY_MAX} حرفًا.`);

  // فحص رموز النص: unknown ممنوع، internal مقبول مع تنبيه.
  let validation: { ok: boolean; unknown: string[]; blockedInternal: string[] } = { ok: true, unknown: [], blockedInternal: [] };
  if (body) {
    validation = validateTemplate(body);
    if (validation.unknown.length) {
      errors.push(`متغيرات غير معروفة في القاموس (لن تصل للعميل أبدًا): ${validation.unknown.join("، ")}.`);
    }
    for (const name of validation.blockedInternal) {
      warnings.push(`«{{${name}}}» متغير خصم داخلي — يُعرض في المعاينة فقط ولا يُرسَل إلى العميل.`);
    }
  }

  const isActive = raw.isActive === undefined ? true : raw.isActive === true || raw.isActive === "true" || raw.isActive === "1";

  if (errors.length) return { ok: false, errors, warnings };

  return {
    ok: true,
    template: {
      ...(raw.id !== undefined && raw.id !== null ? { id: Number(raw.id) } : {}),
      key,
      nameAr,
      title,
      body,
      isActive,
    },
    errors: [],
    warnings,
  };
}

/** تلميح عربي عن خلل صف قالب مقروء من القاعدة (للعرض)، أو null إن كان سليمًا. */
export function templateRowHint(row: Record<string, unknown>): string | null {
  const key = String(row.key ?? "").trim().toLowerCase();
  if (!TEMPLATE_KEY_RE.test(key)) return "مفتاح القالب غير صالح.";
  const nameAr = String(row.name_ar ?? "").trim();
  if (!nameAr || nameAr.length < 1 || nameAr.length > TEMPLATE_NAME_MAX) return "اسم القالب غير صالح.";
  const body = String(row.body ?? "");
  if (!body.trim()) return "نص الرسالة فارغ.";
  if (body.length > TEMPLATE_BODY_MAX) return "نص الرسالة أطول من المسموح.";
  const title = String(row.title ?? "");
  if (title.length > TEMPLATE_TITLE_MAX) return "العنوان أطول من المسموح.";
  const v = validateTemplate(body);
  if (!v.ok) return `نص الرسالة يحتوي متغيرات غير معروفة: ${v.unknown.join("، ")}.`;
  return null;
}

/** هل المفتاح مطابق للقيد (للاستخدام السريع في الواجهة). */
export function isTemplateKeyValid(key: string): boolean {
  return TEMPLATE_KEY_RE.test(String(key ?? "").trim().toLowerCase());
}

// ---------------------------------------------------------------
// المعاينة بالقيم التجريبية
// ---------------------------------------------------------------

/** قيم تجريبية لكل متغير في القاموس (من حقل example). */
export function buildTrialTemplateValues(): Record<string, string> {
  const values: Record<string, string> = {};
  for (const v of RECOVERY_VARIABLES) values[v.name] = v.example ?? "";
  return values;
}

export type TemplatePreviewToken = {
  name: string;
  labelAr: string;
  /** القيمة النهائية التي ستظهر في رسالة العميل. */
  rendered: string;
  /** true إن استُخدمت قيمة تجريبية، false إن سقط إلى البديل الآمن. */
  fromData: boolean;
  /** داخلي (discount.*): لن يظهر في رسالة العميل. */
  internalOnly: boolean;
  /** البديل الآمن عند غياب القيمة. */
  fallback: string;
  /** القيمة التجريبية المعروضة. */
  example: string;
};

export type TemplatePreviewResult = {
  ok: boolean;
  /** النص النهائي بعد التصيير والتنظيف (بدون أي قوس متبقٍ). */
  text: string;
  /** كل متغير استُخدم في النص بترتيب وروده، مع قيمته وبديله. */
  tokens: TemplatePreviewToken[];
  /** متغيرات غير معروفة في القاموس — محذوفة من النص. */
  unknown: string[];
  /** متغيرات داخلية حُذفت من نص العميل (تبقى في المعاينة الداخلية). */
  blockedInternal: string[];
  tokenCount: number;
  /** تنبيهات معاينة لا تمنع العرض. */
  warnings: string[];
};

/**
 * معاينة قالب بالقيم التجريبية من القاموس.
 *
 * customerView = false: عرض داخلي يشمل discount.*.
 * customerView = true: عرض مسار العميل (discount.* تُزال وتُسجَّل).
 */
export function previewTemplate(body: string, options: { customerView?: boolean } = {}): TemplatePreviewResult {
  const includeInternalOnly = options.customerView !== true;
  const values = buildTrialTemplateValues();
  const rendered = renderTemplate(String(body ?? ""), values, { includeInternalOnly });

  const tokens: TemplatePreviewToken[] = rendered.used.map((use) => {
    const def = findVariable(use.name);
    return {
      name: use.name,
      labelAr: def?.labelAr ?? use.name,
      rendered: use.rendered,
      fromData: use.fromData,
      internalOnly: use.internalOnly,
      fallback: def?.fallback ?? "",
      example: def?.example ?? "",
    };
  });

  const warnings: string[] = [];
  if (rendered.unknown.length) {
    warnings.push(`متغيرات غير معروفة حُذفت من الرسالة: ${rendered.unknown.join("، ")} — هكذا تُعامل عند الإرسال أيضًا.`);
  }
  if (rendered.blockedInternal.length) {
    warnings.push("متغيرات خصم داخلية لن تصل للعميل إطلاقًا (تُعرض هنا للمراجعة فقط).");
  }

  return {
    ok: rendered.unknown.length === 0,
    text: rendered.text,
    tokens,
    unknown: rendered.unknown,
    blockedInternal: rendered.blockedInternal,
    tokenCount: tokens.length,
    warnings,
  };
}

/** كل التعريفات المُستخدَمة في نص — للعرض في لوحة «المتغيرات المستخدمة». */
export function describeTemplateTokens(body: string): { name: string; def: RecoveryVariable | null }[] {
  return listTemplateTokens(String(body ?? "")).map((name) => ({ name, def: findVariable(name) }));
}
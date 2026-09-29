/**
 * G6-D — بوابة قسيمة الاسترجاع.
 *
 * هذه أول نقطة في المشروع تصنع قسيمة حقيقية. كل قرار فيها نشط مشتق من
 * الخادم فقط، ولا يُبنى إلا حين يقول محرك القرار `INCENTIVE_CANDIDATE`:
 *
 *   - لا شيء يُنشأ عند `page_view` / `add_to_cart` / `checkout` وحده.
 *   - القسيمة واحدة لكل حالة (unique على `recovery_case_id`) ⇒ سباقان
 *     متوازيان ينتجان قسيمة واحدة، والخاسر يقرأ الفائزة.
 *   - `used_count` لا يُزاد إطلاقًا عند الإنشاء: الاستهلاك يحدث في
 *     `lib/coupons/redeem.ts` بعد إنشاء طلب حقيقي فقط.
 *   - النسبة = min(الاقتراح، سقف النسبة)، والقيمة المطلقة محسوبة على سلة
 *     الحالة مع `max_discount` سقف. السياستان مثبتّتان في صف القسيمة لا في
 *     ذاكرة العملية.
 *   - المالك = جوال الحالة بعد التطبيع، من `recovery_cases` لا من العميل.
 *   - `ends_at` = الأسبق بين صلاحية القسيمة ونهاية مهلة الحالة — لا تاريخ
 *     جديد ولا setting جديد.
 *
 * الوحدة خالصة (لا Supabase ولا شبكة)؛ الكتابة بواجهة `IncentiveStore`
 * ينفّذها adapter واحد، فتُختبر كل قاعدة بلا قاعدة بيانات.
 */

import { generateCouponCode } from "@/lib/coupons/code";
import { normalizeCouponCode } from "@/lib/coupons/policy";
import { normalizePhoneInternational } from "@/lib/format";
import type { RecoveryConfig } from "./config";
import type { RecoveryCase, RecoveryCouponView } from "./types";

export type { RecoveryCouponView };

/** القيم التي تُحفظ في صف القسيمة — مصدر الحقيقة خارج العملية. */
export type CouponIncentiveRow = {
  id: string;
  code: string;
  type: "percent" | "fixed";
  value: number;
  max_discount: number | null;
  min_order: number;
  starts_at: string | null;
  ends_at: string | null;
  usage_limit: number;
  used_count: number;
  is_active: boolean;
  customer_identifier: string | null;
  recovery_case_id: string | null;
  scope: string | null;
  source: string | null;
};

/** العرض الآمن للقسيمة داخل Recovery معرَّف في `./types` (يُعاد تصديره هنا). */

export type IncentiveSkipReason =
  | "recovery_disabled"
  | "dry_run"
  | "not_incentive_candidate"
  | "invalid_phone"
  | "cart_below_minimum"
  | "discount_limit_reached"
  | "cooldown_active"
  | "too_early"
  | "prior_reminder_missing"
  | "invalid_discount_policy"
  | "no_coupon_inventory"
  | "coupon_expired"
  | "coupon_used_up"
  | "store_error"
  | "incentive_unavailable";

/** نتيجة موحّدة: إما قسيمة، وإما سبب تخطٍ صريح (لا استثناء عائم). */
export type IncentiveResult =
  | { ok: true; coupon: RecoveryCouponView; created: boolean }
  | { ok: false; reason: IncentiveSkipReason; created: false };

export type IncentiveRequest = {
  c: RecoveryCase;
  cfg: RecoveryConfig;
  /** هل المحرك أوصى بحافز لهذه الحالة في هذه الدورة؟ */
  incentiveCandidate: boolean;
  /** لحظة الآن (ms) — تُمرَّر دائمًا، بلا وقت نظام. */
  now: number;
};

export type IncentiveStore = {
  /** قراءة القسيمة المرتبطة بالحالة (idempotency) — null إن لم توجد. */
  findByCaseId(caseId: string): Promise<CouponIncentiveRow | null>;
  /** هل الكود مستخدم؟ (لمولّد التصادم). */
  codeExists(code: string): Promise<boolean>;
  /** إدراج القسيمة؛ يرمي unique (23505) عند سباق. */
  insert(row: CouponIncentiveRow): Promise<void>;
  /** تسجيل حالة الخصم على الحالة (discountRef/Count/lastDiscountAt). */
  markCaseDiscounted(caseId: string, code: string, at: number): Promise<void>;
};

const HOUR_MS = 3_600_000;

/**
 * هل يجوز إنشاء قسيمة لهذه الحالة الآن؟
 *
 * تعيد شروط `assessIncentive` نفسها من `./decision` (لا توسيع ولا إلغاء):
 * المحرك وحده يقرر وجود حافز، وهذه الدالة تنسخ شروط الأهلية حتى لا يوجد
 * مسار ثانٍ أضعف. أي اختلاف بين القائمتين يوقف الإنشاء (fail-closed).
 */
export function canCreateIncentive(
  input: IncentiveRequest
): { ok: true; percent: number } | { ok: false; reason: IncentiveSkipReason } {
  const { c, cfg, incentiveCandidate, now } = input;
  if (!cfg.enabled) return { ok: false, reason: "recovery_disabled" };
  if (cfg.dryRun) return { ok: false, reason: "dry_run" };
  if (!incentiveCandidate) return { ok: false, reason: "not_incentive_candidate" };

  if (!c.customerPhone || !normalizePhoneInternational(c.customerPhone)) {
    return { ok: false, reason: "invalid_phone" };
  }
  if (c.cartValue === null || !Number.isFinite(c.cartValue) || c.cartValue < cfg.minCartValueForDiscount) {
    return { ok: false, reason: "cart_below_minimum" };
  }
  // السقف الأقصى للحالة + وجود خصم مسجَّل معًا يمنعان تكرار المنحة.
  const limit = Math.max(1, Math.floor(Number(cfg.maxDiscountsPerCase) || 1));
  if (c.discountCount >= limit || c.discountRef) {
    return { ok: false, reason: "discount_limit_reached" };
  }
  if (c.lastDiscountAt !== null && now - c.lastDiscountAt < cfg.discountCooldownHours * HOUR_MS) {
    return { ok: false, reason: "cooldown_active" };
  }
  if (now - c.lastActivityAt < cfg.discountEligibleAfterHours * HOUR_MS) {
    return { ok: false, reason: "too_early" };
  }
  if (cfg.discountRequiresPriorReminder && c.messageCount <= 0) {
    return { ok: false, reason: "prior_reminder_missing" };
  }
  const percent = resolvePercent(cfg);
  if (percent === null) return { ok: false, reason: "invalid_discount_policy" };
  return { ok: true, percent };
}

/** النسبة الفعلية: min(الاقتراح، سقف النسبة)، مقرّبة للأسفل بلا كسر. */
export function resolvePercent(cfg: RecoveryConfig): number | null {
  const proposed = Number(cfg.proposedRecoveryDiscountPercent);
  const ceiling = Number(cfg.maxRecoveryDiscountPercent);
  if (!Number.isFinite(proposed) || proposed <= 0) return null;
  if (!Number.isFinite(ceiling) || ceiling <= 0) return null;
  return Math.max(1, Math.floor(Math.min(proposed, ceiling)));
}

/** سقف المبلغ المخزَّن في القسيمة (null = بلا سقف مبلغ). */
export function resolveMaxDiscount(cfg: RecoveryConfig): number | null {
  const cap = Number(cfg.maxRecoveryDiscountAmount);
  return Number.isFinite(cap) && cap > 0 ? cap : null;
}

/** تاريخ انتهاء القسيمة: الأسبق بين صلاحيتها ونهاية مهلة الحالة. */
export function resolveEndsAt(input: IncentiveRequest): string | null {
  const { c, cfg, now } = input;
  const couponExpiry = now + Math.max(1, cfg.expiryHours) * HOUR_MS;
  const caseEnd = c.firstDetectedAt ? c.firstDetectedAt + Math.max(1, cfg.expiryHours) * HOUR_MS : null;
  const endsAt = caseEnd === null ? couponExpiry : Math.min(couponExpiry, caseEnd);
  if (!Number.isFinite(endsAt) || endsAt <= now) return null;
  return new Date(endsAt).toISOString();
}

/** الخصم الفعلي على سلة الحالة — نفس حساب checkout داخل حدّ السقف. */
export function computedDiscount(percent: number, cartValue: number, maxDiscount: number | null): number {
  const base = Number.isFinite(cartValue) && cartValue > 0 ? cartValue : 0;
  const raw = (base * percent) / 100;
  const cap = maxDiscount === null ? raw : Math.min(raw, Math.max(0, maxDiscount));
  return Math.max(0, Math.round(Math.min(cap, base) * 100) / 100);
}

/**
 * هل ما زالت قسيمة الحالة قابلة للاستخدام الآن؟
 *
 * `usage_limit = 1` في recovery، فالقسيمة تُستهلك مرة واحدة. بعد نجاح
 * الاستبدال تصبح مستهلكة، وبعد `ends_at` تنتهي — وفي الحالتين لا يجوز أن
 * تُعاد للعميل في رسالة جديدة (كود ميت promise غير قابل للوفاء). القاعدة
 * هنا هي نفسها في `evaluateCoupon`، منفَّذة على صف الاسترجاع.
 */
export function incentiveUsable(row: CouponIncentiveRow, now: number): { ok: true } | { ok: false; reason: IncentiveSkipReason } {
  if (!row.is_active) return { ok: false, reason: "coupon_used_up" };
  if (now >= (time(row.ends_at) ?? Number.POSITIVE_INFINITY)) {
    return { ok: false, reason: "coupon_expired" };
  }
  const limit = Number(row.usage_limit);
  const used = Number(row.used_count);
  if (Number.isFinite(limit) && limit > 0 && used >= limit) {
    return { ok: false, reason: "coupon_used_up" };
  }
  return { ok: true };
}

/** يحوّل صف القاعدة إلى العرض الآمن المستخدَم في الرسائل. */
export function toView(row: CouponIncentiveRow, cartValue: number | null): RecoveryCouponView {
  const cart = cartValue === null || !Number.isFinite(cartValue) ? cartValue : cartValue;
  const base = cart !== null && cart > 0 ? cart : 0;
  const value = Number(row.value);
  // `fixed` مبلغ مباشر لا نسبة: نفس فرع `discountForCoupon` في policy.ts.
  const raw = row.type === "fixed" ? value : (base * value) / 100;
  const cap = row.max_discount === null || row.max_discount === undefined ? null : Number(row.max_discount);
  const limited = cap !== null && Number.isFinite(cap) ? Math.min(raw, Math.max(0, cap)) : raw;
  return {
    code: normalizeCouponCode(row.code),
    type: row.type,
    value: Number.isFinite(value) ? value : 0,
    computedValue: Math.max(0, Math.round(Math.min(limited, base) * 100) / 100),
    expiresAt: row.ends_at ?? null,
  };
}

function time(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * البوابة: تنشئ قسيمة واحدة للحالة أو تعيد الموجودة كما هي.
 *
 * الترتيب مقصود ومهم:
 *
 *   1) قراءة الصف المرتبطة بالحالة. موجودة وصالحة ⇒ تُعاد كما هي بلا كتابة.
 *      هذا ليس تحسينًا بل شرط حيوية: `markCaseDiscounted` يكتب `discountRef`
 *      على الحالة بعد نجاح الإنشاء، فلو سبق الفحصُ القراءةَ لأعاد
 *      `discount_limit_reached` في كل دورة بعد الأولى، والقسيمة الوحيدة التي
 *      يملكها العميل لا تصل إليه أبدًا.
 *   2) موجودة وغير صالحة (منتهية/مستهلكة) ⇒ تخطٍ صريح، ولا ثانية لها
 *      (`recovery_case_id` unique ⇒ قسيمة واحدة للحالة للأبد).
 *   3) غير موجودة ⇒ فحص الأهلية الكامل ثم الإدراج.
 *
 * التزامن: uniqueness يجعل الإدراج الثاني يفشل بـ23505، فنقرأ الفائزة
 * ونعيدها (`created: false`). أي فشل آخر ⇒ `store_error` بلا كود مختلَق
 * ولا retry مفتوح.
 */
export async function createIncentive(
  input: IncentiveRequest,
  store: IncentiveStore,
  options: { generateCode?: (exists: (code: string) => Promise<boolean>) => Promise<string> } = {}
): Promise<IncentiveResult> {
  const { c, cfg, now } = input;
  // لا قراءة ولا قسيمة في وضع الإيقاف أو التجربة الجافة.
  if (!cfg.enabled) return { ok: false, reason: "recovery_disabled", created: false };
  if (cfg.dryRun) return { ok: false, reason: "dry_run", created: false };

  const existing = await store.findByCaseId(c.id);
  if (existing) {
    const usable = incentiveUsable(existing, now);
    if (usable.ok) return { ok: true, coupon: toView(existing, c.cartValue), created: false };
    return { ok: false, reason: usable.reason, created: false };
  }

  const allowed = canCreateIncentive(input);
  if (!allowed.ok) return { ok: false, reason: allowed.reason, created: false };

  const customerIdentifier = normalizePhoneInternational(c.customerPhone);
  if (!customerIdentifier) return { ok: false, reason: "invalid_phone", created: false };

  const maxDiscount = resolveMaxDiscount(cfg);
  if (maxDiscount === null) return { ok: false, reason: "invalid_discount_policy", created: false };
  const endsAt = resolveEndsAt(input);
  if (endsAt === null) return { ok: false, reason: "invalid_discount_policy", created: false };

  // توليد الكود في الخادم (CSPRNG) مع إعادة السحب عند التصادم.
  const generate = options.generateCode ?? ((exists) => generateCouponCode({ exists }));
  let code: string;
  try {
    code = normalizeCouponCode(await generate((candidate) => store.codeExists(candidate)));
  } catch {
    return { ok: false, reason: "no_coupon_inventory", created: false };
  }
  if (!code) return { ok: false, reason: "no_coupon_inventory", created: false };

  // صف واحد يحمل كل القيود: مالك واحد، استخدام واحد، سقف مبلغ، مصدر.
  const row: CouponIncentiveRow = {
    id: deterministicCouponId(c.id),
    code,
    type: "percent",
    value: allowed.percent,
    max_discount: maxDiscount,
    min_order: Math.max(0, Math.floor(Number(cfg.minCartValueForDiscount) || 0)),
    starts_at: new Date(now).toISOString(),
    ends_at: endsAt,
    usage_limit: 1,
    used_count: 0,
    is_active: true,
    customer_identifier: customerIdentifier,
    recovery_case_id: c.id,
    scope: "customer",
    source: "recovery",
  };

  try {
    await store.insert(row);
  } catch (err) {
    // 23505 = سباق (case id أو تصادم كود): الفائز هو الأول، نقرأه ونحترمه.
    if (isUniqueViolation(err) || isDuplicateCode(err)) {
      const winner = await store.findByCaseId(c.id);
      if (winner) {
        const usable = incentiveUsable(winner, now);
        if (usable.ok) return { ok: true, coupon: toView(winner, c.cartValue), created: false };
        return { ok: false, reason: usable.reason, created: false };
      }
    }
    return { ok: false, reason: "store_error", created: false };
  }

  // تسجيل الخصم على الحالة — لا يزيد `used_count` ولا يخصم شيئًا.
  await store.markCaseDiscounted(c.id, row.code, now);
  return { ok: true, coupon: toView(row, c.cartValue), created: true };
}

/**
 * قراءة قسيمة الحالة (idempotent read) — تُستخدم قبل أي إرسال.
 * القسيمة غير الصالحة (منتهية/مستهلكة) تُقرأ كـ`null`: لا تُعرض ولا تُرسل.
 */
export async function getExistingIncentive(
  c: RecoveryCase,
  store: Pick<IncentiveStore, "findByCaseId">,
  now: number
): Promise<RecoveryCouponView | null> {
  const row = await store.findByCaseId(c.id);
  if (!row) return null;
  return incentiveUsable(row, now).ok ? toView(row, c.cartValue) : null;
}

/** معرّف صف حتمي من الحالة ⇒ نفس الحالة تُنتج نفس المعرّف دائمًا. */
export function deterministicCouponId(caseId: string): string {
  const hex = String(caseId ?? "")
    .replace(/-/g, "")
    .padEnd(32, "0")
    .slice(0, 32)
    .split("")
    .map((ch) => ch.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "23505";
}

function isDuplicateCode(err: unknown): boolean {
  const message = String((err as { message?: string } | null)?.message ?? "").toLowerCase();
  return message.includes("coupons_code_key") || message.includes("coupons_code_unique");
}

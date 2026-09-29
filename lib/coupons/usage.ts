/**
 * Coupon usage accounting — compare-and-set، بلا SQL جديد وبلا migration.
 *
 * المشكلة قبل G6-A: `read used_count` ثم `write used_count + 1`. طلبان
 * متزامنان يقرآن نفس الرقم ويكتبان نفس الرقم ⇒ lost update ⇒ العدّاد
 * ينقص عن الحقيقي، فيتجاوز الكود حدّه بلا خدش (الاتجاه الخطر ماليًا).
 *
 * الحل داخل طبقة التطبيق: update شرطي على القيمة التي قُرئت فعلًا
 * (`.eq("used_count", observed)`). إن فشل الشرط ⇒ سباق حقيقي ⇒ نعيد القراءة
 * ونحاول مجددًا. هكذا لا يضيع أي استخدام أبدًا.
 *
 * الحدّ المطلق (قاعدة بيانات ذرّية) يحتاج RPC/migration ⇒ غير منفذ هنا، وموثّق
 * في التقرير. الأثر المتبقي: قد يُقبل طلبان في اللحظة نفسها بالضبط.
 */

import { normalizeCouponCode } from "./policy";

export type CouponUsageRecord = {
  id: string;
  code: string;
  usage_limit: number | null;
  used_count: number | string | null;
};

export type CouponUsageStore = {
  /** يقرأ السطر الحالي للصف (service role). */
  readByCode(code: string): Promise<CouponUsageRecord | null>;
  /**
   * يكتب value+1 فقط إذا كان ما في القاعدة = value. يعيد true عند كتابة
   * فعلي، false إذا تغيّر الصف بين القراءة والكتابة (سباق).
   */
  compareAndSet(id: string, observedUsedCount: number, nextUsedCount: number): Promise<boolean>;
};

export type CouponUsageOutcome = "incremented" | "exhausted" | "missing" | "raced";

function num(value: unknown): number {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : 0;
}

export async function incrementCouponUsage(
  store: CouponUsageStore,
  code: string,
  maxAttempts = 3
): Promise<CouponUsageOutcome> {
  const normalized = normalizeCouponCode(code);
  if (!normalized) return "missing";

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const row = await store.readByCode(normalized);
    if (!row) return "missing";

    const used = num(row.used_count);
    const limit = row.usage_limit === null || row.usage_limit === undefined ? null : num(row.usage_limit);
    if (limit !== null && used >= limit) return "exhausted";

    const written = await store.compareAndSet(row.id, used, used + 1);
    if (written) return "incremented";
  }

  return "raced";
}

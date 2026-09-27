import { timingSafeEqual } from "node:crypto";

/**
 * حارس مصادقة مسارات الـcron (مثل /api/recovery/run).
 *
 * fail-closed: إذا لم يكن CRON_SECRET معرَّفًا أو فارغًا ⇒ رفض دائمًا.
 * لا يوجد أي تركيبة تُبقي المسار مفتوحًا:
 *   - سر غير معرَّف  ⇒ false
 *   - سر فارغ/مسافات ⇒ false
 *   - header مفقود   ⇒ false
 *   - header خاطئ    ⇒ false
 *   - header صحيح    ⇒ true
 *
 * المقارنة بـ timingSafeEqual لتفادي هجمات التوقيت.
 * دالة نقية بلا أي آثار جانبية — قابلة للاختبار وحدها بلا أي طلب شبكة.
 */
export function isCronAuthorized(
  headerSecret: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const secret = (env.CRON_SECRET ?? "").trim();
  if (!secret) return false;
  if (typeof headerSecret !== "string" || headerSecret.length === 0) return false;

  const provided = Buffer.from(headerSecret, "utf8");
  const expected = Buffer.from(secret, "utf8");
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

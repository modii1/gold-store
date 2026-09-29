/**
 * G6-B / BLOCKER 5 — مولّد أكواد خصم آمن.
 *
 * ⚠️ لم يُوصَل بأي production flow: هذا الملف لا يُستورد من أي server action ولا
 * من `Recovery`. أُنشئ كـpure module + اختبارات، ويُفعَّل في مرحلة لاحقة بعد
 * الموافقة على مخطط customer binding و`redeem_coupon` RPC.
 *
 * قرارات التصميم:
 * - CSPRNG فقط (`crypto.getRandomValues`) — لا `Math.random`.
 * - الحروف والأرقام بلا رموز متشابهة (0/O, 1/I/L) حتى لا يُخطئ العميل عند
 *  Typing: كل خطأ كتابي = تجربة سيئة وكوبون «غير موجود».
 * - لا بادئة ولا لاحقة: أي بادئة تكشف مصدر الكود (Recovery مقابل promo) لكل
 *   من يحمل لقطة شاشة، وتقترب من كشف case id. الكود عشوائي بالكامل.
 * - لا PII إطلاقًا: أبجدية من 30 محرفًا لا تحتوي أي أرقام متصلة يمكن أن
 *   تُقرأ كجزء من جوال أو رقم طلب.
 * - توزيع منتظم تمامًا: 240 بايت مقبولة من 256 (240 = 30 × 8) ⇒ `b % 30` بلا
 *   انحياز، و6.25% فقط من البايتات تُعاد محاولة سحبها.
 */

/** A-Z بدون I/L/O + 2-9 (بلا 0/1) = 30 محرفًا. */
export const COUPON_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

export const DEFAULT_CODE_LENGTH = 16;

/** أقل طول مقبول — يمنع الرجوع لأي نمط قصير سهل (1-6 محارف أو اسم كلمة). */
export const MIN_CODE_LENGTH = 10;

/** عدد البايتات المقبولة لكل جولة (مضاعف لـ30 ⇒ توزيع منتظم بلا انحياز). */
const ACCEPTED_BYTES = COUPON_CODE_ALPHABET.length * Math.floor(256 / COUPON_CODE_ALPHABET.length);

export type RandomBytes = (n: number) => Uint8Array;

function defaultRandomBytes(n: number): Uint8Array {
  const buffer = new Uint8Array(n);
  const source = globalThis.crypto;
  if (!source || typeof source.getRandomValues !== "function") {
    throw new Error("secure random source unavailable — لا يُستخدم fallback غير عشوائي");
  }
  source.getRandomValues(buffer);
  return buffer;
}

/** bits of entropy for a given length = length × log2(alphabet). */
export function couponCodeEntropyBits(length: number = DEFAULT_CODE_LENGTH): number {
  return length * Math.log2(COUPON_CODE_ALPHABET.length);
}

/** يولّد كودًا واحدًا من CSPRNG. بلا I/O، بلا قاعدة بيانات. */
export function randomCouponCode(
  length: number = DEFAULT_CODE_LENGTH,
  randomBytes: RandomBytes = defaultRandomBytes
): string {
  if (!Number.isInteger(length) || length < MIN_CODE_LENGTH) {
    throw new Error(`coupon code length must be an integer >= ${MIN_CODE_LENGTH}`);
  }

  const out: string[] = [];
  let rounds = 0;
  while (out.length < length) {
    const bytes = randomBytes(32);
    for (const byte of bytes) {
      if (byte >= ACCEPTED_BYTES) continue; // رفض بدل modulo bias
      out.push(COUPON_CODE_ALPHABET[byte % COUPON_CODE_ALPHABET.length]);
      if (out.length === length) break;
    }
    if (++rounds > 1024) throw new Error("random source degenerate — راجع مزوّد العشوائية");
  }
  return out.join("");
}

export type GenerateCouponCodeOptions = {
  length?: number;
  /** يُستدعى بكل كود مرشّح؛ يعيد true إن كان مستخدمًا. */
  exists?: (code: string) => boolean | Promise<boolean>;
  maxAttempts?: number;
  randomBytes?: RandomBytes;
};

/**
 * مولّد بمعالجة التصادم: `coupons.code` فريد، والمولّد لا يعرف القاعدة، فيُعاد
 * السحب عند وجود تعارض. الفشل بعد `maxAttempts` استثناء صريح — لا يُعاد كود
 * مكرر ولا يُخفى التعارض.
 */
export async function generateCouponCode(options: GenerateCouponCodeOptions = {}): Promise<string> {
  const { length = DEFAULT_CODE_LENGTH, exists, maxAttempts = 5, randomBytes = defaultRandomBytes } = options;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error("maxAttempts must be >= 1");

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const code = randomCouponCode(length, randomBytes);
    if (!exists) return code;
    if (!(await exists(code))) return code;
  }
  throw new Error("coupon code collision: استُنفدت المحاولات");
}

/** شكل الكود المولَّد (للتحقق والتوثيق، لا للتحقق من صحة كود موجود). */
export function isGeneratedCouponCodeFormat(code: string, length: number = DEFAULT_CODE_LENGTH): boolean {
  if (typeof code !== "string" || code.length !== length) return false;
  for (const char of code) {
    if (!COUPON_CODE_ALPHABET.includes(char)) return false;
  }
  return true;
}

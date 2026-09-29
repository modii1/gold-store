/**
 * Phase 1 — طبقة الأدلة: analytics_events ← الأدلة النقية للنية والثقة.
 *
 * هذه الوحدة لا تقرر شيئًا: لا SEND ولا WAIT ولا كوبون ولا NO_ACTION.
 * سؤالها الوحيد: «ماذا حدث للعميل؟» ثم «ما الأدلة التي يمكن تمريرها إلى
 * computeIntent / computeConfidence؟».
 *
 * فصلٌ صريح بين الملاحظة والاستنتاج:
 *  - observations: حقائق مميّزة مستخرجة من الأحداث المسجّلة فعلًا
 *    (عدد أحداث لكل نوع، جلسات مميّزة، أزواج منتج×جلسة، آخر نشاط...).
 *  - inference: استنتاجات مسمّاة صراحةً ومبنيّة فقط على observations
 *    (اهتمام متكرر، وصول لإتمام، شراء حديث...). لا استنتاج غير مدعوم.
 *
 * منع العدّ المزدوج بنيويًا لا صيغيًّا:
 *  - computeIntent / computeConfidence لا يأخذان أبدًا عدد الأحداث الخام،
 *    بل مقادير مميّزة فقط: جلسات مميّزة، أزواج (منتج×جلسة)، أزواج (إشارة×جلسة).
 *  - مئة معاينة لنفس المنتج في جلسة واحدة = زوج واحد داخل الجلسة لا مئة إشارة.
 *
 * قراءة فقط: لا كتابة إلى analytics_events ولا إلى أي جدول، بلا migration.
 * لا هوية مخترعة: analytics_events لا يحمل هوية العميل (بلا PII)، والهوية
 * تُمرَّر من سياق الحالة (identity) وإلا يُعامَل الزائر كمجهول.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecoveryConfig } from "./config";
import type { CaseType } from "./types";
import { computeIntent, type IntentEvidence, type IntentResult } from "./intent";
import { computeConfidence, type ConfidenceEvidence, type ConfidenceResult } from "./confidence";

const HOUR_MS = 3600_000;
const DEFAULT_FUTURE_TOLERANCE_MS = 5 * 60_000;

/** الأحداث السلوكية المدعومة بوصفها دليلًا — مطابقة للأحداث الفعلية في النظام. */
export const SUPPORTED_ANALYTICS_TYPES = [
  "product_view",
  "add_to_cart",
  "remove_from_cart",
  "checkout_start",
  "payment_started",
  "purchase",
] as const;

export type SupportedAnalyticsEvent = (typeof SUPPORTED_ANALYTICS_TYPES)[number];

/** إشارات التقدم (بلا remove/purchase — ليسا إشارة إقدام). */
const SIGNAL_TYPES: readonly SupportedAnalyticsEvent[] = [
  "product_view",
  "add_to_cart",
  "checkout_start",
  "payment_started",
];

export type EvidenceIdentity = "logged_in" | "anonymous" | "unknown";

/** صف مطابق لأعمدة analytics_events الفعلية (migration-016) — تحمّل الغياب. */
export type AnalyticsEventRow = {
  id?: string | null;
  visitor_id?: string | null;
  session_id?: string | null;
  event_type?: string | null;
  page_path?: string | null;
  product_id?: string | null;
  product_slug?: string | null;
  referrer?: string | null;
  device_type?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | number | Date | null;
};

/** زوج (منتج × جلسة) للمعاينة — المقياس المميّز الحقيقي للمشاهدات. */
export type ProductViewPair = {
  productId: string;
  slug: string | null;
  /** معاينات خام (ملاحظة). */
  views: number;
  /** جلسات مميّزة ذهبت فيها معاينة لهذا المنتج. */
  sessions: number;
  /** جلسات فيها ≥2 معاينة لنفس المنتج (إصرار داخل الجلسة). */
  repeatedSameSession: number;
};

export type EvidenceDropped = {
  /** حدث بلا event_type أو بلا session_id صالح. */
  malformed: number;
  /** timestamp غير قابل للتحليل. */
  nonNumericTime: number;
  /** timestamp مستقبلي (يتجاوز التسامح). */
  future: number;
  /** أقدم من النافذة الزمنية. */
  outsideWindow: number;
  /** نوع غير مدعوم (page_view / recovery_* / discount_*...). */
  unsupportedType: number;
  /** نسخة حرفية مكررة (إعادة إرسال retry لدفعة واحدة). */
  exactDuplicates: number;
};

export type EvidenceObservations = {
  /** عدد الأحداث الخام لكل نوع مدعوم — ملاحظة، لا تُمرَّر كما هي إلى النماذج. */
  eventCounts: Record<SupportedAnalyticsEvent, number>;
  /** الأحداث المستخدمة فعلًا بعد التصفية والتكرار الحرفي. */
  eventsUsedCount: number;
  /** الجلسات المميّزة. */
  uniqueSessions: number;
  /** المنتجات المميّزة. */
  uniqueProducts: number;
  /** أزواج (منتج × جلسة) للمعاينة. */
  productViewPairs: ProductViewPair[];
  /** منتج الحالة إن وُجد في الملاحظات وإلا المنتج الأكثر أزواجًا. */
  preferredProduct: ProductViewPair | null;
  /** مجموع أزواج (منتج × جلسة) بمعاينات ≥2 في نفس الجلسة على كل المنتجات. */
  repeatedSameSession: number;
  /** آخر قيمة سلة موثقة (checkout_start.metadata.subtotal أو purchase.metadata.value). */
  cartValue: number | null;
  /** عدد أصناف السلة — غير متوفر في analytics_events إطلاقًا. */
  cartItems: number | null;
  /** أزواج (إشارة × جلسة) — المقياس المميّز لإشارات الثقة. */
  signalDistinctPairs: number;
  /** معاينات بلا منتج معلوم (لا تُنسب لأي منتج). */
  unattributedProductViews: number;
  /** زمن أول / آخر نشاط (ملاحظة دقيقة من timestamps الفعلية). */
  firstActivityAt: number | null;
  lastActivityAt: number | null;
  /** شراء مكتمل مسجّل داخل النافذة. */
  hasRecentPurchase: boolean;
  /** هوية الزائر كما أعطاها سياق الحالة (لا من analytics). */
  identity: EvidenceIdentity;
};

export type EvidenceInference = {
  /** اهتمام متكرر بالمنتج المفضّل (عبر جلسات أو إصرار داخل جلسة). */
  repeatedProductInterest: boolean;
  /** نشاط في أكثر من جلسة واحدة. */
  multiSessionActivity: boolean;
  addToCartReached: boolean;
  checkoutReached: boolean;
  paymentReached: boolean;
  purchasedRecently: boolean;
};

export type EvidenceCoverage = {
  windowHours: number;
  windowStartMs: number;
  windowEndMs: number;
  eventsRead: number;
  eventsUsed: number;
  dropped: EvidenceDropped;
  /** خطأ قراءة المصدر (فقط في fail-safe) — null في الحالة السليمة. */
  sourceError: string | null;
};

export type RecoveryEvidence = {
  observations: EvidenceObservations;
  inference: EvidenceInference;
  coverage: EvidenceCoverage;
};

export type EvidenceBuildOptions = {
  /** لحظة التقييم (مللي ثانية) — افتراضيًا الآن. */
  asOf?: number;
  /** نافذة زمنية للأدلة بالساعات — افتراضيًا أقصى (expiryHours, scoreDecayHours). */
  windowHours?: number;
  /** هوية الزائر من سياق الحالة — إفتراضيًا unknown (مجهول). */
  identity?: EvidenceIdentity;
  /** منتج الحالة لتوجيه استنتاج «الاهتمام المتكرر». */
  preferredProductId?: string | null;
  /** تسامح المستقبل (مللي ثانية) — افتراضيًا 5 دقائق. */
  futureToleranceMs?: number;
};

export type EvidenceSourceOptions = EvidenceBuildOptions & {
  /** حقن عميل القراءة (للاختبار فقط) — افتراضيًا عميل الخدمة. */
  createClient?: () => SupabaseClient;
};

/** سياق الحالة المطلوب لترجمته إلى أدلة النموذجين — لا يُستنتج من analytics أبدًا. */
export type IntelligenceContext = {
  caseType: CaseType;
  preferredProductId?: string | null;
  /** snapshot قيمة السلة المخزّن في الحالة (نفس مصدر analytics عند الاستيعاب). */
  caseCartValue?: number | null;
  identity?: EvidenceIdentity;
};

export type IntelligenceEvaluation = {
  evidence: RecoveryEvidence;
  intent: IntentResult;
  confidence: ConfidenceResult;
  /** ما دخل النموذجين فعلًا — للشفافية. */
  intentEvidence: IntentEvidence;
  confidenceEvidence: ConfidenceEvidence;
};

export function defaultEvidenceWindowHours(cfg: RecoveryConfig): number {
  return Math.max(Number(cfg.expiryHours) || 0, Number(cfg.scoreDecayHours) || 0, 1);
}

function parseEventMs(ts: unknown): number | null {
  if (ts === null || ts === undefined || ts === "") return null;
  if (ts instanceof Date) {
    const t = ts.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof ts === "number") return Number.isFinite(ts) ? ts : null;
  if (typeof ts === "string") {
    const t = Date.parse(ts);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return String(v ?? "");
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(",")}}`;
}

function numericMeta(m: unknown, key: string): number | null {
  if (!m || typeof m !== "object") return null;
  const v = (m as Record<string, unknown>)[key];
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

function emptyDropped(): EvidenceDropped {
  return { malformed: 0, nonNumericTime: 0, future: 0, outsideWindow: 0, unsupportedType: 0, exactDuplicates: 0 };
}

/**
 * بناء الأدلة من صفوف analytics_events محلية (نقية وحتمية).
 *
 * يمر كل صف بسلسلة حماية: تحليل سليم → نافذة زمنية → لا مستقبل → نوع مدعوم →
 * لا تكرار حرفي. ثم تُستخرج الملاحظات المميّزة التي تحمي من العدّ المزدوج،
 * ويُستنتج ما يُستنتج صراحةً فقط.
 */
export function buildRecoveryEvidence(rows: AnalyticsEventRow[], opts: EvidenceBuildOptions = {}, cfg: RecoveryConfig, sourceError: string | null = null): RecoveryEvidence {
  const asOf = opts.asOf ?? Date.now();
  const windowHours = opts.windowHours ?? defaultEvidenceWindowHours(cfg);
  const windowMs = Math.max(1, windowHours * HOUR_MS);
  const futureToleranceMs = opts.futureToleranceMs ?? DEFAULT_FUTURE_TOLERANCE_MS;
  const windowStart = asOf - windowMs;

  const dropped = emptyDropped();
  let eventsUsed = 0;
  let unattributedProductViews = 0;
  let minAt = Number.POSITIVE_INFINITY;
  let maxAt = -Number.POSITIVE_INFINITY;

  const eventCounts = Object.fromEntries(SUPPORTED_ANALYTICS_TYPES.map((t) => [t, 0])) as Record<SupportedAnalyticsEvent, number>;
  const sessionsSeen = new Set<string>();
  const productsSeen = new Set<string>();
  const signalPairs = new Set<string>();
  const seen = new Set<string>();
  const purchaseCount = { n: 0 };
  let priced = { value: 0, at: -1 };
  let pricedFound = false;

  // منتج × جلسة ← عدد معاينات
  const productPairs = new Map<string, { productId: string; slug: string | null; perSession: Map<string, number>; lastAt: number }>();

  for (const row of rows) {
    const type = typeof row.event_type === "string" ? row.event_type : null;
    const session = typeof row.session_id === "string" && row.session_id.length > 0 ? row.session_id : null;
    if (!type || !session) {
      dropped.malformed++;
      continue;
    }
    const ts = parseEventMs(row.created_at);
    if (ts === null) {
      dropped.nonNumericTime++;
      continue;
    }
    if (ts > asOf + futureToleranceMs) {
      dropped.future++;
      continue;
    }
    if (ts < windowStart) {
      dropped.outsideWindow++;
      continue;
    }
    if (!(SUPPORTED_ANALYTICS_TYPES as readonly string[]).includes(type)) {
      dropped.unsupportedType++;
      continue;
    }

    // نسخة حرفية مكررة (إعادة إرسال لدفعة/طلب واحد): تُدفع مرّة واحدة.
    const product = typeof row.product_id === "string" && row.product_id.length > 0 ? row.product_id : null;
    const dupKey = `${type}|${session}|${product ?? ""}|${ts}|${stableStringify(row.metadata ?? {})}`;
    if (seen.has(dupKey)) {
      dropped.exactDuplicates++;
      continue;
    }
    seen.add(dupKey);

    const t = type as SupportedAnalyticsEvent;
    eventCounts[t]++;
    eventsUsed++;
    sessionsSeen.add(session);
    if (ts < minAt) minAt = ts;
    if (ts > maxAt) maxAt = ts;

    if ((SIGNAL_TYPES as readonly string[]).includes(type)) signalPairs.add(`${type}|${session}`);

    if (type === "product_view") {
      if (!product) {
        unattributedProductViews++;
        continue;
      }
      productsSeen.add(product);
      let entry = productPairs.get(product);
      if (!entry) {
        entry = { productId: product, slug: typeof row.product_slug === "string" ? row.product_slug : null, perSession: new Map(), lastAt: ts };
        productPairs.set(product, entry);
      }
      entry.perSession.set(session, (entry.perSession.get(session) ?? 0) + 1);
      if (ts > entry.lastAt) {
        entry.lastAt = ts;
        if (typeof row.product_slug === "string") entry.slug = row.product_slug;
      }
    } else if (type === "add_to_cart" || type === "remove_from_cart") {
      if (product) productsSeen.add(product);
    } else if (type === "checkout_start" || type === "payment_started") {
      const v = type === "checkout_start" ? numericMeta(row.metadata, "subtotal") : null;
      if (v !== null && ts >= priced.at) {
        priced = { value: v, at: ts };
        pricedFound = true;
      }
    } else if (type === "purchase") {
      purchaseCount.n++;
      const v = numericMeta(row.metadata, "value");
      if (v !== null && ts >= priced.at) {
        priced = { value: v, at: ts };
        pricedFound = true;
      }
    }
  }

  // أكمل عقودونا: كل منتج ← زوج (منتج × جلسات) مع إحصاء إصرار داخل الجلسة.
  const pairs: ProductViewPair[] = [];
  for (const entry of productPairs.values()) {
    let sessions = 0;
    let repeatedSameSession = 0;
    for (const count of entry.perSession.values()) {
      sessions++;
      if (count >= 2) repeatedSameSession++;
    }
    pairs.push({ productId: entry.productId, slug: entry.slug, views: entry.perSession.size ? [...entry.perSession.values()].reduce((a, b) => a + b, 0) : 0, sessions, repeatedSameSession });
  }
  pairs.sort((a, b) => b.sessions - a.sessions || b.views - a.views || (a.productId < b.productId ? 1 : -1));

  const topProduct = pairs[0] ?? null;
  const focusId = opts.preferredProductId && pairs.some((p) => p.productId === opts.preferredProductId) ? opts.preferredProductId : topProduct?.productId ?? null;
  const preferredProduct = (focusId ? pairs.find((p) => p.productId === focusId) : null) ?? topProduct;

  const repeatedSameSession = pairs.reduce((acc, p) => acc + p.repeatedSameSession, 0);
  const firstActivityAt = Number.isFinite(minAt) ? minAt : null;
  const lastActivityAt = Number.isFinite(maxAt) ? maxAt : null;

  const observations: EvidenceObservations = {
    eventCounts,
    eventsUsedCount: eventsUsed,
    uniqueSessions: sessionsSeen.size,
    uniqueProducts: productsSeen.size,
    productViewPairs: pairs,
    preferredProduct,
    repeatedSameSession,
    cartValue: pricedFound ? priced.value : null,
    cartItems: null,
    signalDistinctPairs: signalPairs.size,
    unattributedProductViews,
    firstActivityAt,
    lastActivityAt,
    hasRecentPurchase: purchaseCount.n > 0,
    identity: opts.identity ?? "unknown",
  };

  const inference: EvidenceInference = {
    repeatedProductInterest: (preferredProduct?.sessions ?? 0) >= 2 || (preferredProduct?.repeatedSameSession ?? 0) >= 1,
    multiSessionActivity: sessionsSeen.size > 1,
    addToCartReached: eventCounts.add_to_cart > 0,
    checkoutReached: eventCounts.checkout_start > 0,
    paymentReached: eventCounts.payment_started > 0,
    purchasedRecently: purchaseCount.n > 0,
  };

  const coverage: EvidenceCoverage = {
    windowHours,
    windowStartMs: windowStart,
    windowEndMs: asOf,
    eventsRead: rows.length,
    eventsUsed,
    dropped,
    sourceError,
  };

  return { observations, inference, coverage };
}

function finite(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function recencyHrs(e: RecoveryEvidence): number {
  if (e.observations.lastActivityAt !== null) return Math.max(0, (e.coverage.windowEndMs - e.observations.lastActivityAt) / HOUR_MS);
  return e.coverage.windowHours;
}

function ageHrs(e: RecoveryEvidence): number {
  if (e.observations.firstActivityAt !== null) return Math.max(0, (e.coverage.windowEndMs - e.observations.firstActivityAt) / HOUR_MS);
  return e.coverage.windowHours;
}

/**
 * ترجمة الأدلة إلى IntentEvidence دونما أي تضخيم:
 *  - repeatedViews = جلسات ما بعد الأولى للمنتج المفضّل + إصرار داخل جلسة
 *    (مجموع، لكن أصل العدّ مميّز: أزواج منتج×جلسة، لا أحداث خام).
 *  - cartItems = null دائمًا (analytics لا يعرف أصناف السلة).
 *  - لا نشاط ⇒ recency = عرض النافذة (مقدار مُحصَّل لا لانهاية).
 */
export function toIntentEvidence(e: RecoveryEvidence, ctx: IntelligenceContext): IntentEvidence {
  const p = e.observations.preferredProduct;
  const repeatedViews = Math.max(0, (p?.sessions ?? 0) - 1) + (p?.repeatedSameSession ?? 0);
  return {
    caseType: ctx.caseType,
    repeatedViews,
    sessions: e.observations.uniqueSessions,
    cartValue: finite(e.observations.cartValue) ? e.observations.cartValue : finite(ctx.caseCartValue ?? null) ? (ctx.caseCartValue as number) : null,
    cartItems: null,
    recencyHours: recencyHrs(e),
    ageHours: ageHrs(e),
  };
}

/**
 * ترجمة الأدلة إلى ConfidenceEvidence:
 *  - الهوية من سياق الحالة لا من analytics (لا PII مخترع).
 *  - signalCount = أزواج (إشارة × جلسة) مميّزة — لم تعدّ إجراءات متكررة.
 *  - hasProduct: منتج الحالة معلوم (من السياق) أو منتجات مرصودة.
 *  - hasCartValue: قيمة سلة موثقة.
 */
export function toConfidenceEvidence(e: RecoveryEvidence, ctx: IntelligenceContext): ConfidenceEvidence {
  return {
    identified: e.observations.identity === "logged_in",
    signalCount: e.observations.signalDistinctPairs,
    hasProduct: e.observations.uniqueProducts > 0 || Boolean(ctx.preferredProductId),
    hasCartValue: finite(e.observations.cartValue) || finite(ctx.caseCartValue ?? null),
    sessions: e.observations.uniqueSessions,
    recencyHours: recencyHrs(e),
  };
}

/**
 * تكامل واضح (بلا محرك قرار): analytic_events ← أدلة ← نية وثقة.
 * دالة نقية على صفوف واردة — للاختبار والتغذية المحلية.
 */
export function evaluateRecoveryIntelligence(rows: AnalyticsEventRow[], ctx: IntelligenceContext, cfg: RecoveryConfig, opts: EvidenceBuildOptions = {}): IntelligenceEvaluation {
  const evidence = buildRecoveryEvidence(rows, { ...opts, identity: ctx.identity, preferredProductId: ctx.preferredProductId }, cfg);
  const intentEvidence = toIntentEvidence(evidence, ctx);
  const confidenceEvidence = toConfidenceEvidence(evidence, ctx);
  return {
    evidence,
    intent: computeIntent(intentEvidence, cfg),
    confidence: computeConfidence(confidenceEvidence, cfg),
    intentEvidence,
    confidenceEvidence,
  };
}

/**
 * القراءة الفعلية (service role، SELECT فقط) من analytics_events لزائر واحد
 * داخل نافذة زمنية، ثم بناء الأدلة والتقييم. خطأ القراءة لا يُرمى أبدًا:
 * fail-safe يرجع أدلة فارغة مع المصدر في coverage (لا تُكسر المسارات).
 */
export async function collectRecoveryEvidence(visitorId: string, opts: EvidenceSourceOptions = {}, cfg: RecoveryConfig): Promise<RecoveryEvidence> {
  const asOf = opts.asOf ?? Date.now();
  const windowHours = opts.windowHours ?? defaultEvidenceWindowHours(cfg);
  const createClient = opts.createClient ?? createAdminClient;
  const client = createClient();
  const since = new Date(asOf - Math.max(1, windowHours) * HOUR_MS).toISOString();
  const { data, error } = await client
    .from("analytics_events")
    .select("id, visitor_id, session_id, event_type, page_path, product_id, product_slug, referrer, device_type, metadata, created_at")
    .eq("visitor_id", visitorId)
    .gte("created_at", since)
    .order("created_at", { ascending: true });

  if (error) {
    return buildRecoveryEvidence([], { ...opts, asOf, windowHours }, cfg, `analytics read failed: ${error.message}`);
  }
  return buildRecoveryEvidence(data ?? [], { ...opts, asOf, windowHours }, cfg);
}

/** تقييم كامل من قاعدة البيانات (قراءة فقط). */
export async function evaluateRecoveryIntelligenceFromDb(visitorId: string, ctx: IntelligenceContext, cfg: RecoveryConfig, opts: EvidenceSourceOptions = {}): Promise<IntelligenceEvaluation> {
  const evidence = await collectRecoveryEvidence(visitorId, { ...opts, identity: ctx.identity, preferredProductId: ctx.preferredProductId }, cfg);
  const intentEvidence = toIntentEvidence(evidence, ctx);
  const confidenceEvidence = toConfidenceEvidence(evidence, ctx);
  return {
    evidence,
    intent: computeIntent(intentEvidence, cfg),
    confidence: computeConfidence(confidenceEvidence, cfg),
    intentEvidence,
    confidenceEvidence,
  };
}

/** أسطر عربية للعرض: ماذا رُصد، ماذا استُنتج، ولماذا هما هكذا. */
export function describeRecoveryEvidence(e: RecoveryEvidence): string[] {
  const o = e.observations;
  const out: string[] = [];
  const counts = SUPPORTED_ANALYTICS_TYPES.filter((t) => (o.eventCounts[t] ?? 0) > 0).map((t) => `${o.eventCounts[t]}× ${t}`);
  if (counts.length) out.push(`أحداث خام: ${counts.join("، ")}`);
  if (o.uniqueSessions > 0) out.push(`${o.uniqueSessions} جلسات مميّزة`);
  if (o.preferredProduct) out.push(`${o.preferredProduct.views} معاينة للمنتج ${o.preferredProduct.productId} في ${o.preferredProduct.sessions} جلسات`);
  if (o.preferredProduct?.repeatedSameSession) out.push(`إصرار داخل جلسة (${o.preferredProduct.repeatedSameSession})`);
  if (finite(o.cartValue)) out.push(`قيمة السلة موثقة (${o.cartValue})`);
  if (o.hasRecentPurchase) out.push("شراء مكتمل حديثًا");
  if (o.lastActivityAt !== null) out.push(`آخر نشاط قبل ${Math.round(recencyHrs(e) * 60)} دقيقة`);
  if (o.identity === "logged_in") out.push("عميل معرّف");
  else out.push(o.identity === "anonymous" ? "زائر مجهول" : "هوية غير معلومة");
  if (e.inference.repeatedProductInterest) out.push("استنتاج: اهتمام متكرر بالمنتج");
  if (e.inference.checkoutReached) out.push("استنتاج: وصول إلى الإتمام");
  if (o.eventCounts.purchase > 0) out.push("استنتاج: شراء مرصود");
  const total = e.coverage.dropped.malformed + e.coverage.dropped.nonNumericTime + e.coverage.dropped.future + e.coverage.dropped.outsideWindow + e.coverage.dropped.unsupportedType + e.coverage.dropped.exactDuplicates;
  if (total > 0) out.push(`استُبعد ${total} أحداث (خارج النافذة/مكررة/غير مدعومة)`);
  return out;
}
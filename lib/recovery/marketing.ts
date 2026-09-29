/**
 * G2 — طبقة التسويق: قرار المحرك ← توصية تسويقية قابلة للتنفيذ.
 *
 * السلسلة (بلا أي إرسال/كتابة):
 *   Decision (محرك القرار)
 *     → Marketing Strategy
 *     → Template Selection (بالعربية، مع Variants)
 *     → Rendered Message (تصيير آمن عبر variables.ts)
 *     → Action Recommendation
 *
 * حدود صارمة (لا تُكسر):
 *  - لا إرسال WhatsApp، لا insert notification، لا إنشاء delivery،
 *    لا تحديث حالة، لا إنشاء كوبون — هذه الطبقة «تقرر ما يُرسل» فقط.
 *  - لا اختراع بيانات: لا scarcity/social proof/urgency/خصم/كوبون/شعبية
 *    إلا ببيان حقيقي. بلا بيانات ⇒ الادعاء ممنوع والقالب محجوب.
 *  - المتغيرات فقط من قاموس variables.ts ({{discount.*}} داخلي لا يصل للعميل؛
 *    ولا يوجد متغير code في النظام أصلًا).
 *  - fail-safe: قالب مفقود/غير مفعّل/معطوب/CTA ناقص/بيانات ناقصة
 *    ⇒ لا تُبنى رسالة ولا إرسال (بلا fallback تسويقي عشوائي).
 *  - حتمية: نفس المدخلات ⇒ نفس التوصية ونفس صياغة variant.
 *
 * إعادة استخدام البنية الحالية:
 *  - validateTemplate / TEMPLATE_KEY_RE / TEMPLATE_BODY_MAX (template-control).
 *  - renderTemplate + قاموس RECOVERY_VARIABLES (variables.ts).
 *  - RecoveryStage / selectStageAt (stages.ts).
 *  - RecoveryDecision / DecisionCaseContext (decision.ts).
 */

import type { RecoveryStage } from "./stages";
import type { RecoveryDecision } from "./decision";
import type { RecoveryEvidence } from "./evidence";
import type { IntentResult } from "./intent";
import type { ConfidenceResult } from "./confidence";
import { renderTemplate, validateTemplate } from "./variables";
import { TEMPLATE_BODY_MAX, TEMPLATE_KEY_RE } from "./template-control";
import type { RecoveryCouponView } from "./types";

/** استراتيجيات التسويق — مغلقة على ما يحتاجه النظام الآن فقط. */
export const MARKETING_STRATEGIES = [
  "NO_ACTION",
  "LIGHT_REMINDER",
  "PRODUCT_INTEREST",
  "CART_RECOVERY",
  "CHECKOUT_RECOVERY",
  "HIGH_INTENT_MARKETING",
  "INCENTIVE_CANDIDATE",
  "CUSTOMER_ASSISTANCE",
] as const;
export type MarketingStrategy = (typeof MARKETING_STRATEGIES)[number];

/** نوع الرسالة — للتصنيف والفلترة لا للتخزين. */
export const MESSAGE_TYPES = ["none", "reminder", "product", "checkout", "marketing", "incentive", "assistance"] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

/** أزرار/روابط الدعوة للفعل — ثابتة وقابلة للعرض. */
export const CTAS = ["NONE", "VISIT_CART", "VIEW_PRODUCT", "COMPLETE_CHECKOUT", "CONTACT_SUPPORT"] as const;
export type Cta = (typeof CTAS)[number];

export const CTA_LABELS: Record<Cta, string> = {
  NONE: "",
  VISIT_CART: "العودة للسلة",
  VIEW_PRODUCT: "عرض المنتج",
  COMPLETE_CHECKOUT: "إكمال الطلب",
  CONTACT_SUPPORT: "تواصل معنا",
};

/** وضع الحافز — التوصية لا تنشئ كوبونًا أبدًا. */
export const INCENTIVE_MODES = ["NONE", "RECOMMENDED", "REQUIRED_BEFORE_SEND"] as const;
export type IncentiveMode = (typeof INCENTIVE_MODES)[number];

/** كل CTA تلزم أن يشير النص إلى رابط المتغير المقابل له. */
const CTA_LINK_TOKEN: Record<Exclude<Cta, "NONE">, string> = {
  VISIT_CART: "links.cart",
  VIEW_PRODUCT: "links.product",
  COMPLETE_CHECKOUT: "links.checkout",
  CONTACT_SUPPORT: "links.support",
};

/**
 * ادعاءات بلا بيانات ممنوعة من نصوص القوالب نهائيًا.
 *
 * G6-C: ادعاء الخصم وحده أصبح قابلًا للإثبات، فلا يبقى محظورًا بلا شرط —
 * يُمنع فقط ما لم تكن خلفه قسيمة حقيقية معروضة في نفس الرسالة. لذلك
 * `discountClaim` عاملة منفصلة تُستثنى فقط عند `allowDiscountClaim`، وبذلك
 * تبقى «شحن مجاني» و«آخر فرصة» و«الأكثر مبيعًا» ممنوعة دائمًا.
 */
const UNPROVEN_CLAIM_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "كمية محدودة", re: /كمية\s*محدودة/ },
  { label: "ينفد", re: /(ينفد|يُباع\s*سريعًا|لفترة\s*محدودة)/ },
  { label: "آخر فرصة", re: /آخر\s*فرصة/ },
  { label: "الطلب كبير / الأكثر مبيعًا", re: /(طلب\s*كبير|الأكثر\s*مبيع)/ },
  { label: "شحن مجاني", re: /شحن\s*مجاني/ },
];

/** ادعاءات الخصم — تُسمح فقط بوجود قسيمة حقيقية تُعرض في الرسالة نفسها. */
const DISCOUNT_CLAIM_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "خصم", re: /خصم/ },
  { label: "كوبون", re: /كوبون/ },
  { label: "قيمة مخفضة", re: /(سعر\s*مخفض|قيمة\s*مخفضة)/ },
];

/**
 * أي ادعاء شائع يتطابق مع النص ⇒ قائمة بالملصقات (فارغة = آمن).
 * الافتراضي: كل شيء ممنوع، بما فيه الخصم. `allowDiscountClaim: true` وحده
 * يرفع الحظر عن ادعاءات الخصم — ويمرّره المتصل فقط بعد توفّر قسيمة حقيقية
 * معروضة في الرسالة نفسها، فتبقى القوالب غير الحافزية محظورة كما هي.
 */
export function unprovenClaims(
  body: string,
  options: { allowDiscountClaim?: boolean } = {}
): string[] {
  const text = String(body ?? "");
  const out: string[] = [];
  const discountProven = options.allowDiscountClaim === true;
  if (!discountProven) {
    for (const p of DISCOUNT_CLAIM_PATTERNS) if (p.re.test(text)) out.push(p.label);
  }
  for (const p of UNPROVEN_CLAIM_PATTERNS) if (p.re.test(text)) out.push(p.label);
  return out;
}

/** قالب اختياري من الكتالوج — يُختار بالمفتاح لا بالنص. */
export type MarketingTemplate = {
  key: string;
  nameAr: string;
  strategy: MarketingStrategy;
  messageType: MessageType;
  cta: Cta;
  /** غير مفعّل ⇒ يُمنع الاختيار نهائيًا (الافتراضي: مفعّل). */
  isActive?: boolean;
  /** متطلبات بيانات قبل الاختيار (حيوي): لا قالب منتج بلا منتج، ولا سلة بلا سلة. */
  requires: { product?: boolean; cart?: boolean };
  /** رموز يجب أن تظهر في نص كل variant (من قاموس variables.ts). */
  tokenRequirements: string[];
  /** صيغ عربية متنوعة — لا تُرسل نفس الصياغة دائمًا. */
  variants: string[];
};

/**
 * الكتالوج المضمّن — نبرة سعودية، قصيرة، شخصية، بلا ادعاءات غير مثبتة.
 * كل body يُمرَّر عبر validateTemplate عند الفحص (marketingCatalogIntegrity).
 */
export const MARKETING_TEMPLATES: MarketingTemplate[] = [
  {
    key: "light_reminder",
    nameAr: "تذكير خفيف",
    strategy: "LIGHT_REMINDER",
    messageType: "reminder",
    cta: "VISIT_CART",
    requires: {},
    tokenRequirements: ["links.cart"],
    variants: [
      "مرحبًا {{customer.name}} 👋\nلاحظنا زيارة لك لمتجرنا مؤخرًا، ونحب أن نسهّل عليك.\nتقدر ترجع للتسوق في أي وقت:\n{{links.cart}}",
      "أهلًا {{customer.name}}،\nإن كنت ما زلت تتصفح، أتمنى تلاقي شيئًا يعجبك.\nالعودة للتسوق:\n{{links.cart}}",
    ],
  },
  {
    key: "repeated_interest",
    nameAr: "اهتمام متكرر بالمنتج",
    strategy: "PRODUCT_INTEREST",
    messageType: "product",
    cta: "VIEW_PRODUCT",
    requires: { product: true },
    tokenRequirements: ["product.name", "links.product"],
    variants: [
      "مرحبًا {{customer.name}} 👋\nلاحظنا اهتمامك بـ {{product.name}}.\nإذا كنت ما زلت مهتمًا، تقدر ترجع للمنتج مباشرة من هنا:\n{{links.product}}",
      "لاحظنا مؤخرًا اهتمامًا منك بمنتج «{{product.name}}».\nإذا أردت مراجعته مجددًا، تفضل من هنا:\n{{links.product}}",
    ],
  },
  {
    key: "cart_recovery",
    nameAr: "استرجاع السلة",
    strategy: "CART_RECOVERY",
    messageType: "reminder",
    cta: "VISIT_CART",
    requires: { cart: true },
    tokenRequirements: ["links.cart"],
    variants: [
      "{{customer.name}}، لا تزال السلة التي بدأت بتجهيزها في انتظارك 🛒\nإن أردت المتابعة، يمكنك الرجوع إليها من هنا:\n{{links.cart}}",
      "مرحبًا {{customer.name}} 👋\nسلتك ما زالت محفوظة معنا، وإتمامها خطوة بسيطة تُنهي طلبك.\nالعودة للسلة:\n{{links.cart}}",
    ],
  },
  {
    key: "checkout_completion",
    nameAr: "إكمال الإتمام",
    strategy: "CHECKOUT_RECOVERY",
    messageType: "checkout",
    cta: "COMPLETE_CHECKOUT",
    requires: { cart: true },
    tokenRequirements: ["links.checkout"],
    variants: [
      "{{customer.name}}، بقيت لك خطوة بسيطة لإكمال طلبك 🛍️\nطلبك ما زال محفوظًا ويمكنك إكماله من هنا:\n{{links.checkout}}",
      "{{customer.name}}، خطوتك الأخيرة تفصلك عن إتمام طلبك.\nيمكنك متابعة الدفع من هنا:\n{{links.checkout}}",
    ],
  },
  {
    key: "high_intent",
    nameAr: "نية عالية",
    strategy: "HIGH_INTENT_MARKETING",
    messageType: "marketing",
    cta: "COMPLETE_CHECKOUT",
    requires: {},
    tokenRequirements: ["links.checkout"],
    variants: [
      "{{customer.name}}، لمسنا اهتمامًا حقيقيًا منك مؤخرًا، ونحب أن نكون بين يديك.\nلإتمام طلبك أو الاختيارات، تفضل من هنا:\n{{links.checkout}}",
      "أهلًا {{customer.name}} 🙌\nتفاعلك الأخير معنا لفت انتباهنا، ونقدّر ذلك فعلًا.\nإن كنت بصدد إتمام طلبك، سنكون في خدمتك من هنا:\n{{links.checkout}}",
    ],
  },
  {
    key: "customer_assistance",
    nameAr: "مساعدة العميل",
    strategy: "CUSTOMER_ASSISTANCE",
    messageType: "assistance",
    cta: "CONTACT_SUPPORT",
    requires: {},
    tokenRequirements: ["links.support"],
    variants: [
      "{{customer.name}}، لو واجهت أي خطوة صعبة في التسوق أو إتمام الطلب، فريقنا جاهز يساعدك مباشرة:\n{{links.support}}",
      "أهلًا {{customer.name}}، نحرص أن تكون تجربتك مريحة من البداية.\nإن احتجت مساعدة في طلبك، تواصل معنا:\n{{links.support}}",
    ],
  },
  {
    key: "incentive_candidate",
    nameAr: "حافز بكود قسيمة (لا يُرسل بلا كود ظاهر)",
    strategy: "INCENTIVE_CANDIDATE",
    messageType: "incentive",
    cta: "COMPLETE_CHECKOUT",
    requires: { cart: true },
    // G6-C: `coupon.code` متطلّب صريح. الحارس يمنع أي رسالة حافز لا يظهر
    // فيها الكود، فلا معنى لقالب يحفظ على «نُرسل الحافز بلا كود».
    tokenRequirements: ["links.checkout", "coupon.code"],
    variants: [
      // الصيغة الوحيدة المعتمدة: يذكر الاسترداد والكود، ولا يذكر نسبة ولا
      // مبلغ (النسبة تُقصّ على السلة، والقيمة الفعلية تُحسب عند الطلب).
      "{{customer.name}}، لديك استرداد بانتظارك لإتمام طلبك.\nاستخدم الكود {{coupon.code}} عند الطلب، وهو صالح حتى {{coupon.expires_at}}.\nأكمل طلبك من هنا:\n{{links.checkout}}",
    ],
  },
];

/** فحص سلامة قالب واحد من الكتالوج — لا يُبنى منه شيء إلا إذا سَلِم بالكامل. */
export function templateIntegrity(t: MarketingTemplate): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!TEMPLATE_KEY_RE.test(String(t.key ?? ""))) errors.push(`مفتاح القالب غير صالح: ${t.key}`);
  if (!t.nameAr?.trim()) errors.push("اسم القالب فارغ.");
  if (!Array.isArray(t.variants) || t.variants.length === 0) errors.push("لا توجد صيغ (variants).");

  for (let i = 0; i < (t.variants ?? []).length; i++) {
    const body = String(t.variants[i] ?? "");
    if (!body.trim()) {
      errors.push(`الصيغة ${i}: نص فارغ.`);
      continue;
    }
    if (body.length > TEMPLATE_BODY_MAX) errors.push(`الصيغة ${i}: أطول من ${TEMPLATE_BODY_MAX} حرفًا.`);

    const v = validateTemplate(body);
    if (v.unknown.length) errors.push(`الصيغة ${i}: متغيرات غير معروفة (${v.unknown.join("، ")}).`);
    if (v.blockedInternal.length) errors.push(`الصيغة ${i}: متغيرات خصم داخلية ممنوعة في مسار العميل (${v.blockedInternal.join("، ")}).`);

    const claims = unprovenClaims(body);
    if (claims.length) errors.push(`الصيغة ${i}: ادعاءات بلا بيانات (${claims.join("، ")}).`);

    for (const token of t.tokenRequirements ?? []) {
      if (!body.includes(`{{${token}}}`)) errors.push(`الصيغة ${i}: لا تحوي المتغير المطلوب {{${token}}}.`);
    }
    if (t.cta && t.cta !== "NONE") {
      const linkToken = CTA_LINK_TOKEN[t.cta];
      if (!body.includes(`{{${linkToken}}}`)) errors.push(`الصيغة ${i}: CTA «${t.cta}» يتطلب {{${linkToken}}}.`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/** فحص الكتالوج كاملًا — يُستخدم في الاختبارات وفي المسار قبل أي اختيار. */
export function marketingCatalogIntegrity(templates: MarketingTemplate[] = MARKETING_TEMPLATES): {
  ok: boolean;
  failures: { key: string; errors: string[] }[];
} {
  const failures = [];
  for (const t of templates) {
    const r = templateIntegrity(t);
    if (!r.ok) failures.push({ key: t.key, errors: r.errors });
  }
  return { ok: failures.length === 0, failures };
}

// ---------------------------------------------------------------
// التوصية التسويقية
// ---------------------------------------------------------------

export type MarketingInput = {
  decision: RecoveryDecision;
  evidence: RecoveryEvidence;
  intent: IntentResult;
  confidence: ConfidenceResult;
  stage: RecoveryStage | null;
  /** الكتالوج — يظهر قيم الكتالوج المضمّن؛ يتجاوز للاختبار/التخصيص. */
  templates?: MarketingTemplate[];
  /** قيم المتغيرات الفعلية (عادة من buildRecoveryVariables) — تُصير عبر variables.ts. */
  values?: Record<string, string>;
  /**
   * G6-C: القسيمة المعروضة (منشأة في الخادم، لا مُدخلة من العميل).
   * النوع كامل عمدًا: شكل ناقص مرفوض، فلا تصل قسيمة بلا قيمة محسوبة
   * ولا تاريخ انتهاء إلى التصيير أو إلى الحارس.
   */
  coupon?: RecoveryCouponView | null;
  /**
   * G6-D: سبب فشل إنشاء القسيمة من البوابة (incentive.ts). null = لم تُنشأ
   * محاولة أو نجحت. يُستخدم فقط لتمييز «فشل الإنشاء» عن «لا قسيمة متاحة»
   * في سبب الحجب — لا يغيّر شرط الإرسال (كلاهما يمنع).
   */
  couponFailure?: string | null;
};

/**
 * التوصية التسويقية — لا تُنفَّذ هنا: لا إرسال ولا إنشاء ولا كتابة.
 * تُقرر فقط ما يجب إرساله (إن وجب) ونصه وصياغته وCTA.
 */
export type MarketingRecommendation = {
  strategy: MarketingStrategy;
  shouldSend: boolean;
  templateKey: string | null;
  messageType: MessageType;
  /** زر الدعوة للفعل — null إن لم تُرسَل رسالة. */
  cta: Cta | null;
  /** تفسير عربي سطر واحد. */
  reason: string;
  /** تفسير أصلي: القرار ← الاستراتيجية ← القالب ← سبب الحجب إن وُجد. */
  reasons: string[];
  incentiveMode: IncentiveMode;
  /** موعد التقييم/الإجراء التالي كما حدده محرك القرار. */
  nextActionAt: number | null;
  /** حاجز fail-safe (بنية: البيك منفصل معني بالعرض) — null = القرار سليم. */
  blockedReason: string | null;
  /** نص الرسالة المُصيَّر (مسار العميل) — null إن لم تُرسَل. */
  body: string | null;
  /** فهرس الصيغة المنتقاة (حتميًا) — null إن لم تُرسَل. */
  variantIndex: number | null;
  title: string;
};

/** بذرة حتمية لاختيار صيغة متنوعة: نفس المدخلات ⇒ نفس الصيغة. */
function variantSeed(...parts: (string | number | null | undefined)[]): number {
  const s = parts.map((p) => String(p ?? "")).join("|");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** المتغيرات المتوافرة المؤكدة (لا البدائل) — لتقرير «هل توجد البيانات». */
function valuePresent(values: Record<string, string>, name: string): boolean {
  const v = values[name];
  return v !== undefined && v !== null && String(v).trim() !== "";
}

function productKnown(e: RecoveryEvidence, values: Record<string, string>): boolean {
  return e.observations.preferredProduct !== null || valuePresent(values, "product.slug") || valuePresent(values, "product.name");
}

function cartKnown(e: RecoveryEvidence, values: Record<string, string>): boolean {
  return (typeof e.observations.cartValue === "number" && Number.isFinite(e.observations.cartValue)) || valuePresent(values, "cart.value");
}

function noSend(
  strategy: MarketingStrategy,
  decision: RecoveryDecision,
  reason: string,
  blockedReason: string,
  reasons: string[],
): MarketingRecommendation {
  return {
    strategy,
    shouldSend: false,
    templateKey: null,
    messageType: "none",
    cta: null,
    reason,
    reasons,
    incentiveMode: "NONE",
    nextActionAt: decision.nextActionAt,
    blockedReason,
    body: null,
    variantIndex: null,
    title: "",
  };
}

/** القرار ← الاستراتيجية والمفتاح البدائي (القرار هو المرجع، لا المرحلة وحدها). */
export function selectStrategyFromDecision(decision: RecoveryDecision): { strategy: MarketingStrategy; templateKey: string } | null {
  switch (decision.decision) {
    case "SEND_MESSAGE":
      switch (decision.customerState) {
        case "CHECKOUT_STARTED":
        case "PAYMENT_INTENT":
          return { strategy: "CHECKOUT_RECOVERY", templateKey: "checkout_completion" };
        case "CART_CREATED":
          return { strategy: "CART_RECOVERY", templateKey: "cart_recovery" };
        case "REPEATED_INTEREST":
        case "INTERESTED":
          return { strategy: "PRODUCT_INTEREST", templateKey: "repeated_interest" };
        case "BROWSING":
        default:
          return { strategy: "LIGHT_REMINDER", templateKey: "light_reminder" };
      }
    case "SEND_PRODUCT_MESSAGE":
      return { strategy: "PRODUCT_INTEREST", templateKey: "repeated_interest" };
    case "SEND_MARKETING_MESSAGE":
      return { strategy: "HIGH_INTENT_MARKETING", templateKey: "high_intent" };
    default:
      return null;
  }
}

/**
 * التوصية المركزيّة — نقية وحتمية.
 * مسار الحافز: لا يُرسل أي حافز بلا كوبون فعلي؛ ولا يُذكر مبلغ/نسبة/كود أبدًا في هذه المرحلة.
 */
export function recommendMarketingAction(input: MarketingInput): MarketingRecommendation {
  const { decision: d, evidence: e, intent, confidence: conf, stage } = input;
  const templates = input.templates ?? MARKETING_TEMPLATES;
  const values = input.values ?? {};
  const coupon = input.coupon ?? null;
  const couponFailure = input.couponFailure ?? null;
  const baseReasons = [
    `القرار: ${d.decision} (${d.customerState})`,
    `النية: ${intent.level} ${intent.score}/100 · الثقة: ${conf.level} ${conf.score}/100`,
    stage ? `المرحلة: ${stage.nameAr}` : "المرحلة: غير محددة",
  ];

  // ============ 1) لا إرسال عند STOP / NO_ACTION / WAIT ============
  if (d.decision === "STOP" || d.decision === "NO_ACTION" || d.decision === "WAIT") {
    const struck =
      d.decision === "STOP"
        ? d.customerState === "PURCHASED"
          ? "عميل اشترى — لا يُرسَل عنه أي شيء (قاعدة منع رسائل ما بعد الشراء)"
          : "الحالة مغلقة/ممنوعة — لا إرسال"
        : d.decision === "WAIT"
          ? "القرار انتظار (مبكر/cooldown/ثقة منخفضة/مجهول) — لا إرسال الآن"
          : "القرار بلا إجراء — لا إرسال؛ لا يُخترع تسويق بلا داعٍ";
    return noSend(
      "NO_ACTION",
      d,
      struck,
      d.decision === "STOP" ? (d.customerState === "PURCHASED" ? "purchased" : "decision_stop") : d.decision === "WAIT" ? "decision_wait" : "decision_no_action",
      baseReasons,
    );
  }

  // ============ 2) الحافز: توصية لا إنشاء ============
  if (d.decision === "RECOMMEND_INCENTIVE") {
    if (!coupon) {
      return {
        strategy: "INCENTIVE_CANDIDATE",
        shouldSend: false,
        templateKey: null,
        messageType: "marketing",
        cta: null,
        reason: "Decision engine recommends incentive but no real coupon is available.",
        reasons: [...baseReasons, "محرك القرار يرشّح الحافز لكن لا يوجد كوبون فعلي — لا تُذكر نسبة/مبلغ/كود ولا يُرسَل شيء."],
        incentiveMode: "REQUIRED_BEFORE_SEND",
        nextActionAt: d.nextActionAt,
        blockedReason: couponFailure ? "incentive_unavailable" : "incentive_required_before_send",
        body: null,
        variantIndex: null,
        title: "",
      };
    }
    // كوبون فعلي مُمرَّر (خارج هذه الطبقة) — يُختار قالب الحافز ويُفحص ويُصيَّر، دون إنشاء.
    return sendWithTemplate("INCENTIVE_CANDIDATE", "incentive_candidate", d, conf, values, templates, baseReasons, {
      incentiveMode: "RECOMMENDED",
      coupon,
    });
  }

  // ============ 3) قرارات التواصل (SEND_*) ============
  const mapped = selectStrategyFromDecision(d);
  if (!mapped) {
    return noSend("NO_ACTION", d, "قرار غير متوقع — لا إرسال", "decision_unsupported", baseReasons);
  }
  const { strategy, templateKey } = mapped;

  // حارس ثقة: ثقة منخفضة لا تسمح بالتسويق القوي (دفاع ثانٍ خلف محرك القرار).
  if (conf.level === "LOW") {
    return noSend(strategy, d, "ثقة منخفضة — لا تسويق قوي حتى لو وصل القرار", "low_confidence", [...baseReasons, "البيانات الناقصة/المتقادمة تُضعف سلامة إرسال رسالة تسويقية"]);
  }

  // حارس بيانات: منتج بدون منتج، سلة بدون سلة، ولا تُخفى الادعاءات.
  const template = templates.find((t) => t.key === templateKey);
  if (!template) {
    return noSend(strategy, d, `لا يوجد قالب مناسب («${templateKey}») — لا إرسال (لا fallback عشوائي)`, "template_missing", [...baseReasons, `القالب «${templateKey}» غير موجود في الكتالوج`]);
  }
  if (template.isActive === false) {
    return noSend(strategy, d, `القالب «${template.nameAr}» غير مفعّل — لا إرسال`, "template_inactive", [...baseReasons, `القالب «${template.nameAr}» غير نشط`]);
  }
  const integrity = templateIntegrity(template);
  if (!integrity.ok) {
    return noSend(strategy, d, `القالب «${template.nameAr}» معطوب — لا إرسال`, "template_invalid", [...baseReasons, ...integrity.errors]);
  }
  if (template.requires.product && !productKnown(e, values)) {
    return noSend(strategy, d, "رسالة منتج تتطلب منتجًا معروفًا — لا إرسال بلا منتج", "product_missing", [...baseReasons, "لا منتج موثّق في الأدلة ولا في القيم"]);
  }
  if (template.requires.cart && !cartKnown(e, values)) {
    // سلة غير موثقة عند إتمام/سلة: لا ندّعي «سلتك محفوظة» — نتحول للمساعدة الموثقة إن أمكن، وإلا حجب.
    if (valuePresent(values, "links.support") && (strategy === "CHECKOUT_RECOVERY" || strategy === "CART_RECOVERY")) {
      return sendWithTemplate("CUSTOMER_ASSISTANCE", "customer_assistance", d, conf, values, templates, [...baseReasons, "لا بيانات سلة موثقة — لا ادعاء «محفوظة»، نعرض المساعدة الحقيقية"]);
    }
    return noSend(strategy, d, "رسالة سلة/إتمام تتطلب سلة موثقة — لا إرسال بلا بيانات", "cart_data_missing", [...baseReasons, "قيمة السلة غير موثقة في الأدلة ولا في القيم"]);
  }
  return sendWithTemplate(strategy, templateKey, d, conf, values, templates, baseReasons);
}

function sendWithTemplate(
  strategy: MarketingStrategy,
  templateKey: string,
  d: RecoveryDecision,
  conf: ConfidenceResult,
  values: Record<string, string>,
  templates: MarketingTemplate[],
  reasons: string[],
  extra: { incentiveMode?: IncentiveMode; coupon?: RecoveryCouponView | null } = {},
): MarketingRecommendation {
  const template = templates.find((t) => t.key === templateKey);
  if (!template) {
    return noSend(strategy, d, `لا يوجد قالب («${templateKey}») — لا إرسال`, "template_missing", reasons);
  }
  if (template.isActive === false) {
    return noSend(strategy, d, `القالب «${template.nameAr}» غير مفعّل — لا إرسال`, "template_inactive", reasons);
  }
  const integrity = templateIntegrity(template);
  if (!integrity.ok) {
    return noSend(strategy, d, `القالب «${template.nameAr}» معطوب — لا إرسال`, "template_invalid", [...reasons, ...integrity.errors]);
  }
  if (template.cta === "NONE") {
    return noSend(strategy, d, `القالب «${template.nameAr}» بلا CTA والاستراتيجية تتطلب دعوة للفعل — لا إرسال`, "cta_missing", [...reasons, "القالب بلا زر دعوة والاستراتيجية تتطلب CTA"]);
  }
  if ((strategy === "HIGH_INTENT_MARKETING" || strategy === "CHECKOUT_RECOVERY" || strategy === "PRODUCT_INTEREST") && conf.level === "LOW") {
    return noSend(strategy, d, "ثقة منخفضة — لا تسويق قوي", "low_confidence", reasons);
  }

  const index = variantSeed(strategy, template.key, d.customerState, d.decision, d.recommendedStage ?? "stage", d.intentLevel, d.confidenceLevel);
  const body = template.variants[index % template.variants.length];
  // G6-C: القسيمة تُمرَّر للتصيير هنا أيضًا، وإلا صار `{{coupon.*}}` فارغًا في
  // التوصية بينما `dispatch-message` يعرضه مملوءًا — نسختان مختلفتان لنفس
  // الرسالة. الحارس وحده يقرّر الإرسال، لكن التوصية يجب أن تُطابق التنفيذ.
  const rendered = renderTemplate(body, values, { coupon: extra.coupon ?? null });
  if (rendered.unknown.length) {
    return noSend(strategy, d, `متغيرات غير معروفة عند التصيير — لا إرسال`, "render_unknown", [...reasons, ...rendered.unknown]);
  }
  const text = rendered.text.trim();
  if (!text) {
    return noSend(strategy, d, "الرسالة النهائية فارغة بعد التصيير — لا إرسال", "empty_message", reasons);
  }

  return {
    strategy,
    shouldSend: true,
    templateKey: template.key,
    messageType: template.messageType,
    cta: template.cta as Cta,
    reason: `${template.nameAr} — ${CTA_LABELS[template.cta]} (صيغة ${index % template.variants.length + 1}/${template.variants.length})`,
    reasons,
    incentiveMode: extra.incentiveMode ?? "NONE",
    nextActionAt: d.nextActionAt,
    blockedReason: null,
    body: text,
    variantIndex: index % template.variants.length,
    title: template.nameAr,
  };
}
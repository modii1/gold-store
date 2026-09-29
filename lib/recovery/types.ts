export type CaseType = "ADD_TO_CART" | "CHECKOUT_STARTED" | "PAYMENT_STARTED" | "PURCHASED";

export type CaseStatus =
  | "OPEN"
  | "ELIGIBLE"
  | "SCHEDULED"
  | "CONTACTED"
  | "PURCHASED"
  | "EXPIRED"
  | "CANCELLED"
  | "SUPPRESSED";

export type ContactDecision = "NO_INCENTIVE" | "REMINDER_ONLY" | "DISCOUNT_ELIGIBLE";

export type SignalType =
  | "product_view"
  | "repeated_product_view"
  | "add_to_cart"
  | "checkout_start"
  | "payment_started"
  | "purchase";

/**
 * منبّه استرجاع وُلد من إشارة سلوكية (ضمن DRY_RUN لا يُنتج أي رسالة/كوبون).
 * الهدف: تمييز النية الحقيقية بدل مراسلة أي مشاهد واحد.
 */
export type RecoveryInput = {
  customer?: { id: string; phone: string } | null;
  visitorId: string;
  sessionId: string;
  signalType: SignalType;
  productId?: string | null;
  productSlug?: string | null;
  subtotal?: number | null;
  qty?: number | null;
  price?: number | null;
  occurredAt?: number;
  hasCompletedOrder?: boolean;
};

/**
 * نموذج حالتة استرجاع مستقلة — يطابق أعمدة جدول recovery_cases المقترح.
 */
export type RecoveryCase = {
  id: string;
  customerId: string | null;
  customerPhone: string | null;
  visitorId: string;
  sessionId: string;
  caseType: CaseType;
  status: CaseStatus;
  score: number;
  cartValue: number | null;
  productIds: string[];
  preferredProductId: string | null;
  preferredProductSlug: string | null;
  firstDetectedAt: number;
  lastActivityAt: number;
  lastMessageAt: number | null;
  messageCount: number;
  discountCount: number;
  lastDiscountAt: number | null;
  nextActionAt: number | null;
  lastReminderStep: number;
  completedAt: number | null;
  purchaseRef: string | null;
  discountRef: string | null;
  suppressReason: string | null;
  decision: ContactDecision | null;
  decidedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type ReminderStep = { step: number; offsetMinutes: number; at: number };

/**
 * أنواع أحداث سجل الحالة (recovery_case_events — migration-037).
 *
 * مبدأ السجل: يُكتب بعد وقوع الفعل لا قبله.
 *  - signal / case_created  = استيعاب.
 *  - stage_entered         = دخول مرحلة (يُحسم بالنتيجة لا بالنية).
 *  - evaluated / decision  = ناتج التقييم والقرار.
 *  - message_queued        = إدراج رسالة في المسار القائم.
 *  - delivery_status       = تغيّر حالة التسليم كما يقرؤها المسار القائم.
 *  - message_sent          = تأكيد الإرسال (status='sent' + sent_at).
 *  - settled               = كتابة التدخل والعدّاد بعد الإرسال المؤكد.
 *  - suppressed            = سبب منع (cooldown/expired/anonymous…).
 *  - closed / closed_purchase = إغلاق الحالة، والثاني مميّز بسببه.
 */
export type RecoveryCaseEventType =
  | "signal"
  | "case_created"
  | "stage_entered"
  | "evaluated"
  | "decision"
  | "message_queued"
  | "delivery_status"
  | "message_sent"
  | "settled"
  | "suppressed"
  | "closed"
  | "closed_purchase";

export const RECOVERY_CASE_EVENT_TYPES: RecoveryCaseEventType[] = [
  "signal",
  "case_created",
  "stage_entered",
  "evaluated",
  "decision",
  "message_queued",
  "delivery_status",
  "message_sent",
  "settled",
  "suppressed",
  "closed",
  "closed_purchase",
];

export type RecoveryCaseEvent = {
  id: string;
  caseId: string;
  eventType: RecoveryCaseEventType;
  stageKey: string | null;
  templateId: number | null;
  /** شرح عربي جاهز للعرض — سطر واحد يقرأه الموظف دون تفسير تقني. */
  summaryAr: string;
  payload: Record<string, unknown>;
  createdAt: number;
};


export type DiscountProposal = {
  percent: number;
  cap: number;
  value: number;
};

/**
 * G6-C: العرض الآمن للقسيمة داخل الاسترجاع.
 *
 * لا صف قاعدة ولا معرّفات داخلية: الكود (مطَبَّع)، نوع الخصم، قيمته، الخصم
 * الفعلي على سلة الحالة، وتاريخ الانتهاء. هذه هي القيم الوحيدة المسموح
 * بتمريرها إلى التسويق والقوالب — لا `recovery_case_id` ولا `customer_identifier`.
 */
export type RecoveryCouponView = {
  code: string;
  type: "percent" | "fixed";
  value: number;
  computedValue: number;
  expiresAt: string | null;
};

/**
 * ناتج تقييم حالة واحدة — "ما الذي سيفعله النظام لو لم يكن DRY_RUN".
 */
export type ContactOutcome = {
  caseId: string;
  decision: ContactDecision;
  wouldSend: boolean;
  suppressReason?: string;
  recommendedAction: string;
  recommendedDiscount: DiscountProposal | null;
  /**
   * G6-C: القسيمة الحقيقية المعروضة في رسالة هذه الحالة، أو null.
   * الـdispatcher يستخدمها لإعادة بناء النص نفسه؛ بدونها لا تُعاد كلمة
   * «خصم» ولا كود مختلَق إلى الرسالة.
   */
  coupon?: RecoveryCouponView | null;
  nextActionAt: number | null;
};

export const CLOSED_STATUSES: CaseStatus[] = ["PURCHASED", "EXPIRED", "CANCELLED", "SUPPRESSED"];
export const ACTIVE_STATUSES: CaseStatus[] = ["OPEN", "ELIGIBLE", "SCHEDULED", "CONTACTED"];
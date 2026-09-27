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

export type DiscountProposal = {
  percent: number;
  cap: number;
  value: number;
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
  nextActionAt: number | null;
};

export const CLOSED_STATUSES: CaseStatus[] = ["PURCHASED", "EXPIRED", "CANCELLED", "SUPPRESSED"];
export const ACTIVE_STATUSES: CaseStatus[] = ["OPEN", "ELIGIBLE", "SCHEDULED", "CONTACTED"];
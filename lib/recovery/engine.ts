import type { RecoveryConfig } from "./config";
import { eventScore } from "./scoring";
import { evaluateContact } from "./decisions";
import { newCaseId } from "./store";
import type { RecoveryCaseStore } from "./store";
import type { CaseType, ContactOutcome, RecoveryCase, RecoveryInput } from "./types";

const CLOSED_STATUSES: RecoveryCase["status"][] = ["PURCHASED", "EXPIRED", "CANCELLED", "SUPPRESSED"];

function caseTypeFor(signalType: RecoveryInput["signalType"]): CaseType {
  switch (signalType) {
    case "checkout_start":
      return "CHECKOUT_STARTED";
    case "payment_started":
      return "PAYMENT_STARTED";
    case "purchase":
      return "PURCHASED";
    default:
      return "ADD_TO_CART";
  }
}

/** أولوية نوع الحالة: الأقوىalzée يفوز (دفعstarted > checkout > add_to_cart). */
const TYPE_RANK: Record<CaseType, number> = { ADD_TO_CART: 1, CHECKOUT_STARTED: 2, PAYMENT_STARTED: 3, PURCHASED: 4 };
function strongestType(a: CaseType, b: CaseType): CaseType {
  return TYPE_RANK[b] > TYPE_RANK[a] ? b : a;
}

type NowProvider = () => number;

/**
 * Recovery Engine — منطق قرار نقي فوق مخزن محقون (Dependency Injection).
 *
 * المرحلة الأولى إلزاميًا DRY_RUN:
 *  - لا إرسال رسائل، ولا إنشاء كوبونات، ولا كتابة في orders/customers/settings.
 *  - التقييم (evaluate/runDryRunCycle) قراءة وقرار فقط — لا يغيّر أي حالة.
 *  - الزائر المجهول يبقى OPEN بلا محاولة تحديد هويته.
 */
export class RecoveryEngine {
  constructor(
    private readonly store: RecoveryCaseStore,
    private readonly cfg: RecoveryConfig,
    private readonly now: NowProvider = Date.now
  ) {}

  /**
   * استيعاب إشارة سلوكية: إنشاء/تحديث/إغلاق حالة استرجاع. لا يرسل شيئًا.
   */
  async ingest(input: RecoveryInput): Promise<RecoveryCase | null> {
    if (!this.cfg.enabled) return null;
    const now = this.now();
    const existing = await this.store.findLatestByVisitor(input.visitorId);

    // شراء لاحق: يغلق أي حالة نشطة فورًا.
    if (input.signalType === "purchase") {
      if (!existing || CLOSED_STATUSES.includes(existing.status)) return null;
      return this.patch(existing, { status: "PURCHASED", completedAt: now, nextActionAt: null, decision: null, decidedAt: null });
    }

    // حالة مغلقة بلا شراء (منتهية/ملغاة/موقوفة) + نية جديدة = حالة جديدة
    // (لا نُحيي القديمة حتى لا يُ.Reset حد الـ3 رسائل).
    if (existing && CLOSED_STATUSES.includes(existing.status)) {
      return this.create(input, now);
    }

    if (existing) {
      return this.patch(existing, {
        score: existing.score + eventScore(input.signalType, this.cfg),
        caseType: strongestType(existing.caseType, caseTypeFor(input.signalType)),
        cartValue: typeof input.subtotal === "number" && input.subtotal > 0 ? input.subtotal : existing.cartValue,
        productIds: input.productId && !existing.productIds.includes(input.productId) ? [...existing.productIds, input.productId] : existing.productIds,
        preferredProductId: input.productId ?? existing.preferredProductId,
        preferredProductSlug: input.productSlug ?? existing.preferredProductSlug,
        lastActivityAt: input.occurredAt ?? now,
        // العميل المسجّل قد يعود فيُربط (الزائر المجهول لا يُطلب منه تحديد هويته)
        customerId: input.customer?.id ?? existing.customerId,
        customerPhone: input.customer?.phone ?? existing.customerPhone,
        suppressReason: input.hasCompletedOrder ? "order_completed" : existing.suppressReason,
      });
    }

    return this.create(input, now);
  }

  /**
   * شراء موثّق (notification_events / order.created) — إسناد ينص على الحالة
   * الصحيحة فقط، لا إغلاق أعمى لكل حالات الرقم.
   *
   * قواعد الإسناد (قابلة للتدقيق، ولا تدّعي سببية مطلقة):
   *  1. لا يُغلق إلا حالة نشطة واحدة: الأحدث نشاطًا (الأقرب للشراء).
   *  2. يجب أن تكون الحالة سابقة للطلب: case.lastActivityAt < orderCreatedAt.
   *     طلب سبق اكتشاف الحالة لا يُنسب إليها.
   *  3. purchaseRef يجب أن يكون الطلب الفعلي المرتبط بتلك الحالة.
   *
   * هل الشراء «استعادة» أم «تحويل طبيعي»؟
   *  - الاستعادة تتطلب تدخّلًا موثّقًا سابقًا للشراء (recovery_contact_attempts).
   *  - بدونه: تُغلق الحالة بحالة PURCHASED (حتى لا تظل معلّقة) لكن بلا أي
   *    ادعاء استعادة — المقاييس لا تحسبها لأنها بلا intervention موثّق
   *    سابق للشراء. عمدًا: يبقى purchaseRef للربط والتدقيق فقط.
   */
  async completePurchaseByCustomer(
    customerPhone: string,
    purchaseRef: string | null,
    opts: { orderCreatedAt?: number | null } = {}
  ): Promise<number> {
    // Stage 1 lock: DRY_RUN (أو معطّل) = بلا أي كتابة. القراءة والتقييم مستمران،
    // لكن الإغلاق كتابة ⇒ ممنوع في DRY_RUN (fail-closed).
    if (!this.cfg.enabled || this.cfg.dryRun) return 0;

    const now = this.now();
    const orderCreatedAt = typeof opts.orderCreatedAt === "number" ? opts.orderCreatedAt : null;
    const candidates = await this.store.findActiveByCustomer(customerPhone);
    if (candidates.length === 0) return 0;

    // الحالة الأحدث نشاطًا فقط — لا نغلق كل حالات الرقم.
    candidates.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
    const target = candidates[0];

    // شرط الزمن: الحالة يجب أن تسبق الطلب. بدون وقت الطلب لا نُسند عمدًا
    // (fail-safe: لا نغلق على أساس تخمين).
    if (orderCreatedAt === null) return 0;
    if (target.lastActivityAt >= orderCreatedAt) return 0;

    await this.store.update(target.id, {
      status: "PURCHASED",
      completedAt: now,
      purchaseRef,
      nextActionAt: null,
      decision: null,
      decidedAt: null,
      updatedAt: now,
    });
    return 1;
  }

  /** تقييم حالة واحدة — ناتج قرار فقط. */
  async evaluate(c: RecoveryCase, ctx: { hasCompletedOrder?: boolean } = {}): Promise<ContactOutcome> {
    if (!this.cfg.enabled) {
      return {
        caseId: c.id,
        decision: "NO_INCENTIVE",
        wouldSend: false,
        suppressReason: "disabled",
        recommendedAction: "النظام غير مفعّل (enabled=false)",
        recommendedDiscount: null,
        nextActionAt: null,
      };
    }
    return evaluateContact(c, { now: this.now(), hasCompletedOrder: ctx.hasCompletedOrder }, this.cfg);
  }

  /**
   * دورة DRY_RUN: تقيّم الحالات النشطة وتُخرج الخطة (قرار فقط، بلا تنفيذ).
   * الترتيب: أولًا المؤهل للخصم، ثم التذكير، ثم الباقي.
   */
  async runDryRunCycle(opts?: { hasCompletedOrder?: (phone: string) => Promise<boolean> }): Promise<{ dryRun: boolean; outcomes: ContactOutcome[] }> {
    const cases = await this.store.listActive();
    const outcomes: ContactOutcome[] = [];
    for (const c of cases) {
      const hasCompletedOrder = opts?.hasCompletedOrder && c.customerPhone ? await opts.hasCompletedOrder(c.customerPhone) : false;
      outcomes.push(await this.evaluate(c, { hasCompletedOrder }));
    }
    const rank = (o: ContactOutcome) => (o.decision === "DISCOUNT_ELIGIBLE" ? 0 : o.decision === "REMINDER_ONLY" ? 1 : 2);
    outcomes.sort((a, b) => rank(a) - rank(b));
    return { dryRun: true, outcomes };
  }

  private async create(input: RecoveryInput, now: number): Promise<RecoveryCase> {
    const occurred = input.occurredAt ?? now;
    const row: RecoveryCase = {
      id: newCaseId(),
      customerId: input.customer?.id ?? null,
      customerPhone: input.customer?.phone ?? null,
      visitorId: input.visitorId,
      sessionId: input.sessionId,
      caseType: caseTypeFor(input.signalType),
      status: "OPEN",
      score: eventScore(input.signalType, this.cfg),
      cartValue: typeof input.subtotal === "number" && input.subtotal > 0 ? input.subtotal : null,
      productIds: input.productId ? [input.productId] : [],
      preferredProductId: input.productId ?? null,
      preferredProductSlug: input.productSlug ?? null,
      firstDetectedAt: occurred,
      lastActivityAt: occurred,
      lastMessageAt: null,
      messageCount: 0,
      discountCount: 0,
      lastDiscountAt: null,
      nextActionAt: null,
      lastReminderStep: 0,
      completedAt: null,
      purchaseRef: null,
      discountRef: null,
      suppressReason: input.hasCompletedOrder ? "order_completed" : null,
      decision: null,
      decidedAt: null,
      createdAt: occurred,
      updatedAt: occurred,
    };
    await this.store.create(row);
    return row;
  }

  private async patch(current: RecoveryCase, updates: Partial<RecoveryCase>): Promise<RecoveryCase> {
    const now = this.now();
    const next: RecoveryCase = { ...current, ...updates, id: current.id, updatedAt: now };
    await this.store.update(current.id, next);
    return next;
  }
}

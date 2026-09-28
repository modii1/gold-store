import { createAdminClient } from "@/lib/supabase/admin";
import { createDeliveries } from "@/lib/notifications/dispatcher";
import { normalizePhoneInternational } from "@/lib/format";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecoveryCaseStore } from "./store";
import type { ContactOutcome, RecoveryCase } from "./types";
import type { RecoveryConfig } from "./config";

/**
 * Recovery dispatcher - two phases over the EXISTING WhatsApp path in gold-store:
 *
 *   notifications -> notification_deliveries(channel=whatsapp) -> qr-server -> sent
 *
 * Invariants (no call path may break them):
 *  1. No intervention row, no messageCount increment, no lastMessageAt update
 *     is ever written before a delivery row is read from the database with
 *     status = 'sent' AND a non-null sent_at.
 *  2. 'pending' / 'sending' / 'failed' / 'permanent_failed' / the mere
 *     existence of a delivery row are NOT evidence of delivery.
 *  3. No new provider, no new API: the existing qr-server performs the send.
 *  4. No invented offer and no messaging content beyond what already exists.
 *     There is no real coupon path, so coupon_ref is always null.
 */

/** Notification type used for recovery contact messages. */
export const RECOVERY_CONTACT_TYPE = "recovery.contact";

/** The only channel used in this phase. */
const CONTACT_CHANNEL = "whatsapp";

/** Statuses that are explicitly NOT proof of delivery. */
const NON_SUCCESS_STATUSES = ["pending", "sending", "failed", "permanent_failed"] as const;

/**
 * مفتاح تسوية حتمي لكل رسالة مؤكَّدة.
 *
 * سبب الاعتماد على مفتاح أساسي بدل مقارنة (case, channel, sentAt):
 *  - الطابع الزمني ليس معرّفًا فريدًا للتسليم؛ delivery مختلف لنفس الحالة
 *    قد يحمل نفس sent_at، فيُخطئ التطابق الزمني كأنه تكرار.
 *  - المقارنة القراءة-قبل-الكتابة تتسابق بين عمليتي cron متزامنتين.
 * بإدراج id ثابت في recovery_contact_attempts يصبح الـINSERT نفسه هو الحارس:
 * مفتاح واحد = تدخل واحد، مفروض من قاعدة البيانات لا من توقيت التطبيق.
 */
export function deterministicAttemptId(notificationId: string, channel: string, sentAt: number): string {
  return hashToUuid(`${RECOVERY_CONTACT_TYPE}.attempt:${notificationId}:${channel}:${sentAt}`);
}

export type RecoveryContactPayload = {
  /** Deterministic notification id - doubles as the enqueue idempotency key. */
  notificationId: string;
  caseId: string;
  /**
   * القيمة التي يجب أن يبلغها messageCount بعد تأكيد هذه الرسالة
   * (messageCount وقت الجدولة + 1). يكتبها dispatch ويقرأها settle.
   */
  expectedMessageCount: number;
  phone: string;
  title: string;
  message: string;
  actionUrl: string;
};

export type RecoveryDeliveryRow = {
  deliveryId: string;
  notificationId: string;
  caseId: string;
  channel: string;
  status: string;
  /** epoch ms, or null when sent_at is empty. */
  sentAt: number | null;
  /**
   * القيمة التي يجب أن يبلغها messageCount عند تأكيد هذه الرسالة، كما سُجّلت
   * وقت الجدولة في metadata.recovery_expected_count.
   * null for rows written before this field existed - settle then falls back to
   * current + 1 and still never double counts.
   */
  expectedMessageCount: number | null;
};

export type CreateContactResult = { created: boolean; duplicate: boolean; rejected?: boolean };

/**
 * Gateway seam. Isolated from direct DB access so the whole dispatcher is
 * testable with zero real sends: production uses Supabase, tests use a fake.
 */
export interface RecoveryContactGateway {
  /** Creates the notification, then the whatsapp delivery via createDeliveries. */
  createWhatsAppContact(payload: RecoveryContactPayload): Promise<CreateContactResult>;
  /** Every case id that owns a recovery notification, active or closed. */
  listRecoveryCaseIds(): Promise<string[]>;
  /** All whatsapp deliveries that belong to the given recovery cases. */
  listRecoveryDeliveries(caseIds: string[]): Promise<RecoveryDeliveryRow[]>;
}

// ---------------------------------------------------------------
// Content - derived only from the existing case data. No new offer.
// ---------------------------------------------------------------

/**
 * Fixed, neutral message text: it only refers to the saved cart.
 *
 * It mentions no discount percentage and no coupon, because no real coupon
 * path exists in this system and advertising an unredeemable discount would be
 * a false promise. recommendedDiscount stays an internal proposal - it is not
 * rendered into the message and never becomes a coupon_ref.
 */
export function buildRecoveryMessage(c: RecoveryCase): { title: string; message: string } {
  const item = c.preferredProductSlug ? ` (${c.preferredProductSlug})` : "";
  return {
    title: "سلتك ما زالت محفوظة",
    message: `لاحظنا سلة غير مكتملة${item} في متجرنا، ونود إتمام طلبك. يمكنك الرجوع إلى سلتك في أي وقت لإكمال الشراء.`,
  };
}

// ---------------------------------------------------------------
// Idempotency - deterministic keys, no migration required
// ---------------------------------------------------------------

/**
 * Deterministic UUID derived from (caseId + messageCount).
 *
 * This is the enqueue guard: the notifications row is inserted with a fixed
 * primary key. Running the cron twice for the same (case, messageCount) makes
 * the second insert collide with the primary key (PostgreSQL 23505) and be
 * rejected, so duplicate enqueues are prevented by the database itself rather
 * than by application-level timing.
 */
export function deterministicNotificationId(caseId: string, messageCount: number): string {
  return hashToUuid(`${RECOVERY_CONTACT_TYPE}:${caseId}:${messageCount}`);
}

function hashToUuid(input: string): string {
  // Two differently seeded FNV-1a 64-bit hashes -> 16 bytes. Sufficient
  // distribution for an idempotency key; this is not a security primitive.
  // 32-bit pair instead of BigInt: the tsconfig target predates ES2020.
  const bytes = new Uint8Array(16);
  const h1 = fnv1a(input, 0x84222325);
  const h2 = fnv1a(`${input}#salt`, 0xcbf29ce4);
  for (let i = 0; i < 4; i++) {
    bytes[i] = (h1 >>> (8 * i)) & 0xff;
    bytes[4 + i] = (h2 >>> (8 * i)) & 0xff;
    bytes[8 + i] = (h1 >>> (8 * (i + 1))) & 0xff;
    bytes[12 + i] = (h2 >>> (8 * (i + 1))) & 0xff;
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** FNV-1a 32-bit. Deterministic and dependency-free; not a security primitive. */
function fnv1a(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i) & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

// ---------------------------------------------------------------
// Supabase gateway - same tables and the same existing createDeliveries
// ---------------------------------------------------------------

export class SupabaseRecoveryContactGateway implements RecoveryContactGateway {
  constructor(private readonly createClient: () => SupabaseClient = createAdminClient) {}

  async createWhatsAppContact(payload: RecoveryContactPayload): Promise<CreateContactResult> {
    const supabase = this.createClient();
    const normalized = normalizePhoneInternational(payload.phone);
    // لا رقم صالح = لا إشعار أصلًا. لا نُدخل أبدًا قيمةً خام قد تُرسل لاحقًا.
    if (!normalized) return { created: false, duplicate: false, rejected: true };
    const ownerId = normalized;
    const nowIso = new Date().toISOString();

    const { error } = await supabase.from("notifications").insert({
      id: payload.notificationId,
      user_type: "customer",
      user_id: ownerId,
      customer_id: ownerId,
      type: RECOVERY_CONTACT_TYPE,
      category: "customer",
      severity: "info",
      title: payload.title,
      message: payload.message,
      // Explicit notification -> case linkage; the reconcile phase reads it.
      // recovery_expected_count makes the counter write idempotent: settle SETs
      // messageCount to this value instead of incrementing a possibly stale one.
      metadata: {
        recovery_case_id: payload.caseId,
        recovery_channel: CONTACT_CHANNEL,
        recovery_expected_count: payload.expectedMessageCount,
        queued_at: nowIso,
      },
      action_url: payload.actionUrl,
      is_read: false,
    });

    if (error) {
      // 23505 = duplicate primary key = this (case, messageCount) is already queued.
      if (error.code === "23505") return { created: false, duplicate: true };
      console.error("[recovery-dispatch] notification insert failed:", error.message?.slice(0, 200));
      return { created: false, duplicate: false };
    }

    // Existing path: a pending delivery row that the existing qr-server picks up.
    await createDeliveries(payload.notificationId, [CONTACT_CHANNEL]);
    return { created: true, duplicate: false };
  }

  async listRecoveryCaseIds(): Promise<string[]> {
    const supabase = this.createClient();
    const { data, error } = await supabase
      .from("notifications")
      .select("metadata")
      .eq("type", RECOVERY_CONTACT_TYPE)
      .limit(2000);
    if (error || !data) {
      if (error) console.error("[recovery-settle] case scope read failed:", error.message?.slice(0, 200));
      return [];
    }
    const ids = new Set<string>();
    for (const row of (data as Record<string, unknown>[]) || []) {
      const metadata = (row.metadata as Record<string, unknown> | null) ?? {};
      const caseId = String(metadata.recovery_case_id ?? "");
      if (caseId) ids.add(caseId);
    }
    return [...ids];
  }

  async listRecoveryDeliveries(caseIds: string[]): Promise<RecoveryDeliveryRow[]> {
    if (!caseIds.length) return [];
    const supabase = this.createClient();
    const { data, error } = await supabase
      .from("notification_deliveries")
      .select("id, notification_id, channel, status, sent_at, notifications!inner(type, metadata)")
      .eq("channel", CONTACT_CHANNEL)
      .in("status", ["pending", "sending", "sent", "failed", "permanent_failed"])
      .limit(2000);

    if (error || !data) {
      if (error) console.error("[recovery-dispatch] delivery read failed:", error.message?.slice(0, 200));
      return [];
    }

    const out: RecoveryDeliveryRow[] = [];
    for (const row of (data as Record<string, unknown>[]) || []) {
      const notification = (row.notifications as Record<string, unknown> | null) ?? null;
      if (!notification || String(notification.type ?? "") !== RECOVERY_CONTACT_TYPE) continue;
      const metadata = (notification.metadata as Record<string, unknown> | null) ?? {};
      const caseId = String(metadata.recovery_case_id ?? "");
      if (!caseId || !caseIds.includes(caseId)) continue;
      out.push({
        deliveryId: String(row.id),
        notificationId: String(row.notification_id),
        caseId,
        channel: String(row.channel),
        status: String(row.status ?? ""),
        sentAt: toEpoch(row.sent_at),
        expectedMessageCount: toCount(metadata.recovery_expected_count),
      });
    }
    return out;
  }
}

function toEpoch(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : new Date(String(v)).getTime();
  return Number.isFinite(n) ? n : null;
}

/** Reads metadata.recovery_expected_count; null when absent or not a whole number. */
function toCount(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(String(v ?? ""));
  return Number.isInteger(n) && n >= 0 ? n : null;
}

// ---------------------------------------------------------------
// Dispatcher - phase 1: enqueue only (never claims a send happened)
// ---------------------------------------------------------------

export type DispatchSummary = {
  considered: number;
  queued: number;
  skippedAlreadyInFlight: number;
  skippedDuplicate: number;
  skippedNoIdentity: number;
  skippedInvalidPhone: number;
};

export class RecoveryDispatcher {
  constructor(
    private readonly store: RecoveryCaseStore,
    private readonly gateway: RecoveryContactGateway,
    private readonly cfg: RecoveryConfig,
    private readonly now: () => number = Date.now
  ) {}

  /**
   * Phase 1 - only for wouldSend outcomes: creates the notification and the
   * whatsapp delivery. No recordIntervention, no messageCount change and no
   * lastMessageAt change happen here.
   *
   * Identity gate: a case with no customer id, or a phone that is not a valid
   * international number, is never queued. Writing the raw string instead
   * would push an undeliverable row into the existing WhatsApp path.
   */
  async dispatch(cases: RecoveryCase[], outcomes: ContactOutcome[]): Promise<DispatchSummary> {
    const summary: DispatchSummary = {
      considered: 0,
      queued: 0,
      skippedAlreadyInFlight: 0,
      skippedDuplicate: 0,
      skippedNoIdentity: 0,
      skippedInvalidPhone: 0,
    };
    if (!this.cfg.enabled || this.cfg.dryRun) return summary;

    const byId = new Map(cases.map((c) => [c.id, c]));
    // Any unsettled delivery (including a 'failed' one that the existing
    // qr-server will reschedule) means a message is already scheduled for that
    // case, so a second message is never queued for it.
    const inFlight = new Set<string>();
    for (const row of await this.gateway.listRecoveryDeliveries(cases.map((c) => c.id))) {
      if (row.status === "sent") continue;
      inFlight.add(row.caseId);
    }

    for (const outcome of outcomes) {
      if (!outcome.wouldSend) continue;
      const c = byId.get(outcome.caseId);
      if (!c) continue;
      summary.considered++;

      if (!c.customerId || !c.customerPhone) {
        summary.skippedNoIdentity++;
        continue;
      }
      if (!normalizePhoneInternational(c.customerPhone)) {
        summary.skippedInvalidPhone++;
        continue;
      }
      if (inFlight.has(c.id)) {
        summary.skippedAlreadyInFlight++;
        continue;
      }

      const { title, message } = buildRecoveryMessage(c);
      const result = await this.gateway.createWhatsAppContact({
        notificationId: deterministicNotificationId(c.id, c.messageCount),
        caseId: c.id,
        expectedMessageCount: c.messageCount + 1,
        phone: c.customerPhone,
        title,
        message,
        actionUrl: "/cart",
      });

      if (result.duplicate) {
        summary.skippedDuplicate++;
        continue;
      }
      if (result.rejected) {
        summary.skippedInvalidPhone++;
        continue;
      }
      if (result.created) {
        inFlight.add(c.id);
        summary.queued++;
      }
    }
    return summary;
  }

  /**
   * Phase 2 - reconciliation (write-after-success).
   *
   * For a delivery with status = 'sent' AND a non-null sent_at only:
   *   recordIntervention() + messageCount + lastMessageAt.
   *
   * Ordering and idempotency, in this order:
   *  1. The delivery row is the only accepted proof; nothing else writes.
   *  2. The intervention row is inserted under a deterministic primary key, so
   *     the database itself rejects a second settlement of the same message
   *     (23505) even if two cron cycles run at once.
   *  3. The counter is then SET to the enqueue-time expected value rather than
   *     incremented. That makes it idempotent as well, and it repairs a case
   *     where the intervention committed but the counter write did not: the
   *     next cycle sees the collision, notices messageCount < expected, and
   *     finishes the job instead of silently skipping it forever.
   */
  async settle(): Promise<SettleSummary> {
    const summary: SettleSummary = {
      scanned: 0,
      sent: 0,
      pending: 0,
      failed: 0,
      permanentFailed: 0,
      alreadySettled: 0,
      counterRepaired: 0,
      unknownCase: 0,
    };
    if (!this.cfg.enabled || this.cfg.dryRun) return summary;

    // Scope: every case that actually owns a recovery delivery row, not just the
    // active ones. A message confirmed after the case was closed by a purchase
    // is still a real send and must still be recorded.
    const caseIds = await this.gateway.listRecoveryCaseIds();
    if (!caseIds.length) return summary;
    const byId = await this.store.findByIds(caseIds);
    const rows = await this.gateway.listRecoveryDeliveries(caseIds);
    const existing = await this.store.listInterventions(caseIds);

    // Live per-case counter so two confirmed deliveries in one cycle both land.
    const counter = new Map<string, number>();
    for (const c of byId.values()) counter.set(c.id, c.messageCount);
    const lastAt = new Map<string, number>();
    for (const c of byId.values()) if (c.lastMessageAt) lastAt.set(c.id, c.lastMessageAt);

    /**
     * Sets the counter to the enqueue-time expected value instead of
     * incrementing: a repeat call is a no-op, and an out-of-order older
     * delivery can never walk the counter backwards (max with current).
     */
    const applyCounter = async (caseId: string, expected: number, sentAt: number): Promise<void> => {
      const next = Math.max(counter.get(caseId) ?? 0, expected);
      counter.set(caseId, next);
      lastAt.set(caseId, sentAt);
      await this.store.update(caseId, {
        messageCount: next,
        lastMessageAt: sentAt,
        updatedAt: this.now(),
      });
    };

    for (const row of rows) {
      summary.scanned++;

      const status = row.status.toLowerCase();
      if (status !== "sent" || row.sentAt === null) {
        // Not proof of delivery: leave it alone and let the existing retry
        // machinery in the qr-server handle 'failed'.
        if ((NON_SUCCESS_STATUSES as readonly string[]).includes(status)) {
          if (status === "pending" || status === "sending") summary.pending++;
          else if (status === "failed") summary.failed++;
          else if (status === "permanent_failed") summary.permanentFailed++;
        }
        continue;
      }

      const sentAt = row.sentAt;
      const known = byId.get(row.caseId);
      if (!known) {
        summary.unknownCase++;
        continue;
      }

      // The target counter value: what the enqueue expected to produce, or
      // current + 1 for rows written before recovery_expected_count existed.
      const current = counter.get(row.caseId) ?? 0;
      const expected = row.expectedMessageCount === null ? current + 1 : row.expectedMessageCount;

      // Safety net for rows predating the deterministic key: same (channel,
      // sentAt) already on record means that send is accounted for.
      const alreadyOnRecord = (existing.get(row.caseId) ?? []).some(
        (i) => i.channel === row.channel && i.sentAt === sentAt
      );

      const attemptId = deterministicAttemptId(row.notificationId, row.channel, sentAt);
      const recorded = await this.store.recordIntervention({
        id: attemptId,
        caseId: row.caseId,
        channel: row.channel,
        sentAt,
        // No real coupon path exists - never invent a reference.
        couponRef: null,
      });

      if (!recorded) {
        // Either another cycle won the key, or an older row already carries this
        // exact send. Either way the intervention must not be duplicated; the
        // only question left is whether its counter write ever landed.
        if (row.expectedMessageCount === null) {
          // Legacy row: the pair (messageCount, lastMessageAt) is always written
          // together, so an intervention whose sentAt is already lastMessageAt
          // proves the counter landed. Without that check the current+1 fallback
          // would creep upward on every run.
          if ((lastAt.get(row.caseId) ?? 0) === sentAt) {
            summary.alreadySettled++;
            continue;
          }
          await applyCounter(row.caseId, expected, sentAt);
          summary.counterRepaired++;
          continue;
        }
        if (current >= expected) {
          summary.alreadySettled++;
          continue;
        }
        await applyCounter(row.caseId, expected, sentAt);
        summary.counterRepaired++;
        continue;
      }

      if (alreadyOnRecord) {
        // Two distinct messages sent at the same instant: the insert still
        // succeeded, so this is a genuine send, and its counter is applied.
        summary.sent++;
        await applyCounter(row.caseId, expected, sentAt);
        continue;
      }

      const list = existing.get(row.caseId) ?? [];
      list.push({ caseId: row.caseId, channel: row.channel, sentAt, couponRef: null });
      existing.set(row.caseId, list);

      // lastMessageAt is set to sent_at, so cooldown and maxMessages are
      // enforced from confirmed sends only.
      await applyCounter(row.caseId, expected, sentAt);
      summary.sent++;
    }
    return summary;
  }
}

export type SettleSummary = {
  scanned: number;
  sent: number;
  pending: number;
  failed: number;
  permanentFailed: number;
  alreadySettled: number;
  /** Interventions already on record whose counter write had not landed. */
  counterRepaired: number;
  unknownCase: number;
};

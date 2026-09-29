/**
 * اختبارات مُرسِل الاسترجاع — write-after-success + idempotency.
 *
 * لا تُرسل أي رسالة حقيقية: البوابة هنا تنفيذ وهمي بالكامل (لا Supabase،
 * لا createDeliveries، لا qr-server). الهدف إثبات أن
 *   - الجدولة (dispatch) لا تسجّل أي_send_,
 *   - التسوية (settle) لا تكتب شيئًا إلا عند status='sent' + sent_at،
 *   - إعادة تشغيل Cron لا تنتج تدخلًا أو زيادة عدّاد إضافية،
 *   - cooldown/maxMessages تعتمد على الإرسالات المؤكدة فقط.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  RecoveryDispatcher,
  RECOVERY_CONTACT_TYPE,
  buildRecoveryMessage,
  deterministicAttemptId,
  deterministicNotificationId,
} from "./dispatcher";
import type { RecoveryContactGateway, RecoveryContactPayload, RecoveryDeliveryRow } from "./dispatcher";
import { InMemoryRecoveryStore } from "./store";
import { evaluateContact } from "./decisions";
import { computeMetrics, isVerifiedRecovery } from "./metrics";
import { loadRecoveryConfig } from "./config";
import type { RecoveryConfig } from "./config";
import type { RecoveryCase } from "./types";
import type { RecoveryStage } from "./stages";
import type { DispatchTemplate } from "./dispatch-message";

const HOUR = 3_600_000;
const T0 = 1_700_000_000_000;
const PHONE = "966533220646";
const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "22222222-2222-4222-8222-222222222222";

const cfg: RecoveryConfig = {
  ...loadRecoveryConfig({ NODE_ENV: "test" } as NodeJS.ProcessEnv),
  enabled: true,
  dryRun: false,
};

function baseCase(over: Partial<RecoveryCase> = {}): RecoveryCase {
  return {
    id: CASE_ID,
    customerId: "cust-1",
    customerPhone: PHONE,
    visitorId: "v-1",
    sessionId: "s-1",
    caseType: "ADD_TO_CART",
    status: "OPEN",
    score: 40,
    cartValue: 250,
    productIds: ["p1"],
    preferredProductId: "p1",
    preferredProductSlug: "product-1",
    firstDetectedAt: T0,
    lastActivityAt: T0,
    lastMessageAt: null,
    messageCount: 0,
    discountCount: 0,
    lastDiscountAt: null,
    nextActionAt: null,
    lastReminderStep: 0,
    completedAt: null,
    purchaseRef: null,
    discountRef: null,
    suppressReason: null,
    decision: null,
    decidedAt: null,
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

/**
 * بوابة وهمية تحاكي دلالات القاعدة المستخدمة في الإنتاج:
 *  - notifications.id مفتاح أساسي ⇒ تكرار = 23505 (duplicate).
 *  - notification_deliveries تُنشأ بحالة 'pending' فقط.
 *  - لا شيء هنا يرسل فعليًا؛ تغيير الحالة إلى sent يحاكي qr-server فقط.
 */
class FakeGateway implements RecoveryContactGateway {
  notifications: Array<{ id: string; caseId: string; title: string; message: string; category: string }> = [];
  deliveries: RecoveryDeliveryRow[] = [];
  /** قوالب recovery المربوطة بالمراحل (نشطة وغير نشطة) — مصدر readTemplates. */
  templates: DispatchTemplate[] = [];
  private nextId = 1;
  createCalls = 0;

  async createWhatsAppContact(payload: RecoveryContactPayload) {
    this.createCalls++;
    if (this.notifications.some((n) => n.id === payload.notificationId)) {
      return { created: false, duplicate: true };
    }
    this.notifications.push({
      id: payload.notificationId,
      caseId: payload.caseId,
      title: payload.title,
      message: payload.message,
      category: "customer",
    });
    this.deliveries.push({
      deliveryId: String(this.nextId++),
      notificationId: payload.notificationId,
      caseId: payload.caseId,
      channel: "whatsapp",
      status: "pending",
      sentAt: null,
      expectedMessageCount: payload.expectedMessageCount,
    });
    return { created: true, duplicate: false };
  }

  async listRecoveryCaseIds(): Promise<string[]> {
    return [...new Set(this.notifications.map((n) => n.caseId))];
  }

  async listRecoveryDeliveries(caseIds: string[]): Promise<RecoveryDeliveryRow[]> {
    return this.deliveries.filter((d) => caseIds.includes(d.caseId));
  }

  /** محاكاة qr-server: يغيّر الحالة فقط ولا ينشئ صفًا جديدًا. */
  markDelivery(deliveryId: string, status: string, sentAt: number | null) {
    const row = this.deliveries.find((d) => d.deliveryId === deliveryId);
    if (!row) throw new Error(`no delivery ${deliveryId}`);
    row.status = status;
    row.sentAt = status === "sent" ? sentAt : null;
  }

  /**
   * يضيف صف delivery قائمة (لصفوف أقدم بلا recovery_expected_count).
   * يُسجّل الـnotification المقابل أيضًا، لأن بوابة الإنتاج تشتق نطاق
   * التسوية منه: فلا delivery في الإنتاج بلا notification.
   */
  addDelivery(d: Omit<RecoveryDeliveryRow, "expectedMessageCount"> & { expectedMessageCount?: number | null }) {
    this.deliveries.push({ expectedMessageCount: null, ...d });
    if (!this.notifications.some((n) => n.id === d.notificationId)) {
      this.notifications.push({
        id: d.notificationId,
        caseId: d.caseId,
        title: "سلتك ما زالت محفوظة",
        message: "",
        category: "customer",
      });
    }
    return d.deliveryId;
  }

  async readTemplates(ids: number[]): Promise<DispatchTemplate[]> {
    return this.templates.filter((t) => t.id !== null && ids.includes(t.id));
  }
}

async function newHarness() {
  const store = new InMemoryRecoveryStore();
  const gateway = new FakeGateway();
  const c = baseCase();
  await store.create(c);
  const dispatcher = new RecoveryDispatcher(store, gateway, cfg, () => T0 + 30 * HOUR);
  return { store, gateway, dispatcher, caseRow: c };
}

function outcomeFor(c: RecoveryCase) {
  return evaluateContact(c, { now: T0 + 30 * HOUR }, cfg);
}

// ── A: الجدولة تنشئ notification + delivery pending، ولا تسجّل تدخلًا ──────

describe("A. حالة مؤهلة → جدولة بلا ادّعاء إرسال", () => {
  it("A1. delivery تُنشأ بحالة pending ولا يوجد أي intervention", async () => {
    const { store, gateway, dispatcher, caseRow } = await newHarness();
    const out = outcomeFor(caseRow);
    expect(out.wouldSend).toBe(true);

    const summary = await dispatcher.dispatch([caseRow], [out]);

    expect(summary.queued).toBe(1);
    expect(gateway.notifications).toHaveLength(1);
    expect(gateway.notifications[0].category).toBe("customer");
    expect(gateway.deliveries[0].status).toBe("pending");
    // لا تدخل ولا عدّاد ولا lastMessageAt عند الجدولة إطلاقًا.
    expect((await store.listInterventions([CASE_ID])).get(CASE_ID)).toBeUndefined();
    expect(store.all()[0].messageCount).toBe(0);
    expect(store.all()[0].lastMessageAt).toBeNull();
  });

  it("A2. type الإشعار recovery.contact والمعرّف حتمي", async () => {
    const { gateway, dispatcher, caseRow } = await newHarness();
    await dispatcher.dispatch([caseRow], [outcomeFor(caseRow)]);
    const notificationId = gateway.notifications[0].id;
    expect(notificationId).toBe(deterministicNotificationId(CASE_ID, 0));
    expect(RECOVERY_CONTACT_TYPE).toBe("recovery.contact");
  });

  it("A3. settle على delivery pending لا يسجّل شيئًا", async () => {
    const { store, dispatcher, caseRow } = await newHarness();
    await dispatcher.dispatch([caseRow], [outcomeFor(caseRow)]);
    const s = await dispatcher.settle();
    expect(s.sent).toBe(0);
    expect(s.pending).toBe(1);
    expect((await store.listInterventions([CASE_ID])).get(CASE_ID)).toBeUndefined();
    expect(store.all()[0].messageCount).toBe(0);
  });
});

// ── B: sending ليست دليلًا ───────────────────────────────────────────────

describe("B. delivery في حالة sending", () => {
  it("B. sending ⇒ لا تدخل ولا زيادة عدّاد", async () => {
    const { store, gateway, dispatcher, caseRow } = await newHarness();
    await dispatcher.dispatch([caseRow], [outcomeFor(caseRow)]);
    gateway.markDelivery(gateway.deliveries[0].deliveryId, "sending", null);

    const s = await dispatcher.settle();

    expect(s.sent).toBe(0);
    expect(s.pending).toBe(1);
    expect((await store.listInterventions([CASE_ID])).get(CASE_ID)).toBeUndefined();
    expect(store.all()[0].messageCount).toBe(0);
    expect(store.all()[0].lastMessageAt).toBeNull();
  });
});

// ── C: sent + sent_at ⇒ تدخل واحد بالضبط ───────────────────────────────

describe("C. delivery مؤكَّدة الإرسال", () => {
  it("C1. sent + sent_at ⇒ تدخل واحد + messageCount + lastMessageAt", async () => {
    const { store, gateway, dispatcher, caseRow } = await newHarness();
    await dispatcher.dispatch([caseRow], [outcomeFor(caseRow)]);
    const sentAt = T0 + 5 * HOUR;
    gateway.markDelivery(gateway.deliveries[0].deliveryId, "sent", sentAt);

    const s = await dispatcher.settle();

    expect(s.sent).toBe(1);
    const list = (await store.listInterventions([CASE_ID])).get(CASE_ID) ?? [];
    expect(list).toHaveLength(1);
    expect(list[0].channel).toBe("whatsapp");
    expect(list[0].sentAt).toBe(sentAt);
    expect(list[0].couponRef).toBeNull();
    expect(store.all()[0].messageCount).toBe(1);
    expect(store.all()[0].lastMessageAt).toBe(sentAt);
  });

  it("C2. sent بلا sent_at ⇒ لا تدخل (الشرطان معًا مطلوبان)", async () => {
    const { store, gateway, dispatcher, caseRow } = await newHarness();
    await dispatcher.dispatch([caseRow], [outcomeFor(caseRow)]);
    gateway.markDelivery(gateway.deliveries[0].deliveryId, "sent", null);

    const s = await dispatcher.settle();

    expect(s.sent).toBe(0);
    expect((await store.listInterventions([CASE_ID])).get(CASE_ID)).toBeUndefined();
    expect(store.all()[0].messageCount).toBe(0);
  });
});

// ── D: إعادة تشغيل Cron ⇒ لا تكرار ─────────────────────────────────────

describe("D. idempotency عند تكرار الـcron", () => {
  it("D1. تسوية نفس delivery مرتين ⇒ تدخل واحد وmessageCount واحد", async () => {
    const { store, gateway, dispatcher, caseRow } = await newHarness();
    await dispatcher.dispatch([caseRow], [outcomeFor(caseRow)]);
    const sentAt = T0 + 5 * HOUR;
    gateway.markDelivery(gateway.deliveries[0].deliveryId, "sent", sentAt);

    const first = await dispatcher.settle();
    const second = await dispatcher.settle();

    expect(first.sent).toBe(1);
    expect(second.sent).toBe(0);
    expect(second.alreadySettled).toBe(1);
    const list = (await store.listInterventions([CASE_ID])).get(CASE_ID) ?? [];
    expect(list).toHaveLength(1);
    expect(store.all()[0].messageCount).toBe(1);
  });

  it("D2. dispatch مرتين لنفس (حالة + messageCount) ⇒ إشعار واحد", async () => {
    const { gateway, dispatcher, caseRow } = await newHarness();
    const first = await dispatcher.dispatch([caseRow], [outcomeFor(caseRow)]);
    const second = await dispatcher.dispatch([caseRow], [outcomeFor(caseRow)]);

    expect(first.queued).toBe(1);
    expect(second.queued).toBe(0);
    // The existing pending delivery is what blocks the second enqueue.
    expect(second.skippedAlreadyInFlight).toBe(1);
    expect(gateway.notifications).toHaveLength(1);
    expect(gateway.deliveries).toHaveLength(1);
  });

  it("D2b. تعارض المفتاح الحتمي يمنع التكرار حتى لو لم تظهر delivery بعد", async () => {
    const { gateway, dispatcher, caseRow } = await newHarness();
    await dispatcher.dispatch([caseRow], [outcomeFor(caseRow)]);
    // محاكاة سباق: الإشعار موجود لكن صف الـdelivery لم يُرَ بعد.
    gateway.deliveries = [];

    const second = await dispatcher.dispatch([caseRow], [outcomeFor(caseRow)]);

    expect(second.queued).toBe(0);
    expect(second.skippedDuplicate).toBe(1);
    expect(gateway.notifications).toHaveLength(1);
    expect(gateway.createCalls).toBe(2);
  });

  it("D3. dispatch لا يضاعف الرسالة إذا كان هناك delivery معلّق", async () => {
    const { gateway, dispatcher, caseRow } = await newHarness();
    await dispatcher.dispatch([caseRow], [outcomeFor(caseRow)]);
    const again = await dispatcher.dispatch([caseRow], [outcomeFor(caseRow)]);
    expect(again.skippedAlreadyInFlight).toBe(1);
    expect(gateway.notifications).toHaveLength(1);
  });
});

// ── E/F: فشل لا يسجّل تدخلًا ────────────────────────────────────────────

describe("E/F. حالات الفشل", () => {
  it("E. failed ⇒ لا تدخل ويُترك لـretry القائم", async () => {
    const { store, gateway, dispatcher, caseRow } = await newHarness();
    await dispatcher.dispatch([caseRow], [outcomeFor(caseRow)]);
    gateway.markDelivery(gateway.deliveries[0].deliveryId, "failed", null);

    const s = await dispatcher.settle();

    expect(s.sent).toBe(0);
    expect(s.failed).toBe(1);
    expect((await store.listInterventions([CASE_ID])).get(CASE_ID)).toBeUndefined();
    expect(store.all()[0].messageCount).toBe(0);
  });

  it("F. permanent_failed ⇒ لا تدخل", async () => {
    const { store, gateway, dispatcher, caseRow } = await newHarness();
    await dispatcher.dispatch([caseRow], [outcomeFor(caseRow)]);
    gateway.markDelivery(gateway.deliveries[0].deliveryId, "permanent_failed", null);

    const s = await dispatcher.settle();

    expect(s.sent).toBe(0);
    expect(s.permanentFailed).toBe(1);
    expect((await store.listInterventions([CASE_ID])).get(CASE_ID)).toBeUndefined();
  });
});

// ── G/H/I/J: إسناد الشراء يبقى كما هو ───────────────────────────────────

describe("G-J. recovered لا تُشتق من purchase وحده", () => {
  it("G. شراء طبيعي بلا تدخل ⇒ not recovered", () => {
    const c = baseCase({ status: "PURCHASED", purchaseRef: ORDER_ID, completedAt: T0 + 2 * HOUR });
    const m = computeMetrics([c], new Map(), new Map(), new Map([[ORDER_ID, T0 + 2 * HOUR]]));
    expect(m.recovered).toBe(0);
    expect(m.naturalConversions).toBe(1);
    expect(isVerifiedRecovery({ status: "PURCHASED", purchaseRef: ORDER_ID, orderCreatedAt: T0 + 2 * HOUR, interventions: [] })).toBe(false);
  });

  it("H. تدخل قبل الشراء ⇒ recovered", () => {
    const sentAt = T0 + HOUR;
    const c = baseCase({ status: "PURCHASED", purchaseRef: ORDER_ID, completedAt: T0 + 2 * HOUR });
    const interventions = new Map([[CASE_ID, [{ caseId: CASE_ID, channel: "whatsapp", sentAt, couponRef: null }]]]);
    const m = computeMetrics([c], new Map(), interventions, new Map([[ORDER_ID, T0 + 2 * HOUR]]));
    expect(m.recovered).toBe(1);
  });

  it("I. تدخل بعد الشراء ⇒ not recovered", () => {
    const orderAt = T0 + 2 * HOUR;
    const c = baseCase({ status: "PURCHASED", purchaseRef: ORDER_ID, completedAt: orderAt });
    const interventions = new Map([[CASE_ID, [{ caseId: CASE_ID, channel: "whatsapp", sentAt: orderAt + HOUR, couponRef: null }]]]);
    const m = computeMetrics([c], new Map(), interventions, new Map([[ORDER_ID, orderAt]]));
    expect(m.recovered).toBe(0);
  });

  it("J. تدخل حالة قديمة لا يُنسب لحالة أحدث", () => {
    const orderAt = T0 + 2 * HOUR;
    const oldCase = baseCase({ status: "PURCHASED", purchaseRef: ORDER_ID, completedAt: orderAt, firstDetectedAt: T0 - 10 * HOUR });
    const newCaseId = "33333333-3333-4333-8333-333333333333";
    const newCase = baseCase({ id: newCaseId, status: "PURCHASED", purchaseRef: ORDER_ID, completedAt: orderAt, firstDetectedAt: T0 + HOUR });
    // التدخل يخص الحالة القديمة فقط.
    const interventions = new Map([[CASE_ID, [{ caseId: CASE_ID, channel: "whatsapp", sentAt: T0 - 9 * HOUR, couponRef: null }]]]);
    const m = computeMetrics([oldCase, newCase], new Map(), interventions, new Map([[ORDER_ID, orderAt]]));
    expect(m.recovered).toBe(1);
    // الحالة الأحدث لا تملك تدخلًا خاصًا بها فلا تُنسب لها الاستعادة.
    expect(isVerifiedRecovery({ status: "PURCHASED", purchaseRef: ORDER_ID, orderCreatedAt: orderAt, interventions: [] })).toBe(false);
    expect(newCase.id).not.toBe(CASE_ID);
  });
});

// ── K: زائر مجهول ───────────────────────────────────────────────────────

describe("K. زائر مجهول", () => {
  it("K. لا رقم ولا customerId ⇒ لا إرسال إطلاقًا", async () => {
    const store = new InMemoryRecoveryStore();
    const gateway = new FakeGateway();
    const c = baseCase({ customerPhone: null, customerId: null });
    await store.create(c);
    const dispatcher = new RecoveryDispatcher(store, gateway, cfg, () => T0 + 30 * HOUR);

    // evaluateContact نفسها تمنع الإرسال (anonymous)
    const out = outcomeFor(c);
    expect(out.wouldSend).toBe(false);
    expect(out.suppressReason).toBe("anonymous");

    const summary = await dispatcher.dispatch([c], [out]);
    expect(summary.considered).toBe(0);
    expect(gateway.createCalls).toBe(0);
    expect(gateway.notifications).toHaveLength(0);
  });
});

// ── L: cooldown/maxMessages تعتمد على الإرسالات المؤكدة فقط ────────────

describe("L. cooldown وmaxMessages من الإرسالات المؤكدة", () => {
  it("L1. delivery معلقة = لا cooldown ⇒ يمكن جدولة أخرى", async () => {
    const { caseRow } = await newHarness();
    // آخر رسالة مؤكدة بعد أول تذكير ⇒ cooldown ساري
    const cooled = baseCase({ lastMessageAt: T0 + 29 * HOUR, messageCount: 1 });
    expect(outcomeFor(cooled).wouldSend).toBe(false);
    // بلا أي رسالة مؤكدة: لا يوجد cooldown رغم وجودdelivery معلقة
    expect(outcomeFor(caseRow).wouldSend).toBe(true);
  });

  it("L2. maxMessages يُحتسب من messageCount بعد التسوية فقط", async () => {
    const { store, gateway, caseRow } = await newHarness();
    const maxCfg: RecoveryConfig = { ...cfg, maxMessages: 1 };
    const d = new RecoveryDispatcher(store, gateway, maxCfg, () => T0 + 30 * HOUR);

    await d.dispatch([caseRow], [outcomeFor(caseRow)]);
    gateway.markDelivery(gateway.deliveries[0].deliveryId, "sent", T0 + 5 * HOUR);
    await d.settle();

    expect(store.all()[0].messageCount).toBe(1);
    // after the confirmed send the case has reached maxMessages
    const atMax = baseCase({ messageCount: 1, lastMessageAt: null });
    const out = evaluateContact(atMax, { now: T0 + 30 * HOUR }, maxCfg);
    expect(out.wouldSend).toBe(false);
    expect(out.suppressReason).toBe("max_messages");
  });

  it("L3. lastMessageAt = sent_at بالضبط (يبدأ منه الـcooldown)", async () => {
    const { store, gateway, dispatcher, caseRow } = await newHarness();
    await dispatcher.dispatch([caseRow], [outcomeFor(caseRow)]);
    const sentAt = T0 + 10 * HOUR;
    gateway.markDelivery(gateway.deliveries[0].deliveryId, "sent", sentAt);
    await dispatcher.settle();

    expect(store.all()[0].lastMessageAt).toBe(sentAt);
    const after = baseCase({ messageCount: 1, lastMessageAt: sentAt });
    const out = evaluateContact(after, { now: sentAt + 1 * HOUR }, cfg);
    expect(out.wouldSend).toBe(false);
    expect(out.suppressReason).toBe("cooldown");
  });
});

// ── المحتوى: لا عرض تجاري جديد ──────────────────────────────────────────

describe("محتوى الرسالة", () => {
  it("لا يذكر خصمًا ولا كوبونًا", () => {
    const { title, message } = buildRecoveryMessage(baseCase());
    expect(title.length).toBeGreaterThan(0);
    expect(message).not.toMatch(/%|كوبون|خصم/);
  });

  it("coupon_ref=null دائمًا حتى مع وجود اقتراح خصم", async () => {
    const { store, gateway, dispatcher } = await newHarness();
    const c = store.all()[0];
    // large cart + old case => DISCOUNT_ELIGIBLE decision with a discount proposal
    const eligible = baseCase({ cartValue: 500, firstDetectedAt: T0 - 40 * HOUR, messageCount: 1, lastMessageAt: T0 - 41 * HOUR, lastActivityAt: T0 - 40 * HOUR });
    const out = evaluateContact(eligible, { now: T0 + 30 * HOUR }, cfg);
    expect(out.decision).toBe("DISCOUNT_ELIGIBLE");
    expect(out.recommendedDiscount).not.toBeNull();

    await dispatcher.dispatch([eligible], [out]);
    gateway.markDelivery(gateway.deliveries[0].deliveryId, "sent", T0 + 5 * HOUR);
    await dispatcher.settle();

    const list = (await store.listInterventions([CASE_ID])).get(CASE_ID) ?? [];
    expect(list[0].couponRef).toBeNull();
    expect(gateway.notifications[0].message).not.toMatch(/%/);
    expect(c.messageCount).toBe(0);
  });
});

// ── N: الفجوات الأربع التي أُصلحت ─────────────────────────────────────────
// كل اختبار هنا كان يفشل قبل الإصلاح؛ هذا هو دليل الإصلاح نفسه.

describe("N1. التسوية لا تقيَّد بالحالات النشطة", () => {
  it("N1. رسالة مؤكَّدة بعد إغلاق الحالة بالشراء تُسجَّل رغم انتقال الحالة", async () => {
    const { store, gateway, dispatcher, caseRow } = await newHarness();
    await dispatcher.dispatch([caseRow], [outcomeFor(caseRow)]);
    const sentAt = T0 + 5 * HOUR;
    gateway.markDelivery(gateway.deliveries[0].deliveryId, "sent", sentAt);

    // الشراء أغلق الحالة قبل أن يقرأ الـcron صف التسليم: الحالة لم تعد نشطة.
    await store.update(CASE_ID, { status: "PURCHASED", purchaseRef: ORDER_ID });
    expect((await store.listActive()).map((c) => c.id)).not.toContain(CASE_ID);

    const s = await dispatcher.settle();

    expect(s.sent).toBe(1);
    const list = (await store.listInterventions([CASE_ID])).get(CASE_ID) ?? [];
    expect(list).toHaveLength(1);
    // interventionCount يبقى 1: الإرسال يسبق الشراء بساعة ⇒ استعادة موثّقة.
    const m = computeMetrics(
      await store.listAll(),
      new Map([[ORDER_ID, { total: 300, discount: 0 }]]),
      await store.listInterventions(),
      new Map([[ORDER_ID, T0 + 6 * HOUR]])
    );
    expect(m.recovered).toBe(1);
  });
});

describe("N2. عدّاد متعدّد الإرسالات في دورة واحدة", () => {
  it("N2. رسالتان مؤكَّدتان لنفس الحالة ⇒ messageCount=2 لا 1", async () => {
    const { store, gateway, dispatcher } = await newHarness();
    gateway.addDelivery({
      deliveryId: "d1",
      notificationId: "n-1",
      caseId: CASE_ID,
      channel: "whatsapp",
      status: "sent",
      sentAt: T0 + 5 * HOUR,
      expectedMessageCount: 1,
    });
    gateway.addDelivery({
      deliveryId: "d2",
      notificationId: "n-2",
      caseId: CASE_ID,
      channel: "whatsapp",
      status: "sent",
      sentAt: T0 + 9 * HOUR,
      expectedMessageCount: 2,
    });

    const s = await dispatcher.settle();

    expect(s.sent).toBe(2);
    const list = (await store.listInterventions([CASE_ID])).get(CASE_ID) ?? [];
    expect(list).toHaveLength(2);
    // القراءة القديمة كانت تكتب messageCount+1 من snapshot ثابت ⇒ 1 دائمًا.
    expect(store.all()[0].messageCount).toBe(2);
    expect(store.all()[0].lastMessageAt).toBe(T0 + 9 * HOUR);
  });

  it("N2b. طلب أقدم متأخر لا يُرجع العدّاد للخلف", async () => {
    const { store, gateway, dispatcher } = await newHarness();
    gateway.addDelivery({
      deliveryId: "d2",
      notificationId: "n-2",
      caseId: CASE_ID,
      channel: "whatsapp",
      status: "sent",
      sentAt: T0 + 9 * HOUR,
      expectedMessageCount: 2,
    });
    gateway.addDelivery({
      deliveryId: "d1",
      notificationId: "n-1",
      caseId: CASE_ID,
      channel: "whatsapp",
      status: "sent",
      sentAt: T0 + 5 * HOUR,
      expectedMessageCount: 1,
    });

    await dispatcher.settle();

    expect(store.all()[0].messageCount).toBe(2);
  });
});

describe("N3. intervention بلا عدّاد (انقطاع جزئي) يُصلَح ولا يتكرر", () => {
  it("N3. الـINSERT نجح ثم فشل تحديث العدّاد ⇒ الدورة التالية تُصلحه", async () => {
    const { store, gateway, dispatcher, caseRow } = await newHarness();
    await dispatcher.dispatch([caseRow], [outcomeFor(caseRow)]);
    const sentAt = T0 + 5 * HOUR;
    gateway.markDelivery(gateway.deliveries[0].deliveryId, "sent", sentAt);
    const notificationId = gateway.notifications[0].id;

    // انقطاع بعد حفظ التدخل وقبل تحديث messageCount.
    const orphan = await store.recordIntervention({
      id: deterministicAttemptId(notificationId, "whatsapp", sentAt),
      caseId: CASE_ID,
      channel: "whatsapp",
      sentAt,
      couponRef: null,
    });
    expect(orphan).toBe(true);
    expect(store.all()[0].messageCount).toBe(0);

    const s = await dispatcher.settle();

    // السلوك القديم كان يتخطّىها إلى الأبد لأن التدخل موجود.
    expect(s.counterRepaired).toBe(1);
    expect(store.all()[0].messageCount).toBe(1);
    expect(store.all()[0].lastMessageAt).toBe(sentAt);
    const list = (await store.listInterventions([CASE_ID])).get(CASE_ID) ?? [];
    expect(list).toHaveLength(1);

    // والدورة التالية لا تفعل شيئًا.
    const again = await dispatcher.settle();
    expect(again.alreadySettled).toBe(1);
    expect(store.all()[0].messageCount).toBe(1);
  });
});

describe("N4. طابع زمني مشترك لا يعني تكرارًا", () => {
  it("N4. deliveryان مختلفان بنفس sent_at ⇒ تدخلان", async () => {
    const { store, gateway, dispatcher } = await newHarness();
    const sentAt = T0 + 5 * HOUR;
    gateway.addDelivery({
      deliveryId: "d1",
      notificationId: "n-1",
      caseId: CASE_ID,
      channel: "whatsapp",
      status: "sent",
      sentAt,
      expectedMessageCount: 1,
    });
    gateway.addDelivery({
      deliveryId: "d2",
      notificationId: "n-2",
      caseId: CASE_ID,
      channel: "whatsapp",
      status: "sent",
      sentAt,
      expectedMessageCount: 2,
    });

    await dispatcher.settle();

    // المقارنة القديمة (case, channel, sentAt) كانت ستحسبهما واحدًا.
    const list = (await store.listInterventions([CASE_ID])).get(CASE_ID) ?? [];
    expect(list).toHaveLength(2);
    expect(store.all()[0].messageCount).toBe(2);
  });
});

describe("N5. صف سابق بلا recovery_expected_count", () => {
  it("N5. delivery قديم ⇒ current+1 مرة واحدة فقط", async () => {
    const { store, gateway, dispatcher } = await newHarness();
    gateway.addDelivery({
      deliveryId: "d1",
      notificationId: "n-legacy",
      caseId: CASE_ID,
      channel: "whatsapp",
      status: "sent",
      sentAt: T0 + 5 * HOUR,
    });

    const first = await dispatcher.settle();
    const second = await dispatcher.settle();

    expect(first.sent).toBe(1);
    expect(second.sent).toBe(0);
    expect(store.all()[0].messageCount).toBe(1);
  });
});

describe("N6. بوابة الهوية والهاتف", () => {
  it("N6. هاتف غير صالح دوليًا لا يُدرج ولا يُرسل", async () => {
    const store = new InMemoryRecoveryStore();
    const gateway = new FakeGateway();
    const c = baseCase({ customerPhone: "12" });
    await store.create(c);
    const dispatcher = new RecoveryDispatcher(store, gateway, cfg, () => T0 + 30 * HOUR);

    const s = await dispatcher.dispatch([c], [outcomeFor(c)]);

    expect(s.queued).toBe(0);
    expect(s.skippedInvalidPhone).toBe(1);
    expect(gateway.notifications).toHaveLength(0);
    expect(gateway.createCalls).toBe(0);
  });

  it("N6b. customerId=null مع وجود هاتف ⇒ لا تواصل (زائر مجهول)", async () => {
    const store = new InMemoryRecoveryStore();
    const gateway = new FakeGateway();
    const c = baseCase({ customerId: null });
    await store.create(c);
    const dispatcher = new RecoveryDispatcher(store, gateway, cfg, () => T0 + 30 * HOUR);

    const s = await dispatcher.dispatch([c], [outcomeFor(c)]);

    expect(s.queued).toBe(0);
    expect(s.skippedNoIdentity).toBe(1);
    expect(gateway.notifications).toHaveLength(0);
  });

  it("N6c. رقم صالح ⇒ يُدرج", async () => {
    const { gateway, dispatcher, caseRow } = await newHarness();
    const s = await dispatcher.dispatch([caseRow], [outcomeFor(caseRow)]);
    expect(s.queued).toBe(1);
    expect(gateway.notifications).toHaveLength(1);
  });
});

describe("N7. ترتيب الدورة في المسار", () => {
  it("N7. التسوية تُستدعى قبل حساب قرارات الدورة نفسها", () => {
    const src = readFileSync(join(process.cwd(), "app", "api", "recovery", "run", "route.ts"), "utf8");
    const settleAt = src.indexOf("dispatcher.settle()");
    // G4: دورة القرار صارت سلسلة الذكاء الجديدة (Evidence → … → Execution
    // Guard) بدل ContactOutcome القديم. الترتيب المقصود لم يتغيّر: التسوية
    // أولًا، ثم القراءة والقرار.
    const decideAt = src.indexOf("runRecoveryPipeline(");
    expect(settleAt).toBeGreaterThan(-1);
    expect(decideAt).toBeGreaterThan(-1);
    // المسار القديم لم يعد يُستشار في دورة التشغيل (لا مصدران متنافسان).
    expect(src).not.toContain("runDryRunCycle()");
    // لو انقلبا لعاد الخلل: القراءة تقرأ messageCount قديمًا فيرسل رسالة ثانية
    // فور تأكيد الأولى، ويتجاوز cooldown في الدورة نفسها.
    expect(settleAt).toBeLessThan(decideAt);
  });

  it("N7b. التسوية لا تمرّر قائمة الحالات النشطة", () => {
    const src = readFileSync(join(process.cwd(), "app", "api", "recovery", "run", "route.ts"), "utf8");
    // settle() بلا وسائط: النطاق يأتي من البوابة (كل الحالات)، لا من listActive.
    expect(src).toMatch(/dispatcher\.settle\(\)/);
    expect(src).not.toMatch(/settle\(activeCases\)|settle\(cases\)/);
  });
});

// ── T: ربط القوالب بمسار الإرسال (المرحلة 4) ──────────────────────────────

function stageP(over: Partial<RecoveryStage> = {}): RecoveryStage {
  return {
    key: "s1",
    nameAr: "مرحلة أولى",
    position: 1,
    delayMinutes: 30,
    templateId: null,
    isActive: true,
    isTerminal: false,
    maxTotalMessages: null,
    ...over,
  };
}

function templateT(over: Partial<DispatchTemplate> = {}): DispatchTemplate {
  return {
    id: 101,
    key: "welcome",
    nameAr: "ترحيب",
    title: "سلتك بانتظارك",
    body: "أهلاً {{customer.name}}، سلتك بقيمة {{cart.value_formatted}} ما زالت محفوظة.",
    isActive: true,
    version: 1,
    ...over,
  };
}

async function stagedHarness(stages: RecoveryStage[], templates: DispatchTemplate[]) {
  const store = new InMemoryRecoveryStore();
  const gateway = new FakeGateway();
  gateway.templates = templates;
  const c = baseCase();
  await store.create(c);
  const dispatcher = new RecoveryDispatcher(store, gateway, { ...cfg, stages }, () => T0 + 30 * HOUR);
  return { store, gateway, dispatcher, caseRow: c };
}

describe("T. ربط القوالب بمسار الإرسال", () => {
  it("T1. قالب المرحلة الصحيحة يُصيَّر من البيانات الفعلية ويُرسل به", async () => {
    const { store, gateway, dispatcher, caseRow } = await stagedHarness([stageP({ templateId: 101 })], [templateT()]);
    const out = outcomeFor(caseRow);
    expect(out.wouldSend).toBe(true);

    const s = await dispatcher.dispatch([caseRow], [out]);

    expect(s.queued).toBe(1);
    expect(s.skippedTemplateInvalid).toBe(0);
    expect(gateway.notifications).toHaveLength(1);
    // العنوان من القالب، والرسالة من بيانات الحالة الحقيقية.
    expect(gateway.notifications[0].title).toBe("سلتك بانتظارك");
    expect(gateway.notifications[0].message).toContain("عميلنا");
    expect(gateway.notifications[0].message).toContain("250");
    // لا تدخل ولا عدّاد عند الجدولة (دلالات settled كما هي).
    expect((await store.listInterventions([CASE_ID])).get(CASE_ID)).toBeUndefined();
    expect(store.all()[0].messageCount).toBe(0);
  });

  it("T2. متغيرات حالة أخرى تصل للرسالة (المنتج/السلة)", async () => {
    const { gateway, dispatcher } = await stagedHarness(
      [stageP({ templateId: 101 })],
      [templateT({ body: "منتجك {{product.slug}} بقيمة {{cart.value}}" })],
    );
    await dispatcher.dispatch([baseCase()], [outcomeFor(baseCase())]);

    expect(gateway.notifications).toHaveLength(1);
    expect(gateway.notifications[0].message).toContain("product-1");
    expect(gateway.notifications[0].message).toContain("250");
  });

  it("T3. قالب مفقود (المرحلة مرتبطة بمعرّف غير موجود) ⇒ لا إرسال", async () => {
    const { gateway, dispatcher, caseRow } = await stagedHarness([stageP({ templateId: 404 })], [templateT()]);

    const s = await dispatcher.dispatch([caseRow], [outcomeFor(caseRow)]);

    expect(s.queued).toBe(0);
    expect(s.skippedTemplateMissing).toBe(1);
    expect(gateway.notifications).toHaveLength(0);
    expect(gateway.createCalls).toBe(0);
  });

  it("T4. قالب غير مفعّل ⇒ لا إرسال", async () => {
    const { gateway, dispatcher, caseRow } = await stagedHarness(
      [stageP({ templateId: 101 })],
      [templateT({ isActive: false })],
    );

    const s = await dispatcher.dispatch([caseRow], [outcomeFor(caseRow)]);

    expect(s.queued).toBe(0);
    expect(s.skippedTemplateInvalid).toBe(1);
    expect(gateway.notifications).toHaveLength(0);
  });

  it("T5. قالب معطوب (متغير غير معروف) ⇒ لا إرسال", async () => {
    const { gateway, dispatcher, caseRow } = await stagedHarness(
      [stageP({ templateId: 101 })],
      [templateT({ body: "مرحباً {{not_in_dict}}" })],
    );

    const s = await dispatcher.dispatch([caseRow], [outcomeFor(caseRow)]);

    expect(s.queued).toBe(0);
    expect(s.skippedTemplateInvalid).toBe(1);
    expect(gateway.notifications).toHaveLength(0);
  });

  it("T6. رسالة تنتج فارغة (كلها متغير خصم داخلي) ⇒ لا إرسال", async () => {
    const { gateway, dispatcher, caseRow } = await stagedHarness(
      [stageP({ templateId: 101 })],
      [templateT({ body: "{{discount.percent}}" })],
    );

    const s = await dispatcher.dispatch([caseRow], [outcomeFor(caseRow)]);

    expect(s.queued).toBe(0);
    expect(s.skippedTemplateRender).toBe(1);
    expect(gateway.notifications).toHaveLength(0);
  });

  it("T7. مرحلة بلا قالب ⇒ الرسالة الافتراضية المحايدة كما كانت", async () => {
    const { gateway, dispatcher, caseRow } = await stagedHarness([stageP({ templateId: null })], []);

    const s = await dispatcher.dispatch([caseRow], [outcomeFor(caseRow)]);

    expect(s.queued).toBe(1);
    expect(gateway.notifications).toHaveLength(1);
    expect(gateway.notifications[0].message).toBe(buildRecoveryMessage(caseRow).message);
    expect(gateway.notifications[0].message).not.toMatch(/%|كوبون|خصم/);
  });

  it("T8. قالب فعّال سليم مع نص يذكر الخصم الداخلي ⇒ لا يصل للعميل", async () => {
    const { gateway, dispatcher, caseRow } = await stagedHarness(
      [stageP({ templateId: 101 })],
      [templateT({ body: "تذكير سلة بقيمة {{cart.value}}. خصمك المقترح {{discount.percent}}." })],
    );
    await dispatcher.dispatch([caseRow], [outcomeFor(caseRow)]);

    expect(gateway.notifications).toHaveLength(1);
    // internal discount token يُحذف من مسار العميل ويُسجَّل — لا يصل الرقم ولا %.
    expect(gateway.notifications[0].message).toContain("250");
    expect(gateway.notifications[0].message).not.toMatch(/%/);
    expect(gateway.notifications[0].message).not.toContain("discount");
  });

  it("T9. لا مراحل محددة ⇒ fail-safe بلا إرسال", async () => {
    const { gateway, dispatcher, caseRow } = await stagedHarness([], []);

    const s = await dispatcher.dispatch([caseRow], [outcomeFor(caseRow)]);

    expect(s.queued).toBe(0);
    expect(s.skippedNoStage).toBe(1);
    expect(gateway.notifications).toHaveLength(0);
  });
});

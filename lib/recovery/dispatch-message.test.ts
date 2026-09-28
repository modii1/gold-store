/**
 * اختبارات بناء رسالة الإرسال من المرحلة والقالب (المرحلة 4).
 *
 * وحدة نقية: لا اتصال، لا قاعدة بيانات، لا enqueue ولا WhatsApp. تثبت:
 *   - اختيار قالب المرحلة الصحيحة وتصييره من بيانات الحالة الفعلية.
 *   - fail-safe لكل حالات الفشل (بلا مرحلة / قالب مفقود / معطوب / مغلق /
 *     متغيرات غير معروفة / رسالة فارغة ناتجة) ⇒ لا إرسال.
 *   - مرحلة بلا قالب ⇒ الرسالة الافتراضية المحايدة كما كانت.
 *   - المتغيرات الداخلية (discount.*) لا تصل للعميل إطلاقًا.
 *   - الترجمة العربية للقرار (recovery.decision_ar).
 */

import { describe, it, expect } from "vitest";
import { buildDefaultRecoveryMessage, buildDispatchMessage, decisionLabelAr, renderDispatchTrace } from "./dispatch-message";
import type { DispatchTemplate } from "./dispatch-message";
import type { RecoveryCase } from "./types";
import type { RecoveryStage } from "./stages";

const T0 = 1_700_000_000_000;
const MSG = {
  id: "22222222-2222-4222-8222-222222222222",
  customerId: "cust-1",
  customerPhone: "966533220646",
  visitorId: "v-1",
  sessionId: "s-1",
  caseType: "ADD_TO_CART" as const,
  status: "OPEN" as const,
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
};

function baseCase(over: Partial<RecoveryCase> = {}): RecoveryCase {
  return { ...MSG, ...over } as RecoveryCase;
}

function stageP(position: number, over: Partial<RecoveryStage> = {}): RecoveryStage {
  return {
    key: `s-${position}`,
    nameAr: `مرحلة ${position}`,
    position,
    delayMinutes: 30 * position,
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

describe("buildDispatchMessage — المسار السعيد", () => {
  it("يختار قالب المرحلة الصحيحة (messageCount = فهرس المرحلة) والمتغيرات من بيانات حقيقية", () => {
    const c = baseCase();
    const stages = [stageP(1, { templateId: 101 }), stageP(2, { templateId: 202 })];
    const templates: DispatchTemplate[] = [
      templateT({ id: 101, nameAr: "أولى", body: "الأولى: سلة {{cart.value}}" }),
      templateT({ id: 202, nameAr: "ثانية", body: "الثانية: منتجك {{product.slug}}" }),
    ];

    const first = buildDispatchMessage({ case: c, stages, templates });
    expect(first.status).toBe("send");
    if (first.status === "send") {
      expect(first.usedTemplate).toBe(true);
      expect(first.title).toBe("سلتك بانتظارك");
      expect(first.message).toContain("250");
    }

    const second = buildDispatchMessage({ case: { ...c, messageCount: 1 }, stages, templates });
    expect(second.status).toBe("send");
    if (second.status === "send") {
      expect(second.message).toContain("product-1");
    }
  });

  it("بلا قالب مربوط ⇒ الرسالة الافتراضية المحايدة (usedTemplate=false)", () => {
    const c = baseCase();
    const stages = [stageP(1, { templateId: null })];
    const out = buildDispatchMessage({ case: c, stages, templates: [] });

    expect(out.status).toBe("send");
    if (out.status === "send") {
      expect(out.usedTemplate).toBe(false);
      expect(out.title).toBe(buildDefaultRecoveryMessage(c).title);
      expect(out.message).toBe(buildDefaultRecoveryMessage(c).message);
    }
  });

  it("العنوان من القالب عند وجوده وخلاف ذلك العنوان الافتراضي", () => {
    const stages = [stageP(1, { templateId: 101 })];
    expect(buildDispatchMessage({ case: baseCase(), stages, templates: [templateT({ title: "" })] })).toMatchObject(
      { status: "send", title: "سلتك ما زالت محفوظة" },
    );
    expect(buildDispatchMessage({ case: baseCase(), stages, templates: [templateT({ title: "عنوان خاص" })] })).toMatchObject(
      { status: "send", title: "عنوان خاص" },
    );
  });
});

describe("buildDispatchMessage — fail-safe (بلا إرسال)", () => {
  const sent = (o: { status: string }): boolean => o.status === "send";

  it("بلا مراحل محددة ⇒ no_stage", () => {
    const out = buildDispatchMessage({ case: baseCase(), stages: [], templates: [] });
    expect(sent(out)).toBe(false);
    expect(out).toMatchObject({ status: "block", reason: "no_stage" });
  });

  it("messageCount خارج نطاق المراحل ⇒ no_stage (لا اختراع مرحلة)", () => {
    const stages = [stageP(1, { templateId: 101 })];
    const out = buildDispatchMessage({ case: baseCase({ messageCount: 5 }), stages, templates: [templateT()] });
    expect(sent(out)).toBe(false);
    expect(out).toMatchObject({ status: "block", reason: "no_stage" });
  });

  it("مرحلة مرتبطة بقالب غير موجود ⇒ template_missing", () => {
    const stages = [stageP(1, { templateId: 404 })];
    const out = buildDispatchMessage({ case: baseCase(), stages, templates: [templateT()] });
    expect(sent(out)).toBe(false);
    expect(out).toMatchObject({ status: "block", reason: "template_missing" });
  });

  it("قالب غير مفعّل ⇒ template_inactive", () => {
    const stages = [stageP(1, { templateId: 101 })];
    const out = buildDispatchMessage({ case: baseCase(), stages, templates: [templateT({ isActive: false })] });
    expect(sent(out)).toBe(false);
    expect(out).toMatchObject({ status: "block", reason: "template_inactive" });
  });

  it("قالب معطوب (متغير غير معروف) ⇒ template_invalid", () => {
    const stages = [stageP(1, { templateId: 101 })];
    const out = buildDispatchMessage({ case: baseCase(), stages, templates: [templateT({ body: "مرحباً {{not_in_dict}}" })] });
    expect(sent(out)).toBe(false);
    expect(out).toMatchObject({ status: "block", reason: "template_invalid" });
  });

  it("قالب معطوب (نص فارغ) ⇒ template_invalid", () => {
    const stages = [stageP(1, { templateId: 101 })];
    const out = buildDispatchMessage({ case: baseCase(), stages, templates: [templateT({ body: "   " })] });
    expect(sent(out)).toBe(false);
    expect(out).toMatchObject({ status: "block", reason: "template_invalid" });
  });

  it("رسالة تنتج فارغة بعد التصيير (كلها خصم داخلي) ⇒ empty_message", () => {
    const stages = [stageP(1, { templateId: 101 })];
    const out = buildDispatchMessage({ case: baseCase(), stages, templates: [templateT({ body: "{{discount.percent}}" })] });
    expect(sent(out)).toBe(false);
    expect(out).toMatchObject({ status: "block", reason: "empty_message" });
  });
});

describe("المتغيرات والمسار الداخلي", () => {
  it("قيم المتغيرات مبنية من الحالة الفعلية (لا مثال ولا نخمين)", () => {
    const c = baseCase();
    const stages = [stageP(1, { templateId: 101, nameAr: "تذكير أول" }), stageP(2, { templateId: 101 })];
    const trace = renderDispatchTrace({ case: c, stages, templates: [templateT()] });

    expect(trace).not.toBeNull();
    const values = trace?.values ?? {};
    expect(values["cart.value"]).toBe("250");
    expect(values["product.slug"]).toBe("product-1");
    expect(values["recovery.stage_name"]).toBe("تذكير أول");
    expect(values["recovery.stage_index"]).toBe("1");
    expect(values["recovery.stage_total"]).toBe("2");
    expect(values["message.count"]).toBe("0");
    expect(values["message.is_first"]).toBe("نعم");
    // قيم فعلية من البيانات: fromData=true للقيم المقدَّمة.
    const cartUse = trace?.render.used.find((u) => u.name === "cart.value_formatted");
    expect(cartUse?.fromData).toBe(true);
  });

  it("discount.* داخلي في مسار العميل — يُحذف من النص ويُسجَّل", () => {
    const c = baseCase({ cartValue: 500 });
    const stages = [stageP(1, { templateId: 101 })];
    const out = buildDispatchMessage({
      case: c,
      stages,
      templates: [templateT({ body: "سلتك {{cart.value}}. خصمك المقترح {{discount.percent}}." })],
      discount: { percent: 10, cap: 50, value: 50 },
    });

    expect(out.status).toBe("send");
    if (out.status === "send") {
      expect(out.message).toContain("500");
      expect(out.message).not.toMatch(/%/);
      expect(out.message).not.toContain("discount");
    }
    const trace = renderDispatchTrace({ case: c, stages, templates: [templateT({ body: "{{discount.percent}}" })] });
    expect(trace?.render.blockedInternal).toContain("discount.percent");
  });
});

describe("decisionLabelAr", () => {
  it("يترجم قرارات المحرك إلى العربية", () => {
    expect(decisionLabelAr("REMINDER_ONLY")).toBe("تذكير فقط");
    expect(decisionLabelAr("DISCOUNT_ELIGIBLE")).toBe("مؤهل للخصم");
    expect(decisionLabelAr("NO_INCENTIVE")).toBe("بلا حافز");
    expect(decisionLabelAr(null)).toBe("");
  });

  it("recovery.decision_ar في العديم القيم من القرار الفعلي", () => {
    const c = baseCase();
    const stages = [stageP(1, { templateId: 101 })];
    const values = renderDispatchTrace({
      case: c,
      stages,
      templates: [templateT()],
      decisionAr: decisionLabelAr("REMINDER_ONLY"),
    })?.values;
    expect(values?.["recovery.decision_ar"]).toBe("تذكير فقط");
  });
});
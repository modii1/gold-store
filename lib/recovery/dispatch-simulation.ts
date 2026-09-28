/**
 * محاكاة مسار الإرسال — Preview/Simulation (المرحلة 4).
 *
 * تُظهر ما سيفعله dispatcher فعليًا بحالة حقيقية، عبر نفس القطعة
 * (buildDispatchMessage) ونفس البوابات: القرار → الهوية → الهاتف → قيد
 * التسليم (in-flight) → القالب. بلا أي كتابة: لا enqueue، لا إنشاء
 * إشعار، لا تمرير لأي قناة.
 *
 * «ما يُعرض هنا هو ما سيُرسَل فعلًا، وما يُمنع هنا لا يصل للجدولة» —
 * لئلا تخالف المحاكاةُ الواقعَ.
 */

import { buildRecoveryVariables, renderTemplate } from "./variables";
import type { RenderResult } from "./variables";
import { buildDispatchMessage, decisionLabelAr } from "./dispatch-message";
import type { DispatchMessageBlockReason, DispatchTemplate } from "./dispatch-message";
import { selectStageAt } from "./stages";
import type { RecoveryStage } from "./stages";
import { evaluateContact } from "./decisions";
import { normalizePhoneInternational } from "@/lib/format";
import type { RecoveryConfig } from "./config";
import type { ContactOutcome, RecoveryCase } from "./types";

export type DispatchSimulationGate =
  | "would_not_send"
  | "no_identity"
  | "invalid_phone"
  | "in_flight"
  | DispatchMessageBlockReason
  | "ready";

export type DispatchSimulation = {
  caseId: string;
  customerMasked: string | null;
  caseType: RecoveryCase["caseType"];
  status: RecoveryCase["status"];
  cartValue: number | null;
  messageCount: number;
  outcome: ContactOutcome;
  decisionLabelAr: string;
  /** المرحلة المختارة للحالة (فهرس = messageCount). */
  stage: RecoveryStage | null;
  stageIndex: number | null;
  stageTotal: number;
  /** القالب المربوط بالمرحلة (إن وُجد) — أو null إن لا قالب/مفقود. */
  template: DispatchTemplate | null;
  /** القيم الفعلية للمتغيرات (null إن لم يُبنَ قالب). */
  values: Record<string, string> | null;
  /** التصيير بمسار العميل (null إن لم يُبنَ قالب). */
  render: RenderResult | null;
  finalTitle: string;
  finalMessage: string;
  allow: boolean;
  gate: DispatchSimulationGate;
  reasonAr: string;
};

function gateReasonAr(gate: DispatchSimulationGate, outcome: ContactOutcome): string {
  switch (gate) {
    case "would_not_send":
      return outcome.recommendedAction;
    case "no_identity":
      return "زائر بلا هوية موثوقة (بلا customerId) — لا تواصل.";
    case "invalid_phone":
      return "رقم الهاتف غير صالح دوليًا — لا إدراج أصلًا.";
    case "in_flight":
      return "يوجد إشعار قيد التسليم غير مؤكَّد لهذه الحالة — لا رسالة ثانية.";
    default:
      return gate;
  }
}

/**
 * محاكاة حالة واحدة — البوابات تُحاسب بالترتيب نفسه في dispatch():
 *   1) القرار (wouldSend)   2) الهوية/الهاتف   3) delivery غير مؤكَّد   4) القالب.
 *
 * @param inFlight معرّفات الحالات التي لديها delivery غير مؤكَّد — يُحسب من
 *   قراءة حقيقية للمسار (listRecoveryDeliveries) خارج هذه الدالة.
 */
export function simulateDispatch(
  c: RecoveryCase,
  cfg: RecoveryConfig,
  templates: DispatchTemplate[],
  inFlight: Set<string>,
  now: number,
): DispatchSimulation {
  const outcome = evaluateContact(c, { now }, cfg);
  const outcomeLabel = decisionLabelAr(outcome.decision);

  const stage = selectStageAt(cfg.stages, c.messageCount);
  const template =
    stage && stage.templateId !== null ? templates.find((t) => t.id === stage.templateId) ?? null : null;

  const base = {
    caseId: c.id,
    customerMasked: maskLocal(c.customerPhone),
    caseType: c.caseType,
    status: c.status,
    cartValue: c.cartValue,
    messageCount: c.messageCount,
    outcome,
    decisionLabelAr: outcomeLabel,
    stage,
    stageIndex: stage ? stage.position : null,
    stageTotal: cfg.stages.length,
    template,
  };

  // بوابة 1: القرار نفسه يمنع.
  if (!outcome.wouldSend) {
    return { ...base, values: null, render: null, finalTitle: "", finalMessage: "", allow: false, gate: "would_not_send", reasonAr: gateReasonAr("would_not_send", outcome) };
  }
  // بوابة 2: الهوية والهاتف — كما في dispatch حرفيًا.
  if (!c.customerId || !c.customerPhone) {
    return { ...base, values: null, render: null, finalTitle: "", finalMessage: "", allow: false, gate: "no_identity", reasonAr: gateReasonAr("no_identity", outcome) };
  }
  if (!normalizePhoneInternational(c.customerPhone)) {
    return { ...base, values: null, render: null, finalTitle: "", finalMessage: "", allow: false, gate: "invalid_phone", reasonAr: gateReasonAr("invalid_phone", outcome) };
  }
  // بوابة 3: إشعار غير مؤكَّد قيد التسليم.
  if (inFlight.has(c.id)) {
    return { ...base, values: null, render: null, finalTitle: "", finalMessage: "", allow: false, gate: "in_flight", reasonAr: gateReasonAr("in_flight", outcome) };
  }

  // القيم والتصيير (للعرض) — نُحسب قبل القرار القالبي ليعرض «ما سيبني».
  const values = stage
    ? buildRecoveryVariables({
        case: c,
        stage,
        stageIndex: stage.position,
        stageTotal: cfg.stages.length,
        discount: outcome.recommendedDiscount,
        now,
        expiryHours: cfg.expiryHours,
        decisionAr: outcomeLabel,
      })
    : null;
  const render = template && values ? renderTemplate(template.body, values) : null;

  // بوابة 4: القالب — نفس buildDispatchMessage التي يستخدمها الإرسال فعلًا.
  const built = buildDispatchMessage({
    case: c,
    stages: cfg.stages,
    templates,
    discount: outcome.recommendedDiscount,
    now,
    expiryHours: cfg.expiryHours,
    decisionAr: outcomeLabel,
  });

  if (built.status === "block") {
    return { ...base, values, render, finalTitle: "", finalMessage: "", allow: false, gate: built.reason, reasonAr: built.reasonAr };
  }

  return {
    ...base,
    values,
    render,
    finalTitle: built.title,
    finalMessage: built.message,
    allow: true,
    gate: "ready",
    reasonAr: "الرسالة جاهزة — ستُجدول عبر المسار القائم عند استيفاء الشروط.",
  };
}

function maskLocal(phone: string | null): string | null {
  if (!phone) return null;
  const p = String(phone);
  if (p.length <= 4) return p;
  return `***${p.slice(-4)}`;
}

/** حالة استعراضية افتراضية (بلا أي بيانات قاعدة) لرؤية المسار بلا حالات. */
export function sampleRecoveryCase(now: number): RecoveryCase {
  return {
    id: "aaaa0000-0000-4000-8000-000000000001",
    customerId: "cust-demo",
    customerPhone: "966500000001",
    visitorId: "v-demo",
    sessionId: "s-demo",
    caseType: "ADD_TO_CART",
    status: "OPEN",
    score: 40,
    cartValue: 249,
    productIds: ["p-demo"],
    preferredProductId: "p-demo",
    preferredProductSlug: "mini-bag",
    firstDetectedAt: now - 2 * 3_600_000,
    lastActivityAt: now - 2 * 3_600_000,
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
    createdAt: now - 2 * 3_600_000,
    updatedAt: now - 2 * 3_600_000,
  };
}
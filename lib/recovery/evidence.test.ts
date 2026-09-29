/**
 * Phase 1 — اختبارات طبقة الأدلة (analytics_events ← نية وثقة).
 *
 * Fixtures محلية فقط: لا أي اتصال بقاعدة بيانات الإنتاج.
 * التركيز: منع العدّ المزدوج بنيويًا، فصل الملاحظة عن الاستنتاج،
 * حماية timestamps، والمصادرات الزمنية، وعبر permuting الحالات A..R
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_RECOVERY_CONFIG } from "./config";
import type { CaseType } from "./types";
import {
  buildRecoveryEvidence,
  collectRecoveryEvidence,
  defaultEvidenceWindowHours,
  describeRecoveryEvidence,
  evaluateRecoveryIntelligence,
  toConfidenceEvidence,
  toIntentEvidence,
  type AnalyticsEventRow,
  type IntelligenceContext,
  type RecoveryEvidence,
} from "./evidence";

const cfg = { ...DEFAULT_RECOVERY_CONFIG, enabled: true, dryRun: true };
const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const H = 3600_000;

let seq = 0;
function ev(
  type: string,
  session: string,
  o: { product?: string | null; ts?: number; meta?: Record<string, unknown>; createdAt?: string | number | Date } = {}
): AnalyticsEventRow {
  seq++;
  return {
    id: `e${seq}`,
    visitor_id: "visitor-v1",
    session_id: session,
    event_type: type,
    page_path: null,
    product_id: o.product ?? null,
    product_slug: o.product ? `slug-${o.product}` : null,
    referrer: null,
    device_type: "desktop",
    metadata: o.meta ?? {},
    created_at: o.createdAt !== undefined ? o.createdAt : new Date(o.ts ?? NOW).toISOString(),
  };
}

function ctx(over: Partial<Omit<IntelligenceContext, "caseType">> & { caseType?: CaseType } = {}): IntelligenceContext {
  return { caseType: "ADD_TO_CART", preferredProductId: "p1", caseCartValue: null, identity: "anonymous", ...over };
}

describe("evidence — Defaults & window", () => {
  it("النافذة الافتراضية = أقصى (expiryHours, scoreDecayHours)", () => {
    expect(defaultEvidenceWindowHours(cfg)).toBe(Math.max(cfg.expiryHours, cfg.scoreDecayHours));
  });

  it("windowHours قابل للضبط ويقصّ الأحداث الأقدم", () => {
    const rows = [ev("product_view", "s1", { product: "p1", ts: NOW - 10 * H }), ev("product_view", "s2", { product: "p1", ts: NOW - 2 * H })];
    const wide = buildRecoveryEvidence(rows, { asOf: NOW, windowHours: 168 }, cfg);
    const narrow = buildRecoveryEvidence(rows, { asOf: NOW, windowHours: 6 }, cfg);
    expect(wide.observations.uniqueSessions).toBe(2);
    expect(narrow.observations.uniqueSessions).toBe(1);
    expect(narrow.coverage.dropped.outsideWindow).toBe(1);
  });
});

describe("evidence — A..F مسارات فردية", () => {
  it("A. browsing فقط: 3 جلسات بمعاينة واحدة ⇒ repeatedViews=2 لا 3", () => {
    const rows = [
      ev("product_view", "s1", { product: "p1", ts: NOW - 3 * H }),
      ev("product_view", "s2", { product: "p1", ts: NOW - 2 * H }),
      ev("product_view", "s3", { product: "p1", ts: NOW - H }),
      ev("page_view", "s1", { ts: NOW - 3 * H }),
    ];
    const r = evaluateRecoveryIntelligence(rows, ctx(), cfg, { asOf: NOW });
    expect(r.evidence.observations.eventCounts.product_view).toBe(3);
    expect(r.evidence.observations.uniqueSessions).toBe(3);
    expect(r.evidence.inference.repeatedProductInterest).toBe(true);
    expect(r.intentEvidence.repeatedViews).toBe(2);
    expect(r.intentEvidence.sessions).toBe(3);
    expect(r.intentEvidence.recencyHours).toBe(1);
    expect(r.evidence.coverage.dropped.unsupportedType).toBe(1);
    expect(r.evidence.coverage.eventsRead).toBe(4);
    expect(r.evidence.coverage.eventsUsed).toBe(3);
  });

  it("B. معاينات متكررة في نفس الجلسة: 5 معاينات ⇒ زوج واحد لا 5", () => {
    const rows = Array.from({ length: 5 }, (_, i) => ev("product_view", "s1", { product: "p1", ts: NOW - i * 60000 }));
    const r = evaluateRecoveryIntelligence(rows, ctx(), cfg, { asOf: NOW });
    expect(r.evidence.observations.eventCounts.product_view).toBe(5);
    expect(r.intentEvidence.repeatedViews).toBe(1);
    expect(r.intentEvidence.sessions).toBe(1);
    expect(r.confidenceEvidence.signalCount).toBe(1);
  });

  it("C. معاينة عبر 3 جلسات: repeatedViews = 2 (جلسات ما بعد الأولى)", () => {
    const rows = [
      ev("product_view", "s1", { product: "p1", ts: NOW - 2 * H }),
      ev("product_view", "s2", { product: "p1", ts: NOW - H }),
      ev("product_view", "s3", { product: "p1", ts: NOW - 30 * 60000 }),
    ];
    const r = evaluateRecoveryIntelligence(rows, ctx(), cfg, { asOf: NOW });
    expect(r.intentEvidence.repeatedViews).toBe(2);
    expect(r.intentEvidence.sessions).toBe(3);
    expect(r.evidence.inference.repeatedProductInterest).toBe(true);
  });

  it("D. إضافة للسلة: qty ليست قيمة سلة أبدًا (لا تضخيم)", () => {
    const rows = [ev("product_view", "s1", { product: "p1", ts: NOW - H }), ev("add_to_cart", "s1", { product: "p1", ts: NOW - 30 * 60000, meta: { qty: 2 } })];
    const r = evaluateRecoveryIntelligence(rows, ctx(), cfg, { asOf: NOW });
    expect(r.evidence.observations.cartValue).toBeNull();
    expect(r.evidence.inference.addToCartReached).toBe(true);
    expect(r.confidenceEvidence.hasCartValue).toBe(false);
    expect(r.confidence.reasons).toContain("no_cart_value");
    expect(r.intent.score).toBe(19);
    expect(r.intent.level).toBe("VERY_LOW"); // 19 < عتبة 30
  });

  it("E. checkout: subtotal = قيمة السلة الموثقة", () => {
    const rows = [
      ev("product_view", "s1", { product: "p1", ts: NOW - 2 * H }),
      ev("add_to_cart", "s1", { product: "p1", ts: NOW - 90 * 60000 }),
      ev("checkout_start", "s1", { product: null, ts: NOW - 10 * 60000, meta: { subtotal: 250 } }),
    ];
    const r = evaluateRecoveryIntelligence(rows, ctx({ caseType: "CHECKOUT_STARTED" }), cfg, { asOf: NOW });
    expect(r.evidence.observations.cartValue).toBe(250);
    expect(r.evidence.inference.checkoutReached).toBe(true);
    expect(r.intent.strongSignal).toBe(true);
    expect(r.intent.score).toBe(50);
    expect(r.intent.level).toBe("MEDIUM");
    expect(r.confidenceEvidence.hasCartValue).toBe(true);
  });

  it("F. payment_started: إشارة الدفع تدعمها الطبقة (سماها النظام Allow)، بلا اختراع قيم", () => {
    const rows = [
      ev("product_view", "s1", { product: "p1", ts: NOW - 2 * H }),
      ev("add_to_cart", "s1", { product: "p1", ts: NOW - 90 * 60000 }),
      ev("checkout_start", "s1", { product: null, ts: NOW - 15 * 60000, meta: { subtotal: 250 } }),
      ev("payment_started", "s1", { product: null, ts: NOW - 5 * 60000 }),
    ];
    const r = evaluateRecoveryIntelligence(rows, ctx({ caseType: "PAYMENT_STARTED" }), cfg, { asOf: NOW });
    expect(r.evidence.observations.eventCounts.payment_started).toBe(1);
    expect(r.intent.strongSignal).toBe(true);
    expect(r.intent.score).toBe(70);
    expect(r.intent.level).toBe("HIGH");
  });
});

describe("evidence — تفسير كامل G", () => {
  it("G. تسلسل نية عالية: 3 جلسات معاينة + إضافتان + إتمام (عميل معرّف)", () => {
    const rows = [
      ev("product_view", "s1", { product: "p1", ts: NOW - 3 * H }),
      ev("product_view", "s2", { product: "p1", ts: NOW - 2 * H }),
      ev("product_view", "s3", { product: "p1", ts: NOW - 90 * 60000 }),
      ev("add_to_cart", "s4", { product: "p1", ts: NOW - 70 * 60000 }),
      ev("add_to_cart", "s3", { product: "p1", ts: NOW - 60 * 60000 }),
      ev("checkout_start", "s3", { product: null, ts: NOW - 15 * 60000, meta: { subtotal: 420 } }),
    ];
    const r = evaluateRecoveryIntelligence(rows, ctx({ caseType: "CHECKOUT_STARTED", identity: "logged_in" }), cfg, { asOf: NOW });
    const o = r.evidence.observations;
    expect(o.uniqueSessions).toBe(4);
    expect(o.signalDistinctPairs).toBe(6);
    expect(o.cartValue).toBe(420);
    expect(r.intentEvidence.repeatedViews).toBe(2);
    expect(r.intent.score).toBe(73);
    expect(r.intent.level).toBe("HIGH");
    expect(r.confidence.score).toBe(100);
    expect(r.confidence.level).toBe("HIGH");
    expect(r.confidence.reasons).toContain("identified");
    const lines = describeRecoveryEvidence(r.evidence);
    expect(lines.join(" ")).toMatch(/جلسات مميّزة/);
    expect(lines.join(" ")).toMatch(/ثقة/);
  });
});

describe("evidence — H..Q حماية زمنية ومصادرات", () => {
  it("H. عميل قديم: كل الأحداث خارج النافذة ⇒ recency = عرض النافذة لا لانهاية", () => {
    const rows = [ev("product_view", "s1", { product: "p1", ts: NOW - 240 * H })];
    const r = evaluateRecoveryIntelligence(rows, ctx(), cfg, { asOf: NOW });
    expect(r.evidence.coverage.dropped.outsideWindow).toBe(1);
    expect(r.intentEvidence.recencyHours).toBe(defaultEvidenceWindowHours(cfg));
    expect(r.evidence.observations.uniqueSessions).toBe(0);
    expect(r.intent.score).toBe(4);
    expect(r.intent.level).toBe("VERY_LOW");
    expect(r.confidence.reasons).toContain("stale");
  });

  it("I. زائر مجهول: الهوية لا تُستنتج من analytics أبدًا", () => {
    const rows = [ev("product_view", "s1", { product: "p1", ts: NOW - H })];
    const anon = evaluateRecoveryIntelligence(rows, ctx({ identity: "unknown" }), cfg, { asOf: NOW });
    expect(anon.confidenceEvidence.identified).toBe(false);
    expect(anon.confidence.reasons).toContain("anonymous");

    const logged = evaluateRecoveryIntelligence(rows, ctx({ identity: "logged_in" }), cfg, { asOf: NOW });
    expect(logged.confidenceEvidence.identified).toBe(true);
    expect(logged.confidence.reasons).toContain("identified");
  });

  it("J. منتج مفقود: معاينة بلا منتج لا تُنسب، والمنتج المفضّل مجهول", () => {
    const rows = [ev("product_view", "s1", { product: null, ts: NOW - H })];
    const r = evaluateRecoveryIntelligence(rows, ctx({ preferredProductId: null }), cfg, { asOf: NOW });
    expect(r.evidence.observations.unattributedProductViews).toBe(1);
    expect(r.evidence.observations.preferredProduct).toBeNull();
    expect(r.confidenceEvidence.hasProduct).toBe(false);
    expect(r.confidence.reasons).toContain("no_product");
  });

  it("K. قيمة سلة مفقودة ⇒ سبب no_cart_value", () => {
    const rows = [ev("add_to_cart", "s1", { product: "p1", ts: NOW - H })];
    const r = evaluateRecoveryIntelligence(rows, ctx(), cfg, { asOf: NOW });
    expect(r.evidence.observations.cartValue).toBeNull();
    expect(toConfidenceEvidence(r.evidence, ctx()).hasCartValue).toBe(false);
  });

  it("L. بيانات معطوبة: لا رمي للأخطاء، تُعدّ وتُحسب", () => {
    const rows: AnalyticsEventRow[] = [
      { id: "x1", visitor_id: "v", session_id: "s1", event_type: null, created_at: new Date(NOW - H).toISOString(), metadata: {} },
      { id: "x2", visitor_id: "v", session_id: "", event_type: "product_view", created_at: new Date(NOW - H).toISOString(), metadata: {} },
      { id: "x3", visitor_id: "v", session_id: "s2", event_type: "product_view", created_at: "not-a-date", metadata: {} },
    ];
    const r = evaluateRecoveryIntelligence(rows, ctx(), cfg, { asOf: NOW });
    expect(r.evidence.coverage.dropped.malformed).toBe(2);
    expect(r.evidence.coverage.dropped.nonNumericTime).toBe(1);
    expect(r.evidence.coverage.eventsUsed).toBe(0);
    expect(r.intent.score).toBeGreaterThanOrEqual(0);
  });

  it("M. حدث مكرر حرفيًا: يُدفع مرة واحدة", () => {
    const base = { product: "p1" as string | null, ts: NOW - H, meta: {} as Record<string, unknown> };
    const rows = [ev("product_view", "s1", base), ev("product_view", "s1", base)];
    const r = evaluateRecoveryIntelligence(rows, ctx(), cfg, { asOf: NOW });
    expect(r.evidence.coverage.dropped.exactDuplicates).toBe(1);
    expect(r.evidence.observations.eventCounts.product_view).toBe(1);
    expect(r.intentEvidence.repeatedViews).toBe(0);
  });

  it("N. إضافة متكررة في نفس الجلسة: 3 إضافات ≠ 3 إشارات مميّزة", () => {
    const rows = [ev("add_to_cart", "s1", { product: "p1", ts: NOW - 20 * 60000 }), ev("add_to_cart", "s1", { product: "p1", ts: NOW - 10 * 60000 }), ev("add_to_cart", "s1", { product: "p1", ts: NOW - 5 * 60000 })];
    const r = evaluateRecoveryIntelligence(rows, ctx(), cfg, { asOf: NOW });
    expect(r.evidence.observations.eventCounts.add_to_cart).toBe(3);
    expect(r.evidence.observations.signalDistinctPairs).toBe(1);
    expect(r.evidence.observations.uniqueSessions).toBe(1);
  });

  it("O. أحداث قديمة حديثة مختلطة: تُحسب الحديثة فقط", () => {
    const rows = [ev("product_view", "p1", { product: "p1", ts: NOW - 300 * H }), ev("product_view", "s2", { product: "p1", ts: NOW - 30 * 60000 })];
    const r = evaluateRecoveryIntelligence(rows, ctx(), cfg, { asOf: NOW });
    expect(r.evidence.coverage.dropped.outsideWindow).toBe(1);
    expect(r.evidence.observations.uniqueSessions).toBe(1);
    expect(r.intentEvidence.recencyHours).toBeCloseTo(0.5, 5);
  });

  it("P. timestamp مستقبلي يرفض (فوق التسامح)", () => {
    const rows = [ev("product_view", "s1", { product: "p1", ts: NOW + 7 * 60000 }), ev("product_view", "s2", { product: "p2", ts: NOW + 30 * 60000 })];
    const r = evaluateRecoveryIntelligence(rows, ctx(), cfg, { asOf: NOW });
    expect(r.evidence.coverage.dropped.future).toBe(2);
    expect(r.evidence.observations.uniqueSessions).toBe(0);
  });

  it("Q. نتيجة analytics فارغة: أدلة صفرية بأمان", () => {
    const r = evaluateRecoveryIntelligence([], ctx(), cfg, { asOf: NOW });
    expect(r.evidence.observations.uniqueSessions).toBe(0);
    expect(r.evidence.observations.eventCounts.product_view).toBe(0);
    expect(r.intent.score).toBe(4);
    expect(r.confidence.level).toBe("LOW");
    expect(r.confidence.reasons).toContain("stale");
  });
});

describe("evidence — R خليط + تعدّد لا يضخّم", () => {
  it("R. خليط صالح/غير صالح: عدّاد استبعاد دقيق لكل فئة", () => {
    const dupBase = { product: "p1" as string | null, ts: NOW - 30 * 60000, meta: {} as Record<string, unknown> };
    const rows: AnalyticsEventRow[] = [
      ev("product_view", "s1", dupBase),
      ev("product_view", "s1", dupBase),
      ev("add_to_cart", "s2", { product: "p1", ts: NOW - 10 * 60000 }),
      ev("checkout_start", "s3", { product: null, ts: NOW - 5 * 60000, meta: { subtotal: 150 } }),
      ev("page_view", "s1", { ts: NOW }),
      ev("recovery_sent", "s1", { ts: NOW - H }),
      ev("product_view", "s1", { product: "p9", ts: NOW - 500 * H }),
      ev("product_view", "s1", { product: "p8", ts: NOW + 10 * 60000 }),
      { id: "x", visitor_id: "v", session_id: null, event_type: "product_view", created_at: new Date(NOW - 3 * H).toISOString(), metadata: {} },
      { id: "y", visitor_id: "v", session_id: "s1", event_type: "product_view", created_at: "garbage", metadata: {} },
    ];
    const r = evaluateRecoveryIntelligence(rows, ctx(), cfg, { asOf: NOW });
    const d = r.evidence.coverage.dropped;
    expect(d.exactDuplicates).toBe(1);
    expect(d.unsupportedType).toBe(2);
    expect(d.outsideWindow).toBe(1);
    expect(d.future).toBe(1);
    expect(d.malformed).toBe(1);
    expect(d.nonNumericTime).toBe(1);
    expect(r.evidence.observations.eventsUsedCount).toBe(3);
    expect(r.evidence.observations.uniqueSessions).toBe(3);
    expect(r.evidence.observations.cartValue).toBe(150);
    expect(r.evidence.observations.eventCounts.product_view).toBe(1);
  });

  it("استقرار التعدّد: 100 معاينة في جلسة واحدة = إشارة واحدة لا 100", () => {
    const rows = Array.from({ length: 100 }, (_, i) => ev("product_view", "s1", { product: "p1", ts: NOW - i }));
    const r = evaluateRecoveryIntelligence(rows, ctx(), cfg, { asOf: NOW });
    expect(r.intentEvidence.repeatedViews).toBe(1);
    expect(r.intentEvidence.sessions).toBe(1);
    expect(r.confidenceEvidence.signalCount).toBe(1);
    expect(r.intent.score).toBeLessThan(40);
  });

  it("معاينة واحدة في 20 جلسة: سقف نموذجي فقط، لا عدّ خام", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ev("product_view", `s${i}`, { product: "p1", ts: NOW - (20 - i) * H }));
    const r = evaluateRecoveryIntelligence(rows, ctx(), cfg, { asOf: NOW });
    expect(r.intentEvidence.repeatedViews).toBe(19);
    expect(r.intentEvidence.sessions).toBe(20);
  });
});

describe("evidence — collector قراءة فقط (DI)", () => {
  it("collectRecoveryEvidence يحقن عميل القراءة ويعيد أدلة مطابقة للنقي", async () => {
    const rows = [
      ev("product_view", "s1", { product: "p1", ts: NOW - H }),
      ev("add_to_cart", "s1", { product: "p1", ts: NOW - 30 * 60000 }),
    ];
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            gte: () => ({
              order: () => Promise.resolve({ data: rows, error: null }),
            }),
          }),
        }),
      }),
    };
    const r = await collectRecoveryEvidence("visitor-v1", { createClient: () => client as never, asOf: NOW, windowHours: 168 }, cfg);
    const expectIdsIgnored = (x: RecoveryEvidence) => ({ ...x, observations: { ...x.observations, signalDistinctPairs: x.observations.signalDistinctPairs } });
    const built = buildRecoveryEvidence(rows, { asOf: NOW, windowHours: 168 }, cfg);
    expect(expectIdsIgnored(r)).toEqual(expectIdsIgnored(built));
    expect(r.coverage.sourceError).toBeNull();
  });

  it("collectRecoveryEvidence fail-safe على خطأ قراءة: أدلة فارغة مع المصدر", async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            gte: () => ({
              order: () => Promise.resolve({ data: null, error: { message: "boom" } }),
            }),
          }),
        }),
      }),
    };
    const r = await collectRecoveryEvidence("visitor-v1", { createClient: () => client as never }, cfg);
    expect(r.coverage.sourceError).toContain("boom");
    expect(r.coverage.eventsRead).toBe(0);
    expect(r.observations.uniqueSessions).toBe(0);
  });
});

describe("evidence — أدوات العرض والتفسير", () => {
  it("toIntentEvidence يمرر cartValue من الملاحظات أو snapshot الحالة, ولا يتخيل cartItems", () => {
    const rows = [ev("checkout_start", "s1", { product: null, ts: NOW - 10 * 60000, meta: { subtotal: 320 } })];
    const e = buildRecoveryEvidence(rows, { asOf: NOW }, cfg);
    const ie = toIntentEvidence(e, ctx());
    expect(ie.cartValue).toBe(320);
    expect(ie.cartItems).toBeNull();

    const noCart = toIntentEvidence(buildRecoveryEvidence([ev("add_to_cart", "s1", { product: "p1", ts: NOW - H })], { asOf: NOW }, cfg), ctx({ caseCartValue: 100 }));
    expect(noCart.cartValue).toBe(100);
  });

  it("describeRecoveryEvidence يعطي أسطرًا عربية للعرض", () => {
    const rows = [ev("checkout_start", "s1", { product: null, ts: NOW - 18 * 60000, meta: { subtotal: 300 } })];
    const e = buildRecoveryEvidence(rows, { asOf: NOW }, cfg);
    const lines = describeRecoveryEvidence(e);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join(" ")).toMatch(/قيمة السلة/);
  });
});
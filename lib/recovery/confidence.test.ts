import { describe, expect, it } from "vitest";
import { DEFAULT_RECOVERY_CONFIG } from "./config";
import type { RecoveryConfig } from "./config";
import { computeConfidence, confidenceLevelFor } from "./confidence";
import type { ConfidenceEvidence } from "./confidence";

function cfg(overrides: Partial<RecoveryConfig> = {}): RecoveryConfig {
  return { ...DEFAULT_RECOVERY_CONFIG, enabled: true, dryRun: true, ...overrides };
}

/** أدلة افتراضية كاملة: عميل معرّف + 3 إشارات + منتج وسلة وجلستان وحداثة حديثة. */
function evidence(overrides: Partial<ConfidenceEvidence> = {}): ConfidenceEvidence {
  return {
    identified: true,
    signalCount: 3,
    hasProduct: true,
    hasCartValue: true,
    sessions: 2,
    recencyHours: 6,
    ...overrides,
  };
}

describe("confidence — computeConfidence", () => {
  it("1. بيانات كاملة لعميل معرّف = ثقة عالية", () => {
    const r = computeConfidence(evidence(), cfg());
    expect(r.score).toBe(95); // 35 + 3×12 + 10 + 8 + 6
    expect(r.level).toBe("HIGH");
    expect(r.reasons).toContain("identified");
  });

  it("2. زائر مجهول ببيانات شحيحة = ثقة منخفضة", () => {
    const r = computeConfidence(evidence({ identified: false, signalCount: 1, hasProduct: false, hasCartValue: false, sessions: 1 }), cfg());
    expect(r.score).toBe(12); // إشارة واحدة فقط
    expect(r.level).toBe("LOW");
    expect(r.reasons).toContain("anonymous");
    expect(r.reasons).toContain("no_product");
    expect(r.reasons).toContain("no_cart_value");
  });

  it("3. الإشارات تُقصوص عند السقف — 3 إشارات مثل 10", () => {
    const a = computeConfidence(evidence(), cfg());
    const b = computeConfidence(evidence({ signalCount: 10 }), cfg());
    expect(a.score).toBe(95);
    expect(b.score).toBe(95);
  });

  it("4. التقادم الشديد يحبس الثقة تحت مستوى HIGH حتى ببيانات كاملة", () => {
    const r = computeConfidence(evidence({ recencyHours: 200 }), cfg());
    expect(r.reasons).toContain("stale");
    expect(r.score).toBeLessThan(40);
    expect(r.level).toBe("LOW");
  });

  it("5. التقادم الوسط يخصم نقاطًا بدل الحبس التام", () => {
    const r = computeConfidence(evidence({ signalCount: 1, sessions: 1, recencyHours: 60 }), cfg());
    expect(r.score).toBe(50); // 35 + 12 + 10 + 8 − 15
    expect(r.level).toBe("MEDIUM");
    expect(r.reasons).toContain("stale");
  });

  it("6. الحتمية: نفس الأدلة ⇒ نفس النتيجة تمامًا", () => {
    const a = computeConfidence(evidence({ signalCount: 2 }), cfg());
    const b = computeConfidence(evidence({ signalCount: 2 }), cfg());
    expect(a).toEqual(b);
  });

  it("7. مستويات الثقة تتبع العتبات بدقة (LOW..HIGH)", () => {
    expect(confidenceLevelFor(0, cfg())).toBe("LOW");
    expect(confidenceLevelFor(39, cfg())).toBe("LOW");
    expect(confidenceLevelFor(40, cfg())).toBe("MEDIUM");
    expect(confidenceLevelFor(69, cfg())).toBe("MEDIUM");
    expect(confidenceLevelFor(70, cfg())).toBe("HIGH");
    expect(confidenceLevelFor(100, cfg())).toBe("HIGH");
  });

  it("8. جلسة واحدة بلا تكرار تُسجَّل كسبب تحفّظ (sessions)", () => {
    const r = computeConfidence(evidence({ signalCount: 1, sessions: 1 }), cfg());
    expect(r.reasons).toContain("sessions");
  });

  it("8b. جلسات متعددة ترفع الثقة ولا تُسجَّل كتحفّظ", () => {
    const single = computeConfidence(evidence({ sessions: 1 }), cfg());
    const multi = computeConfidence(evidence({ sessions: 4 }), cfg());
    expect(multi.score).toBeGreaterThan(single.score);
    expect(multi.reasons).not.toContain("sessions");
  });

  it("9. لا سبب stale بياقت حديثة", () => {
    const r = computeConfidence(evidence({ recencyHours: 2 }), cfg());
    expect(r.reasons).not.toContain("stale");
  });
});
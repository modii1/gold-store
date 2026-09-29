import { describe, expect, it } from "vitest";
import { DEFAULT_RECOVERY_CONFIG } from "./config";
import type { RecoveryConfig } from "./config";
import { computeIntent, intentLevelFor } from "./intent";
import type { IntentEvidence } from "./intent";

function cfg(overrides: Partial<RecoveryConfig> = {}): RecoveryConfig {
  return { ...DEFAULT_RECOVERY_CONFIG, enabled: true, dryRun: true, ...overrides };
}

/** أدلة افتراضية «إضافة حديثة فقط» — كل حالة تُبني عليها بضمّ المطلوب. */
function evidence(overrides: Partial<IntentEvidence> = {}): IntentEvidence {
  return {
    caseType: "ADD_TO_CART",
    repeatedViews: 0,
    sessions: 1,
    cartValue: null,
    cartItems: null,
    recencyHours: 0,
    ageHours: 0,
    ...overrides,
  };
}

describe("intent — computeIntent", () => {
  it("1. إضافة حديثة بلا أدلة إضافية = أدنى مستوى وغير قوية", () => {
    const r = computeIntent(evidence(), cfg());
    expect(r.score).toBe(20);
    expect(r.level).toBe("VERY_LOW");
    expect(r.strongSignal).toBe(false);
    expect(r.contributors.length).toBeGreaterThan(0);
  });

  it("2. بدء الدفع وحده = إشارة قوية ومستوى متوسط", () => {
    const r = computeIntent(evidence({ caseType: "PAYMENT_STARTED" }), cfg());
    expect(r.strongSignal).toBe(true);
    expect(r.score).toBe(65);
    expect(r.level).toBe("MEDIUM");
  });

  it("3. المشاهدات المتكررة تُضاف بسقف (لا تضخيم بعد السقف)", () => {
    const base = evidence({ caseType: "PAYMENT_STARTED", repeatedViews: 4 });
    const overload = evidence({ caseType: "PAYMENT_STARTED", repeatedViews: 20 });
    const a = computeIntent(base, cfg());
    const b = computeIntent(overload, cfg());
    expect(a.score).toBe(89); // 65 + 4×6
    expect(b.score).toBe(89); // السقف 24: 20 مشاهدة تعطي نفس النتيجة
    expect(a.level).toBe("EXTREME"); // 89 ≥ عتبة 85
    expect(b.level).toBe("EXTREME");
    expect(b.contributors.find((c) => c.key === "repeated_views")?.capReached).toBe(true);
  });

  it("4. الجلسات المميزة تُضاف بعد الأولى فقط", () => {
    const one = computeIntent(evidence({ caseType: "CHECKOUT_STARTED" }), cfg());
    const three = computeIntent(evidence({ caseType: "CHECKOUT_STARTED", sessions: 3 }), cfg());
    expect(one.score).toBe(45);
    expect(three.score).toBe(57); // 45 + 2 جلسات إضافية × 6
  });

  it("5. شريحة قيمة السلة تُمنح مرة واحدة وفق أعلى شريحة يصلها", () => {
    const v500 = computeIntent(evidence({ caseType: "CHECKOUT_STARTED", cartValue: 800 }), cfg());
    const v1500 = computeIntent(evidence({ caseType: "CHECKOUT_STARTED", cartValue: 2000 }), cfg());
    const low = computeIntent(evidence({ caseType: "CHECKOUT_STARTED", cartValue: 100 }), cfg());
    expect(v500.score).toBe(55); // 45 + شريحة 500
    expect(v1500.score).toBe(60); // 45 + شريحة 1500
    expect(low.score).toBe(45); // دون أدنى شريحة
  });

  it("6. حداثة تنخفض بالنصف مع كل نصف عمر، ولا تهبط دون الحد الأدنى", () => {
    const stale24 = computeIntent(evidence({ caseType: "PAYMENT_STARTED", recencyHours: 24 }), cfg());
    const veryOld = computeIntent(evidence({ caseType: "PAYMENT_STARTED", recencyHours: 500 }), cfg());
    expect(stale24.score).toBe(16); // 65 × 2^-2
    expect(veryOld.score).toBe(13); // الحد الأدنى 0.2: 65 × 0.2
  });

  it("7. الحالة المغلقة بالشراء = صفر محسوم بلا مساهمات", () => {
    const r = computeIntent(evidence({ caseType: "PURCHASED" }), cfg());
    expect(r.score).toBe(0);
    expect(r.level).toBe("VERY_LOW");
    expect(r.strongSignal).toBe(false);
    expect(r.contributors).toEqual([]);
  });

  it("8. تركيبة متطرفة تُقطع عند 100", () => {
    const r = computeIntent(
      evidence({
        caseType: "PAYMENT_STARTED",
        repeatedViews: 10,
        sessions: 5,
        cartValue: 2000,
        cartItems: 10,
      }),
      cfg(),
    );
    expect(r.score).toBe(100);
    expect(r.level).toBe("EXTREME");
  });

  it("9. أصناف السلة تُضاف بسقف", () => {
    const items = computeIntent(evidence({ caseType: "CHECKOUT_STARTED", cartItems: 3 }), cfg());
    expect(items.score).toBe(53); // 45 + min(3,2) × 4
  });

  it("10. الحتمية: نفس الأدلة ⇒ نفس النتيجة تمامًا", () => {
    const a = computeIntent(evidence({ caseType: "CHECKOUT_STARTED", repeatedViews: 3, sessions: 2 }), cfg());
    const b = computeIntent(evidence({ caseType: "CHECKOUT_STARTED", repeatedViews: 3, sessions: 2 }), cfg());
    expect(a).toEqual(b);
  });

  it("11. مستويات النتيجة تتبع العتبات بدقة (VERY_LOW..EXTREME)", () => {
    expect(intentLevelFor(0, cfg())).toBe("VERY_LOW");
    expect(intentLevelFor(29, cfg())).toBe("VERY_LOW");
    expect(intentLevelFor(30, cfg())).toBe("LOW");
    expect(intentLevelFor(49, cfg())).toBe("LOW");
    expect(intentLevelFor(50, cfg())).toBe("MEDIUM");
    expect(intentLevelFor(69, cfg())).toBe("MEDIUM");
    expect(intentLevelFor(70, cfg())).toBe("HIGH");
    expect(intentLevelFor(84, cfg())).toBe("HIGH");
    expect(intentLevelFor(85, cfg())).toBe("EXTREME");
    expect(intentLevelFor(100, cfg())).toBe("EXTREME");
  });
});
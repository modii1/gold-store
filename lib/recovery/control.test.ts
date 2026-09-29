/**
 * اختبارات أساس مركز التحكم (المرحلة 1).
 *
 * ما تُغطّيه هنا:
 *  - المراحل: الاشتقاق من الجدول الحالي، الترتيب، الاختيار، الرفض الآمن.
 *  - الإعدادات: قاعدة الدمج env ⇢ DB، ورفض القيم غير الصالحة (fallback آمن).
 *  - توحيد dryRun: القاعدة الواحدة التي كانت مختلفة بين المسارات.
 *  - قاموس المتغيرات: التصيير الآمن وحجب discount.* عن العميل.
 *  - سجل الأحداث: append-only في المخزنين.
 *
 * لا شيء هنا يلمس Supabase حقيقيًا ولا الشبكة: العميل وهمي دائمًا.
 */

import { describe, it, expect } from "vitest";
import {
  loadRecoveryConfig,
  applyRecoverySettings,
  resolveRecoveryDryRun,
  canPersistCases,
  DEFAULT_RECOVERY_CONFIG,
} from "./config";
import { stagesFromReminders, orderStages, activeStages, selectStageAt, resolveStagePlan, stageFromRow } from "./stages";
import { readRecoverySettings, readRecoveryStages, loadEffectiveRecoveryConfig } from "./settings-store";
import {
  readRecoveryStagesAll,
  listRecoveryTemplates,
  saveRecoverySettings,
  saveRecoveryStage,
  deleteRecoveryStage,
  setRecoveryStageActive,
  reorderRecoveryStages,
  readRecoveryTemplatesAll,
  saveRecoveryTemplate,
  deleteRecoveryTemplate,
  setRecoveryTemplateActive,
  listStageTemplateBindings,
} from "./settings-store";
import {
  parseTemplateInput,
  isTemplateKeyValid,
  templateRowHint,
  buildTrialTemplateValues,
  previewTemplate,
  describeTemplateTokens,
} from "./template-control";
import {
  parseSettingsInput,
  parseStageInput,
  stageRowHint,
  formatDurationAr,
  simulateStageTimeline,
  isValidRecoverySettings,
} from "./control-schema";
import { buildRecoveryPlanPreview, buildStagePlanPreview } from "./control-preview";
import {
  RECOVERY_VARIABLES,
  findVariable,
  listTemplateTokens,
  validateTemplate,
  renderTemplate,
  buildRecoveryVariables,
  variablesByGroup,
} from "./variables";
import { InMemoryRecoveryStore, eventFromRow } from "./store";
import { maskPhone } from "./store";
import type { RecoveryCase, RecoveryCouponView } from "./types";
import type { RecoveryStage } from "./stages";
import type { SupabaseClient } from "@supabase/supabase-js";

const T0 = 1_760_000_000_000;
const HOUR = 3_600_000;

// ============================================================
// 1) المراحل
// ============================================================

describe("S1 — المراحل", () => {
  it("S1.1 الاشتقاق من جدول التذكيرات يحافظ على السلوك الحالي", () => {
    const stages = stagesFromReminders([30, 360, 1440]);
    expect(stages).toHaveLength(3);
    expect(stages.map((s) => s.position)).toEqual([1, 2, 3]);
    expect(stages.map((s) => s.delayMinutes)).toEqual([30, 360, 1440]);
    expect(stages.map((s) => s.key)).toEqual(["reminder_1", "reminder_2", "reminder_3"]);
    expect(stages.every((s) => s.isActive && !s.isTerminal && s.templateId === null)).toBe(true);
  });

  it("S1.2 القيم غير الصالحة تُسقَط بدل كسر الجدول", () => {
    const stages = stagesFromReminders([30, Number.NaN, -5, 60]);
    expect(stages.map((s) => s.delayMinutes)).toEqual([30, 60]);
  });

  it("S1.3 صف غير صالح يُرفض، والصف السليم يمر", () => {
    expect(stageFromRow({ key: "", delay_minutes: 10 })).toBeNull();
    expect(stageFromRow({ key: "Bad Key!", delay_minutes: 10 })).toBeNull();
    expect(stageFromRow({ key: "farewell", delay_minutes: -1 })).toBeNull();
    const ok = stageFromRow({ key: "Farewell", name_ar: "وداع", position: 4, delay_minutes: 2880, is_terminal: true, template_id: 7 });
    expect(ok).not.toBeNull();
    expect(ok?.key).toBe("farewell");
    expect(ok?.position).toBe(4);
    expect(ok?.isTerminal).toBe(true);
    expect(ok?.templateId).toBe(7);
  });

  it("S1.4 الترتيب حتمي بالـposition ثم بالمفتاح", () => {
    const stages: RecoveryStage[] = [
      { key: "b", nameAr: "ب", position: 2, delayMinutes: 60, templateId: null, isActive: true, isTerminal: false, maxTotalMessages: null },
      { key: "a", nameAr: "أ", position: 2, delayMinutes: 60, templateId: null, isActive: true, isTerminal: false, maxTotalMessages: null },
      { key: "c", nameAr: "ج", position: 1, delayMinutes: 30, templateId: null, isActive: true, isTerminal: false, maxTotalMessages: null },
    ];
    expect(orderStages(stages).map((s) => s.key)).toEqual(["c", "a", "b"]);
  });

  it("S1.5 المعطّلة تُستبعد من الخطة الفعّالة", () => {
    const stages = stagesFromReminders([30, 360, 1440]).map((s) => (s.position === 2 ? { ...s, isActive: false } : s));
    expect(activeStages(stages).map((s) => s.position)).toEqual([1, 3]);
  });

  it("S1.6 اختيار المرحلة عند فهرس، ولا اختراع خارج النطاق", () => {
    const stages = stagesFromReminders([30, 360, 1440]);
    expect(selectStageAt(stages, 0)?.position).toBe(1);
    expect(selectStageAt(stages, 2)?.position).toBe(3);
    expect(selectStageAt(stages, 3)).toBeNull();
    expect(selectStageAt(stages, -1)).toBeNull();
    expect(selectStageAt([], 0)).toBeNull();
  });

  it("S1.7 الخطة: صفوف القاعدة تغلب، وإلا اشتقاق آمن", () => {
    const fromDb: RecoveryStage[] = [
      { key: "winback", nameAr: "إعادة>", position: 1, delayMinutes: 2000, templateId: 3, isActive: true, isTerminal: true, maxTotalMessages: 1 },
    ];
    expect(resolveStagePlan(fromDb, [30, 360]).map((s) => s.key)).toEqual(["winback"]);
    // جدول غير موجود / فارغ / صفوف غير صالحة ⇒ نفس السلوك الحالي.
    expect(resolveStagePlan([], [30, 360, 1440]).map((s) => s.delayMinutes)).toEqual([30, 360, 1440]);
    expect(resolveStagePlan(null, [30]).map((s) => s.key)).toEqual(["reminder_1"]);
  });
});

// ============================================================
// 2) الإعدادات والدمج
// ============================================================

describe("S2 — الإعدادات", () => {
  const base = loadRecoveryConfig({ RECOVERY_MAX_MESSAGES: "5", RECOVERY_EXPIRY_HOURS: "72" } as unknown as NodeJS.ProcessEnv);

  it("S2.1 خط الأساس يقرأ البيئة ويمتلئ خط المراحل", () => {
    expect(base.maxMessages).toBe(5);
    expect(base.expiryHours).toBe(72);
    expect(base.stages.map((s) => s.delayMinutes)).toEqual([30, 360, 1440]);
  });

  it("S2.2 حقل مضبوط في القاعدة يتجاوز البيئة، وغير المضبوط يبقى", () => {
    const merged = applyRecoverySettings(base, { maxMessages: 2, minCartValueForDiscount: null });
    expect(merged.maxMessages).toBe(2);
    expect(merged.minCartValueForDiscount).toBe(base.minCartValueForDiscount);
    expect(merged.expiryHours).toBe(72);
  });

  it("S2.3 القيم غير الصالحة تُرفض (fallback آمن) ولا تكسر الأعداد", () => {
    const merged = applyRecoverySettings(base, {
      maxMessages: -3,
      expiryHours: "abc" as unknown as number,
      scoreDecayHours: Number.NaN,
    });
    expect(merged.maxMessages).toBe(base.maxMessages);
    expect(merged.expiryHours).toBe(base.expiryHours);
    expect(merged.scoreDecayHours).toBe(base.scoreDecayHours);
  });

  it("S2.4 الأوزان تُدمج حقلًا حقلًا", () => {
    const merged = applyRecoverySettings(base, { scores: { add_to_cart: 33, payment_started: "x" as unknown as number } });
    expect(merged.scores.add_to_cart).toBe(33);
    expect(merged.scores.payment_started).toBe(base.scores.payment_started);
    expect(merged.scores.checkout_start).toBe(base.scores.checkout_start);
  });

  it("S2.5 المنطقي يُستبدل فقط إن كان منطقيًا فعلًا", () => {
    expect(applyRecoverySettings(base, { discountRequiresPriorReminder: false }).discountRequiresPriorReminder).toBe(false);
    expect(applyRecoverySettings(base, { discountRequiresPriorReminder: "no" as unknown as boolean }).discountRequiresPriorReminder).toBe(
      base.discountRequiresPriorReminder,
    );
  });

  it("S2.6 الإعدادات لا تلمس enabled ولا dryRun (مصدرهما منفصل)", () => {
    const merged = applyRecoverySettings(base, { dryRun: true } as never);
    expect(merged.enabled).toBe(base.enabled);
    // dryRun لا يُنسخ داخل applyRecoverySettings إطلاقًا.
    expect(merged.dryRun).toBe(base.dryRun);
  });

  it("S2.7 المراحل تحلّ محل الأساس عند تمريرها", () => {
    const stages = stagesFromReminders([60]);
    const merged = applyRecoverySettings(base, {}, stages);
    expect(merged.stages).toHaveLength(1);
    expect(merged.remindersMinutes).toEqual(base.remindersMinutes);
  });

  it("S2.8 canPersistCases محكوم بـenabled وحده", () => {
    expect(canPersistCases({ ...DEFAULT_RECOVERY_CONFIG, enabled: true })).toBe(true);
    expect(canPersistCases({ ...DEFAULT_RECOVERY_CONFIG, enabled: false })).toBe(false);
  });
});

// ============================================================
// 3) توحيد dryRun (إصلاح الشارة الوهمية)
// ============================================================

describe("S3 — قاعدة dryRun الموحّدة", () => {
  const base = loadRecoveryConfig({} as NodeJS.ProcessEnv); // dryRun=true افتراضيًا

  it("S3.1 متوقف ⇒ لا إرسال إطلاقًا (dryRun=true دائمًا)", () => {
    expect(resolveRecoveryDryRun(base, false, {})).toBe(true);
    expect(resolveRecoveryDryRun(base, false, { dryRun: false })).toBe(true);
  });

  it("S3.2 مفعّل بلا ضبط ⇒ ينفّذ الموجود فعليًا (السلوك الحالي للـcron)", () => {
    // هذا هو الإصلاح: اللوحة كانت تعرض true هنا بينما المسار يعمل.
    expect(resolveRecoveryDryRun(base, true, {})).toBe(false);
  });

  it("S3.3 مفعّل + ضبط صريح ⇒ يُحترم الضبط في الاتجاهين", () => {
    expect(resolveRecoveryDryRun(base, true, { dryRun: true })).toBe(true);
    expect(resolveRecoveryDryRun(base, true, { dryRun: false })).toBe(false);
  });

  it("S3.4 القيمة القديمة (متغير بيئة) لا تتسرّب إلى الوضع الفعّال", () => {
    const envOn = loadRecoveryConfig({ RECOVERY_ENABLED: "true" } as unknown as NodeJS.ProcessEnv);
    expect(envOn.dryRun).toBe(true);
    expect(resolveRecoveryDryRun(envOn, true, {})).toBe(false);
  });
});

// ============================================================
// 4) مخزن الإعدادات (قراءة آمنة من DB وهمية)
// ============================================================

type Row = Record<string, unknown>;

function settingsClient(rows: Row[], fail?: { code?: string; message: string }): () => SupabaseClient {
  return () =>
    ({
      from: () => {
        const b: Record<string, unknown> = {};
        b.select = () => b;
        b.eq = () => b;
        b.order = () => b;
        b.limit = () => b;
        b.maybeSingle = async () => (fail ? { data: null, error: fail } : { data: rows[0] ?? null, error: null });
        b.then = (ok?: (v: unknown) => unknown, no?: (r: unknown) => unknown) =>
          Promise.resolve(fail ? { data: null, error: fail } : { data: rows, error: null }).then(ok, no);
        return b;
      },
    }) as unknown as SupabaseClient;
}

describe("S4 — قراءة الإعدادات والمراحل من القاعدة", () => {
  it("S4.1 جدول غير موجود ⇒ خط أساس آمن وخطأ مقروء (لا رمي)", async () => {
    const r = await readRecoverySettings({ createClient: settingsClient([], { code: "42P01", message: "relation does not exist" }) });
    expect(r.settings).toEqual({});
    expect(r.source).toBe("empty");
    expect(r.error).toContain("42P01");
  });

  it("S4.2 استثناء من العميل لا يمرّر", async () => {
    const boom = () => {
      throw new Error("network down");
    };
    const r = await readRecoverySettings({ createClient: boom as unknown as () => SupabaseClient });
    expect(r.settings).toEqual({});
    expect(r.error).toContain("network down");
  });

  it("S4.3 أنواع غير متوقعة تُتجاهل ولا تُمرّر للدمج", async () => {
    const r = await readRecoverySettings({
      createClient: settingsClient([{ config: { maxMessages: "9", dryRun: "true", expiryHours: 12, unknownKey: 5 } }]),
    });
    expect(r.settings.maxMessages).toBeUndefined(); // نص ⇒ لا يُنقل
    expect(r.settings.dryRun).toBeUndefined(); // نص ⇒ لا يُنقل
    expect(r.settings.expiryHours).toBe(12);
    expect((r.settings as Record<string, unknown>).unknownKey).toBeUndefined();
  });

  it("S4.4 صف سليم ⇒ source=db والوقيم منقولة", async () => {
    const r = await readRecoverySettings({
      createClient: settingsClient([{ config: { maxMessages: 1, globalCooldownHours: 48, scores: { add_to_cart: 7 } } }]),
    });
    expect(r.source).toBe("db");
    expect(r.settings.maxMessages).toBe(1);
    expect(r.settings.globalCooldownHours).toBe(48);
    expect(r.settings.scores?.add_to_cart).toBe(7);
  });

  it("S4.5 صف واحد فارغ ⇒ source=empty لا db", async () => {
    const r = await readRecoverySettings({ createClient: settingsClient([{ config: {} }]) });
    expect(r.source).toBe("empty");
  });

  it("S4.6 مراحل صالحة تُقرأ مرتّبة، غير الصالحة تُسقَط", async () => {
    const r = await readRecoveryStages({
      createClient: settingsClient([
        { key: "second", position: 2, delay_minutes: 360, is_active: true },
        { key: "first", position: 1, delay_minutes: 30, is_active: true },
        { key: "Bad Key!", position: 3, delay_minutes: 10 },
        { key: "zero", position: 0, delay_minutes: 10 },
      ]),
    });
    expect(r.source).toBe("db");
    expect(r.stages.map((s) => s.key)).toEqual(["first", "second"]);
  });

  it("S4.7 جدول المراحل غير موجود ⇒ خطة فارغة يملؤها الـfallback", async () => {
    const r = await readRecoveryStages({ createClient: settingsClient([], { code: "42P01", message: "nope" }) });
    expect(r.stages).toEqual([]);
    expect(r.error).toContain("42P01");
  });

  it("S4.8 التحميل الفعّال: OFF ⇒ إعداد كامل بمحاذاة خط الأساس", async () => {
    const eff = await loadEffectiveRecoveryConfig({
      createClient: settingsClient([], { code: "42P01", message: "nope" }),
      readEnabled: async () => false,
    });
    expect(eff.enabled).toBe(false);
    expect(eff.cfg.enabled).toBe(false);
    expect(eff.cfg.dryRun).toBe(true);
    expect(eff.stages.map((s) => s.delayMinutes)).toEqual([30, 360, 1440]);
    expect(eff.errors.settings).toContain("42P01");
  });

  it("S4.9 التحميل الفعّال: ON بلا جداول ⇒ نفس سلوك اليوم بالضبط", async () => {
    const eff = await loadEffectiveRecoveryConfig({
      createClient: settingsClient([], { code: "42P01", message: "nope" }),
      readEnabled: async () => true,
    });
    expect(eff.cfg.enabled).toBe(true);
    expect(eff.cfg.dryRun).toBe(false);
    expect(eff.cfg.maxMessages).toBe(DEFAULT_RECOVERY_CONFIG.maxMessages);
    expect(eff.stagesSource).toBe("empty");
  });

  it("S4.10 التحميل الفعّال: ضبط في القاعدة يُطبَّق على القيمتي معًا", async () => {
    const eff = await loadEffectiveRecoveryConfig({
      createClient: settingsClient([
        {
          key: "any",
          position: 1,
          delay_minutes: 45,
          is_active: true,
          is_terminal: false,
        },
      ]),
      readEnabled: async () => true,
    });
    // نفس العميل الوهمي يخدم الجدولين ⇒ phases تُقرأ كـ"مراحل" أيضاً.
    expect(eff.stagesSource).toBe("db");
    expect(eff.cfg.stages[0]?.delayMinutes).toBe(45);
  });
});

// ============================================================
// 5) قاموس المتغيرات
// ============================================================

describe("S5 — قاموس المتغيرات والتصيير الآمن", () => {
  const values = { "customer.name": "سارة", "cart.value_formatted": "349 ر.س" };

  it("S5.1 كل متغير له مصدر ومثال واسم عربي", () => {
    expect(RECOVERY_VARIABLES.length).toBeGreaterThan(20);
    for (const v of RECOVERY_VARIABLES) {
      expect(v.source.length, `${v.name} بلا مصدر`).toBeGreaterThan(0);
      expect(v.labelAr.length, `${v.name} بلا اسم عربي`).toBeGreaterThan(0);
      expect(v.descriptionAr.length, `${v.name} بلا شرح`).toBeGreaterThan(0);
      expect(v.name).toMatch(/^[a-z0-9_.]+$/);
    }
    const names = new Set(RECOVERY_VARIABLES.map((v) => v.name));
    expect(names.size).toBe(RECOVERY_VARIABLES.length);
  });

  it("S5.2 كل المجموعات المطلوبة موجودة", () => {
    const groups = variablesByGroup().map((g) => g.group);
    for (const g of ["customer", "cart", "product", "order", "recovery", "message", "store", "links", "dates", "discount"]) {
      expect(groups).toContain(g);
    }
  });

  it("S5.3 التصيير يستبدل بالقيمة المتاحة", () => {
    const out = renderTemplate("مرحبًا {{customer.name}} — سلة {{cart.value_formatted}}", values);
    expect(out.text).toBe("مرحبًا سارة — سلة 349 ر.س");
    expect(out.unknown).toEqual([]);
    expect(out.used.every((u) => u.fromData)).toBe(true);
  });

  it("S5.4 قيمة فارغة/null ⇒ البديل الآمن، ولا رمز متبقٍ", () => {
    const out = renderTemplate("{{customer.name}} / {{product.name}}", { "customer.name": "", "product.name": null });
    expect(out.text).toBe("عميلنا / قطعتك");
    expect(out.text).not.toContain("{{");
    expect(out.used.map((u) => u.fromData)).toEqual([false, false]);
  });

  it("S5.5 رمز غير معروف ⇒ يُحذف ويُسجَّل (لا يصل للعميل)", () => {
    const out = renderTemplate("خصم {{discount.percent}} كود {{secret.code}}", { "secret.code": "X" });
    expect(out.text).not.toContain("secret");
    expect(out.unknown).toEqual(["secret.code"]);
  });

  it("S5.6 discount.* محجوب عن العميل ويُعرض للمعاينة الداخلية فقط", () => {
    const customerView = renderTemplate("خصم {{discount.percent}} على {{cart.value_formatted}}", { ...values, "discount.percent": "10%" });
    expect(customerView.text).toBe("خصم  على 349 ر.س");
    expect(customerView.blockedInternal).toEqual(["discount.percent"]);

    const internalView = renderTemplate("خصم {{discount.percent}}", { "discount.percent": "10%" }, { includeInternalOnly: true });
    expect(internalView.text).toBe("خصم 10%");
    expect(internalView.blockedInternal).toEqual([]);
  });

  it("S5.7 مسافات داخل الرمز مقبولة، والرموز الغريبة تُحذف", () => {
    const out = renderTemplate("{{  customer.name  }} {{<script>}} {{}}", { "customer.name": "سارة" });
    expect(out.text).toBe("سارة  ");
    expect(out.text).not.toContain("<script>");
  });

  it("S5.8 القالب الفارغ أو غير نصي لا يرمي", () => {
    expect(renderTemplate("", {}).text).toBe("");
    expect(renderTemplate(undefined as unknown as string, {}).text).toBe("");
    expect(renderTemplate("بلا رموز", {}).used).toEqual([]);
  });

  it("S5.9 استخراج الرموز بلا تكرار، والفحص يبلّغ", () => {
    expect(listTemplateTokens("{{a.b}} {{ a.b }} {{c.d}}")).toEqual(["a.b", "c.d"]);
    const v = validateTemplate("{{customer.name}} {{nope}} {{discount.value}}");
    expect(v.ok).toBe(false);
    expect(v.unknown).toEqual(["nope"]);
    expect(v.couponGated).toContain("discount.value");
  });

  it("S5.10 findVariable يعيد التعريف أو null", () => {
    expect(findVariable("customer.name")?.group).toBe("customer");
    expect(findVariable("no.such")).toBeNull();
  });

  it("S5.11 بناء القيم من حالة: إخفاء الجوال ولا اختراع قيم", () => {
    const c: RecoveryCase = {
      id: "case-1",
      customerId: "cust-1",
      customerPhone: "966533220646",
      visitorId: "v",
      sessionId: "s",
      caseType: "ADD_TO_CART",
      status: "OPEN",
      score: 40,
      cartValue: 349,
      productIds: ["p1", "p2"],
      preferredProductId: "p1",
      preferredProductSlug: "mini-bag",
      firstDetectedAt: T0,
      lastActivityAt: T0 + 6 * HOUR,
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
    const v = buildRecoveryVariables({
      case: c,
      stage: stagesFromReminders([30])[0],
      stageIndex: 1,
      stageTotal: 1,
      now: T0 + 12 * HOUR,
      expiryHours: 96,
      sources: { store: { name: "لمعة", whatsapp: "966500000000" } },
    });
    expect(v["customer.phone_masked"]).toBe(maskPhone(c.customerPhone));
    expect(v["customer.phone_masked"]).not.toContain("5332206"); // لا رقم كامل
    expect(v["customer.name"]).toBe(""); // لا اسم في المصادر ⇒ لا اختراع
    expect(v["cart.items_count"]).toBe("2");
    expect(v["recovery.hours_since_abandon"]).toBe("6");
    expect(v["links.product"]).toBe("/product/mini-bag");
    expect(v["links.support"]).toContain("wa.me/966500000000");
    expect(v["discount.percent"]).toBe("");

    const out = renderTemplate("{{customer.name}} {{product.name}} {{discount.percent}}", v);
    expect(out.text).toBe("عميلنا mini-bag ");
  });
});

// ============================================================
// 6) سجل أحداث الحالة
// ============================================================

describe("S6 — سجل الأحداث", () => {
  it("S6.1 InMemory يكتب ويقرأ مرتّبًا زمنيًا", async () => {
    const store = new InMemoryRecoveryStore();
    expect(await store.appendCaseEvent({ caseId: "c1", eventType: "case_created", summaryAr: "أُنشئت الحالة" })).toBe(true);
    expect(await store.appendCaseEvent({ caseId: "c1", eventType: "message_queued", summaryAr: "جُدولت رسالة" })).toBe(true);
    expect(await store.appendCaseEvent({ caseId: "c2", eventType: "signal", summaryAr: "إضافة للسلة" })).toBe(true);

    const all = await store.listCaseEvents();
    expect(all.get("c1")?.map((e) => e.eventType)).toEqual(["case_created", "message_queued"]);
    const only = await store.listCaseEvents(["c2"]);
    expect([...only.keys()]).toEqual(["c2"]);
  });

  it("S6.2 صف غير صالح (نوع مجهول أو بلا حالة) يُتجاهل", () => {
    expect(eventFromRow({ case_id: "c1", event_type: "not_a_type" })).toBeNull();
    expect(eventFromRow({ case_id: "", event_type: "signal" })).toBeNull();
    const ok = eventFromRow({
      case_id: "c1",
      event_type: "settled",
      stage_key: "reminder_1",
      template_id: 3,
      summary_ar: "تأكيد الإرسال",
      payload: { channel: "whatsapp" },
      created_at: new Date(T0).toISOString(),
    });
    expect(ok?.createdAt).toBe(T0);
    expect(ok?.stageKey).toBe("reminder_1");
    expect(ok?.payload).toEqual({ channel: "whatsapp" });
  });

  it("S6.3 payload غير كائن ⇒ {} بدل رمي", () => {
    const e = eventFromRow({ case_id: "c1", event_type: "signal", payload: ["bad"] });
    expect(e?.payload).toEqual({});
  });
});

// ============================================================
// 7) فحص الإدخال (المخطط — المرحلة 2)
// ============================================================

describe("S7 — فحص إدخال لوحة التحكم", () => {
  it("S7.1 إعدادات صالحة (أرقام/منطقيات/scores مسطّحة) تُقبل", () => {
    const r = parseSettingsInput({
      maxMessages: "4",
      globalCooldownHours: "48",
      dryRun: "نعم",
      discountRequiresPriorReminder: "off",
      "scores.add_to_cart": "25",
      "scores.payment_started": "45",
    });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.settings.maxMessages).toBe(4);
    expect(r.settings.globalCooldownHours).toBe(48);
    expect(r.settings.dryRun).toBe(true);
    expect(r.settings.discountRequiresPriorReminder).toBe(false);
    expect(r.settings.scores?.add_to_cart).toBe(25);
    expect(r.settings.scores?.payment_started).toBe(45);
  });

  it("S7.2 كائن scores متداخل يُفكّ كالمفاتيح المسطّحة", () => {
    const r = parseSettingsInput({ scores: { product_view: 5, purchase: -60, unknown_signal: 9 } });
    expect(r.ok).toBe(false);
    expect(r.settings.scores?.product_view).toBe(5);
    expect(r.settings.scores?.purchase).toBe(-60);
    expect(r.errors.join(" ")).toContain("غير معروف");
  });

  it("S7.3 أي حقل غير معروف يرفض المسودة كاملة", () => {
    const r = parseSettingsInput({ maxMessages: 1, magicButton: "x" });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("غير معروف");
  });

  it("S7.4 قيم خارج الحدود تُرفض برسالة واضحة", () => {
    const r = parseSettingsInput({ maxMessages: "0", expiryHours: "99999", maxRecoveryDiscountPercent: "101" });
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThanOrEqual(1);
  });

  it("S7.5 المنطقي الصارم: «نعم/لا» والأرقام 1/0 تُقبل، وأي شيء آخر يُرفض", () => {
    expect(parseSettingsInput({ dryRun: "لا" }).settings.dryRun).toBe(false);
    expect(parseSettingsInput({ dryRun: "1" }).settings.dryRun).toBe(true);
    expect(parseSettingsInput({ dryRun: "maybe" }).ok).toBe(false);
    expect(parseSettingsInput({ dryRun: 5 }).ok).toBe(false);
  });

  it("S7.6 فراغ ⇒ ok بلا أي قيم (لقطة «لا تغيير»)", () => {
    const r = parseSettingsInput({});
    expect(r.ok).toBe(true);
    expect(r.settings).toEqual({});
  });

  it("S7.7 isValidRecoverySettings حارس أخير للصورة المخزنة", () => {
    expect(isValidRecoverySettings({ maxMessages: 3, scores: { add_to_cart: 20 } })).toBe(true);
    expect(isValidRecoverySettings({ maxMessages: "3" })).toBe(false);
    expect(isValidRecoverySettings([1, 2])).toBe(false);
    expect(isValidRecoverySettings(null)).toBe(false);
  });

  it("S7.8 مرحلة جديدة صالحة تُقبل (المفتاح يُنزَّل للأحرف الصغيرة)", () => {
    const r = parseStageInput({ key: "Winback", nameAr: "إعادة الاسترجاع", position: "", delayMinutes: "30" });
    expect(r.ok).toBe(true);
    expect(r.stage?.key).toBe("winback");
    expect(r.stage?.delayMinutes).toBe(30);
    expect(r.stage?.isActive).toBe(true);
    expect(r.stage?.maxTotalMessages).toBeNull();
  });

  it("S7.9 مفتاح غير صالح أو مفقود ⇒ رفض", () => {
    expect(parseStageInput({ nameAr: "بدون مفتاح", delayMinutes: 30 }).ok).toBe(false);
    expect(parseStageInput({ key: "Bad Key!", nameAr: "مسافات", delayMinutes: 30 }).ok).toBe(false);
    expect(parseStageInput({ key: "árabic", nameAr: "عربي", delayMinutes: 30 }).ok).toBe(false);
  });

  it("S7.10 انتظار خارج المدى أو غير صحيح ⇒ رفض", () => {
    expect(parseStageInput({ key: "a", nameAr: "أ", delayMinutes: "-1" }).ok).toBe(false);
    expect(parseStageInput({ key: "a", nameAr: "أ", delayMinutes: "abc" }).ok).toBe(false);
    expect(parseStageInput({ key: "a", nameAr: "أ", delayMinutes: "600000" }).ok).toBe(false);
  });

  it("S7.11 سقف رسائل المرحلة: صحيح موجب أو فارغ فقط", () => {
    expect(parseStageInput({ key: "a", nameAr: "أ", delayMinutes: 30, maxTotalMessages: "0" }).ok).toBe(false);
    expect(parseStageInput({ key: "a", nameAr: "أ", delayMinutes: 30, maxTotalMessages: "" }).stage?.maxTotalMessages).toBeNull();
    expect(parseStageInput({ key: "a", nameAr: "أ", delayMinutes: 30, maxTotalMessages: "5" }).stage?.maxTotalMessages).toBe(5);
  });

  it("S7.12 تعديل مرحلة بمعرّف: غياب الموضع مقبول (يبقى كما هو)", () => {
    const r = parseStageInput({ id: 9, key: "b", nameAr: "ب", delayMinutes: 60 });
    expect(r.ok).toBe(true);
    expect(r.stage?.position).toBe(0); // إشارة «لا تغيّر الموضع» تُتجاهل في الكتابة
  });

  it("S7.13 stageRowHint يصف خلل الصف المقروء أو null", () => {
    expect(stageRowHint({ key: "ok", name_ar: "سليم", position: 1, delay_minutes: 30 })).toBeNull();
    expect(stageRowHint({ key: "Bad!", position: 1, delay_minutes: 30 })).toContain("مفتاح");
    expect(stageRowHint({ key: "ok", position: 1, delay_minutes: -1 })).toContain("انتظار");
    expect(stageRowHint({ key: "ok", position: 0, delay_minutes: 30 })).toContain("ترتيب");
    expect(stageRowHint({ key: "ok", position: 1, delay_minutes: 30, max_total_messages: 0 })).toContain("سقف");
  });

  it("S7.14 تنسيق المدد عربيًا", () => {
    expect(formatDurationAr(0)).toBe("فورًا");
    expect(formatDurationAr(-5)).toBe("فورًا");
    expect(formatDurationAr(45)).toBe("45 دقيقة");
    expect(formatDurationAr(60)).toBe("ساعة واحدة");
    expect(formatDurationAr(90)).toBe("ساعة و 30 دقيقة");
    expect(formatDurationAr(1440)).toBe("24 ساعة");
  });
});

// ============================================================
// 8) المحاكاة والمعاينة (المرحلة 2)
// ============================================================

describe("S8 — المحاكاة والمعاينة", () => {
  const base = loadRecoveryConfig({} as NodeJS.ProcessEnv);

  it("S8.1 بلا مراحل ⇒ الخطة الافتراضية مع تحذير صريح", () => {
    const t = simulateStageTimeline(null, 3);
    expect(t.usedFallback).toBe(true);
    expect(t.steps.map((s) => s.elapsedMinutes)).toEqual([30, 360, 1440]);
    expect(t.warnings.some((w) => w.includes("الافتراضية"))).toBe(true);
  });

  it("S8.2 المراحل المعطّلة تُستبعد من الخط الزمني", () => {
    const stages = stagesFromReminders([30, 360, 1440]).map((s) => (s.position === 2 ? { ...s, isActive: false } : s));
    const t = simulateStageTimeline(stages, 10);
    expect(t.usedFallback).toBe(false);
    expect(t.steps.map((s) => s.elapsedMinutes)).toEqual([30, 1440]);
    expect(t.warnings.some((w) => w.includes("معطّلة"))).toBe(true);
  });

  it("S8.3 السقف يقصّ المراحل الأخيرة ويحذّر", () => {
    const t = simulateStageTimeline(stagesFromReminders([30, 360, 1440]), 2);
    expect(t.steps).toHaveLength(2);
    expect(t.warnings.some((w) => w.includes("سقف"))).toBe(true);
  });

  it("S8.4 مرحلة نهائية توقف الخط الزمني بعدها", () => {
    const stages: RecoveryStage[] = [
      { key: "a", nameAr: "أ", position: 1, delayMinutes: 30, templateId: null, isActive: true, isTerminal: false, maxTotalMessages: null },
      { key: "b", nameAr: "ب", position: 2, delayMinutes: 360, templateId: null, isActive: true, isTerminal: true, maxTotalMessages: null },
      { key: "c", nameAr: "ج", position: 3, delayMinutes: 1440, templateId: null, isActive: true, isTerminal: false, maxTotalMessages: null },
    ];
    const t = simulateStageTimeline(stages, 10);
    expect(t.steps.map((s) => s.key)).toEqual(["a", "b"]);
  });

  it("S8.5 تتابع غير متصاعد زمنيًا يُنذَر", () => {
    const stages: RecoveryStage[] = [
      { key: "a", nameAr: "أ", position: 1, delayMinutes: 360, templateId: null, isActive: true, isTerminal: false, maxTotalMessages: null },
      { key: "b", nameAr: "ب", position: 2, delayMinutes: 30, templateId: null, isActive: true, isTerminal: false, maxTotalMessages: null },
    ];
    const t = simulateStageTimeline(stages, 10);
    expect(t.warnings.some((w) => w.includes("أسرع"))).toBe(true);
  });

  it("S8.6 المرحلة المرتبطة بقالب تُنذَر بأن الربط يُفعَّل لاحقًا", () => {
    const stages: RecoveryStage[] = [
      { key: "a", nameAr: "أ", position: 1, delayMinutes: 30, templateId: 3, isActive: true, isTerminal: false, maxTotalMessages: null },
    ];
    const t = simulateStageTimeline(stages, 10);
    expect(t.steps[0]?.templateBound).toBe(true);
    expect(t.warnings.some((w) => w.includes("الربط"))).toBe(true);
  });

  it("S8.7 معاينة الإعدادات: التغيير يظهر في السجل والقيم الفعّالة", () => {
    const p = buildRecoveryPlanPreview({ draft: { maxMessages: 2, scores: { add_to_cart: 55 } }, saved: null, enabled: true, stages: base.stages });
    expect(p.ok).toBe(true);
    expect(p.effective.maxMessages).toBe(2);
    expect(p.effective.scores.add_to_cart).toBe(55);
    const change = p.changes.find((c) => c.key === "maxMessages");
    expect(change?.after).toBe("2");
  });

  it("S8.8 dryRun قبل/بعد تعكس القاعدة الموحّدة", () => {
    const on = buildRecoveryPlanPreview({ draft: null, saved: null, enabled: true });
    expect(on.dryRun.before).toBe(false);
    expect(on.dryRun.after).toBe(false);
    const toDry = buildRecoveryPlanPreview({ draft: { dryRun: true }, saved: null, enabled: true });
    expect(toDry.dryRun.after).toBe(true);
    const off = buildRecoveryPlanPreview({ draft: null, saved: null, enabled: false });
    expect(off.dryRun.after).toBe(true);
  });

  it("S8.9 أخطاء الفحص المسبقة تعطّل المعاينة", () => {
    const p = buildRecoveryPlanPreview({ enabled: true, parseErrors: ["حقل غير معروف: x"] });
    expect(p.ok).toBe(false);
    expect(p.errors[0]).toContain("غير معروف");
  });

  it("S8.10 معاينة المراحل: مسودة ناقصة تُنذَر ولا تُسقط الباقي", () => {
    const p = buildStagePlanPreview({
      stages: [
        { key: "a", nameAr: "أ", position: 1, delayMinutes: 30, isActive: true, isTerminal: false, maxTotalMessages: null, templateId: null },
        { key: "", nameAr: "بلا مفتاح", position: 2, delayMinutes: 60, isActive: true, isTerminal: false, maxTotalMessages: null, templateId: null },
      ],
      maxMessages: 3,
    });
    expect(p.ok).toBe(true);
    expect(p.timeline.steps.map((s) => s.key)).toEqual(["a"]);
    expect(p.errors[0]).toContain("غير مكتملة");
  });

  it("S8.11 معاينة مراحل فارغة ⇒ خطة افتراضية وبلا نجاح", () => {
    const p = buildStagePlanPreview({ stages: [], maxMessages: 3 });
    expect(p.ok).toBe(false);
    expect(p.timeline.usedFallback).toBe(true);
  });
});

// ============================================================
// 9) الكتابة الآمنة في القاعدة الوهمية (المرحلة 2)
// ============================================================

type OpCall = { table: string; op: string; payload?: unknown };

function makeFakeDb(opts: { tables?: Record<string, Record<string, unknown>[]>; fail?: { table: string; op: string; code: string; message: string } } = {}) {
  const calls: OpCall[] = [];
  const tables = opts.tables ?? {};

  const resultFor = (op: string, table: string): { data: unknown; error: unknown } => {
    if (opts.fail && opts.fail.table === table && opts.fail.op === op) {
      return { data: null, error: { code: opts.fail.code, message: opts.fail.message } };
    }
    if (op === "select") return { data: tables[table] ?? [], error: null };
    if (op === "maybeSingle") return { data: (tables[table] ?? [])[0] ?? null, error: null };
    return { data: null, error: null };
  };

  const chained = (table: string) => {
    const state: { op: string } = { op: "noop" };
    const chain: Record<string, unknown> = {
      select() {
        state.op = "select";
        calls.push({ table, op: "select" });
        return chain;
      },
      order(col: string, o?: unknown) {
        calls.push({ table, op: "order", payload: { col, opt: o } });
        return chain;
      },
      limit(n: number) {
        calls.push({ table, op: "limit", payload: n });
        return chain;
      },
      maybeSingle() {
        state.op = "maybeSingle";
        calls.push({ table, op: "maybeSingle" });
        return chain;
      },
      upsert(payload: unknown) {
        state.op = "upsert";
        state.op = "upsert";
        calls.push({ table, op: "upsert", payload });
        return chain;
      },
      update(payload: unknown) {
        state.op = "update";
        calls.push({ table, op: "update", payload });
        return chain;
      },
      insert(payload: unknown) {
        state.op = "insert";
        calls.push({ table, op: "insert", payload });
        return chain;
      },
      delete() {
        state.op = "delete";
        calls.push({ table, op: "delete" });
        return chain;
      },
      eq(k: string, v: unknown) {
        calls.push({ table, op: `${state.op}.eq`, payload: { [k]: v } });
        return chain;
      },
      then(onOk?: (v: unknown) => unknown): Promise<unknown> {
        return Promise.resolve(resultFor(state.op, table)).then(onOk);
      },
    };
    return chain;
  };

  const client = () => ({ from: (table: string) => chained(table) }) as unknown as SupabaseClient;
  return { client, calls };
}

describe("S9 — الكتابة الآمنة", () => {
  it("S9.1 حفظ الإعدادات: دمج جزئي فوق الموجود وupsert بمعرّف واحد", async () => {
    const db = makeFakeDb({ tables: { recovery_settings: [{ config: { maxMessages: 2, expiryHours: 72 } }] } });
    const r = await saveRecoverySettings({ globalCooldownHours: 6 }, { createClient: db.client });
    expect(r.ok).toBe(true);
    const upserts = db.calls.filter((c) => c.op === "upsert");
    expect(upserts).toHaveLength(1);
    const config = (upserts[0]?.payload as { config?: Record<string, unknown> })?.config;
    expect(config?.maxMessages).toBe(2); // الدمج لا يمسح الحقول الغائبة
    expect(config?.expiryHours).toBe(72);
    expect(config?.globalCooldownHours).toBe(6);
    expect((upserts[0]?.payload as { id?: number })?.id).toBe(1);
  });

  it("S9.2 مسودة غير صالحة ⇒ رفض قبل أي كتابة", async () => {
    const db = makeFakeDb();
    const r = await saveRecoverySettings({ maxMessages: 0 }, { createClient: db.client });
    expect(r.ok).toBe(false);
    expect(db.calls.filter((c) => c.op === "upsert")).toHaveLength(0);
  });

  it("S9.3 خطأ upsert من القاعدة ⇒ نتيجة آمنة", async () => {
    const db = makeFakeDb({ fail: { table: "recovery_settings", op: "upsert", code: "23505", message: "duplicate" } });
    const r = await saveRecoverySettings({ expiryHours: 24 }, { createClient: db.client });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("23505");
  });

  it("S9.4 إضافة مرحلة جديدة بموضع معيّن تُدرج به", async () => {
    const db = makeFakeDb();
    const r = await saveRecoveryStage(
      { key: "winback", nameAr: "استرجاع", position: 4, delayMinutes: 30, isActive: true, isTerminal: false, maxTotalMessages: 2, templateId: null },
      { createClient: db.client },
    );
    expect(r.ok).toBe(true);
    const insert = db.calls.find((c) => c.op === "insert");
    const payload = insert?.payload as Record<string, unknown>;
    expect(payload?.position).toBe(4);
    expect(payload?.key).toBe("winback");
  });

  it("S9.5 مرحلة جديدة بلا موضع تأخذ أقصى موجود + 1", async () => {
    const db = makeFakeDb({ tables: { recovery_stages: [{ position: 5 }] } });
    const r = await saveRecoveryStage(
      { key: "next", nameAr: "تالية", position: 0, delayMinutes: 60, isActive: true, isTerminal: false, maxTotalMessages: null, templateId: null },
      { createClient: db.client },
    );
    expect(r.ok).toBe(true);
    const insert = db.calls.find((c) => c.op === "insert");
    expect((insert?.payload as Record<string, unknown>)?.position).toBe(6);
  });

  it("S9.6 تعديل مرحلة بمعرّف ⇒ update محدود بالمعرّف", async () => {
    const db = makeFakeDb();
    const r = await saveRecoveryStage(
      { id: 7, key: "x", nameAr: "س", position: 2, delayMinutes: 90, isActive: false, isTerminal: true, maxTotalMessages: null, templateId: 4 },
      { createClient: db.client },
    );
    expect(r.ok).toBe(true);
    const update = db.calls.find((c) => c.op === "update");
    expect((update?.payload as Record<string, unknown>)?.is_active).toBe(false);
    expect(db.calls.find((c) => c.op === "update.eq")).toBeTruthy();
  });

  it("S9.7 مرحلة غير صالحة ⇒ رفض قبل الكتابة", async () => {
    const db = makeFakeDb();
    const r = await saveRecoveryStage(
      { key: "bad key", nameAr: "س", position: 1, delayMinutes: 10, isActive: true, isTerminal: false, maxTotalMessages: null, templateId: null },
      { createClient: db.client },
    );
    expect(r.ok).toBe(false);
    expect(db.calls.filter((c) => c.op === "insert" || c.op === "update")).toHaveLength(0);
  });

  it("S9.8 حذف مرحلة: معرّف غير صالح مرفوض، والصالح يحذف", async () => {
    const bad = await deleteRecoveryStage(0, { createClient: makeFakeDb().client });
    expect(bad.ok).toBe(false);
    const db = makeFakeDb();
    const r = await deleteRecoveryStage(3, { createClient: db.client });
    expect(r.ok).toBe(true);
    const eq = db.calls.find((c) => c.op === "delete.eq");
    expect((eq?.payload as Record<string, unknown>).id).toBe(3);
  });

  it("S9.9 تفعيل/تعطيل: معرّف غير صالح مرفوض، والصالح يحدّث is_active", async () => {
    expect((await setRecoveryStageActive(-1, true, { createClient: makeFakeDb().client })).ok).toBe(false);
    const db = makeFakeDb();
    const r = await setRecoveryStageActive(2, true, { createClient: db.client });
    expect(r.ok).toBe(true);
    const update = db.calls.find((c) => c.op === "update");
    expect((update?.payload as Record<string, unknown>).is_active).toBe(true);
  });

  it("S9.10 إعادة الترتيب: مجموعة مختلفة عن القاعدة تُرفض", async () => {
    const db = makeFakeDb({ tables: { recovery_stages: [{ id: 1 }, { id: 2 }] } });
    const r = await reorderRecoveryStages([1, 2, 3], { createClient: db.client });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("لا تطابق");
  });

  it("S9.11 إعادة ترتيب صالحة تحدِّث المواضع بالترتيب", async () => {
    const db = makeFakeDb({ tables: { recovery_stages: [{ id: 1 }, { id: 2 }, { id: 3 }] } });
    const r = await reorderRecoveryStages([3, 1, 2], { createClient: db.client });
    expect(r.ok).toBe(true);
    const updates = db.calls.filter((c) => c.op === "update");
    expect(updates.map((u) => (u.payload as { position: number }).position)).toEqual([1, 2, 3]);
    const eqs = db.calls.filter((c) => c.op === "update.eq");
    expect(eqs.map((c) => (c.payload as Record<string, unknown>).id)).toEqual([3, 1, 2]);
  });

  it("S9.12 readRecoveryStagesAll يعرض الصف المعطوب مع تلميحه", async () => {
    const db = makeFakeDb({
      tables: {
        recovery_stages: [
          { id: 1, key: "good", name_ar: "سليم", position: 1, delay_minutes: 30, is_active: true, is_terminal: false, max_total_messages: null },
          { id: 2, key: "Bad Key", name_ar: "عطل", position: 2, delay_minutes: 60, is_active: true, is_terminal: false, max_total_messages: null },
        ],
      },
    });
    const r = await readRecoveryStagesAll({ createClient: db.client });
    expect(r.source).toBe("db");
    expect(r.rows[0]?.valid).toBe(true);
    expect(r.rows[1]?.valid).toBe(false);
    expect(r.rows[1]?.hint).toContain("مفتاح");
  });

  it("S9.13 listRecoveryTemplates يقرأ القوالب ويخفّف الحقول", async () => {
    const db = makeFakeDb({
      tables: {
        recovery_templates: [{ id: 4, key: "welcome", name_ar: "ترحيب", body: "مرحبًا", is_active: true, version: 2 }],
      },
    });
    const r = await listRecoveryTemplates({ createClient: db.client });
    expect(r.templates).toHaveLength(1);
    expect(r.templates[0]?.id).toBe(4);
    expect(r.templates[0]?.key).toBe("welcome");
    expect(r.templates[0]?.version).toBe(2);
  });
});

describe("S10 — فحص ومعاينة القوالب (وحدة نقية)", () => {
  it("S10.1 إدخال سليم يُمرَّر مع تطبيع الحقول", () => {
    const r = parseTemplateInput({
      key: "  WINBACK  ",
      nameAr: "  رسالة استعادة  ",
      title: "",
      body: "مرحبًا {{customer.name}}، سلتك: {{cart.value_formatted}}",
      isActive: true,
    });
    expect(r.ok).toBe(true);
    expect(r.template?.key).toBe("winback");
    expect(r.template?.nameAr).toBe("رسالة استعادة");
    expect(r.template?.isActive).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("S10.2 مفتاح/اسم/نص ناقص ⇒ رفض قبل أي كتابة", () => {
    expect(parseTemplateInput({ key: "", nameAr: "س", body: "نص" }).ok).toBe(false);
    expect(parseTemplateInput({ key: "Bad Key!", nameAr: "س", body: "نص" }).ok).toBe(false);
    expect(parseTemplateInput({ key: "ok", nameAr: "  ", body: "نص" }).ok).toBe(false);
    expect(parseTemplateInput({ key: "ok", nameAr: "س", body: "" }).ok).toBe(false);
  });

  it("S10.3 متغير غير معروف يمنع الحفظ", () => {
    const r = parseTemplateInput({ key: "x", nameAr: "س", body: "مرحبًا {{nope.vm}} نهاية" });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("غير معروفة");
    expect(r.errors.join(" ")).toContain("nope.vm");
  });

  it("S10.4 discount.* داخلية: تُقبل مع تنبيه، لا تصل للعميل", () => {
    const r = parseTemplateInput({ key: "x", nameAr: "س", body: "خصم {{discount.percent}}" });
    expect(r.ok).toBe(true);
    expect(r.warnings.join(" ")).toContain("discount.percent");
  });

  it("S10.5 النص محدد بالسقف 2000 حرف", () => {
    expect(parseTemplateInput({ key: "x", nameAr: "س", body: "a".repeat(2001) }).ok).toBe(false);
    expect(parseTemplateInput({ key: "x", nameAr: "س", body: "a".repeat(2000) }).ok).toBe(true);
  });

  it("S10.6 isTemplateKeyValid يطابق قيد المفتاح فقط", () => {
    expect(isTemplateKeyValid("winback_v1")).toBe(true);
    expect(isTemplateKeyValid("Bad Key")).toBe(false);
    expect(isTemplateKeyValid("")).toBe(false);
  });

  it("S10.7 templateRowHint يميز الصف السليم عن المعطوب", () => {
    expect(templateRowHint({ key: "good", name_ar: "سليم", body: "مرحبًا {{customer.name}}" })).toBeNull();
    expect(templateRowHint({ key: "Bad Key", name_ar: "سليم", body: "نص" })).toContain("مفتاح");
    expect(templateRowHint({ key: "good", name_ar: "سليم", body: "{{nope.x}}" })).toContain("غير معروفة");
  });

  it("S10.8 القيم التجريبية تغطي كل متغير في القاموس", () => {
    const values = buildTrialTemplateValues();
    expect(Object.keys(values).length).toBe(RECOVERY_VARIABLES.length);
    for (const v of RECOVERY_VARIABLES) expect(Object.prototype.hasOwnProperty.call(values, v.name)).toBe(true);
  });

  it("S10.9 معاينة: عرض العميل يحجب discount.* ويبقيه للمراجعة الداخلية", () => {
    const body = "مرحبًا {{customer.name}} — اقتراحنا: {{discount.percent}}";
    const customerView = previewTemplate(body, { customerView: true });
    const internalView = previewTemplate(body, { customerView: false });
    expect(customerView.ok).toBe(true);
    expect(customerView.text).not.toContain("discount.percent");
    expect(customerView.blockedInternal).toEqual(["discount.percent"]);
    expect(internalView.blockedInternal).toEqual([]);
    expect(customerView.text).not.toContain("10%"); // قيمة تجريبية لخصم داخلي
    expect(internalView.text).toContain("10%"); // متاحة في المعاينة الداخلية فقط
    const internalToken = customerView.tokens.find((t) => t.internalOnly);
    expect(internalToken?.rendered ?? "").toBe("");
  });

  it("S10.10 describeTemplateTokens يجد تعريف كل متغير في النص", () => {
    const used = describeTemplateTokens("أهلا {{customer.name}} و {{cart.value_formatted}}");
    expect(used.map((u) => u.name)).toEqual(["customer.name", "cart.value_formatted"]);
    expect(used.every((u) => u.def !== null)).toBe(true);
  });
});

describe("S11 — كتابة القوالب (عميل وهمي)", () => {
  it("S11.1 إضافة قالب سليم ⇒ insert بمحتوى كامل وversion 1", async () => {
    const db = makeFakeDb();
    const r = await saveRecoveryTemplate(
      { key: "winback", nameAr: "استعادة أولى", title: "", body: "مرحبًا {{customer.name}}", isActive: true },
      { createClient: db.client },
    );
    expect(r.ok).toBe(true);
    const insert = db.calls.find((c) => c.op === "insert");
    const payload = insert?.payload as Record<string, unknown>;
    expect(payload?.key).toBe("winback");
    expect(payload?.name_ar).toBe("استعادة أولى");
    expect(payload?.version).toBe(1);
    expect(payload?.is_active).toBe(true);
  });

  it("S11.2 مفتاح مكرر ⇒ رفض قبل أي كتابة", async () => {
    const db = makeFakeDb({
      tables: { recovery_templates: [{ id: 1, key: "dup", name_ar: "موجود", body: "نص", is_active: true, version: 1 }] },
    });
    const r = await saveRecoveryTemplate(
      { key: "dup", nameAr: "جديد", title: "", body: "نص آخر", isActive: true },
      { createClient: db.client },
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain("مستخدم في قالب آخر");
    expect(db.calls.filter((c) => c.op === "insert" || c.op === "update")).toHaveLength(0);
  });

  it("S11.3 تعديل قالب ⇒ update برفع version", async () => {
    const db = makeFakeDb({
      tables: { recovery_templates: [{ id: 7, key: "winback", name_ar: "استعادة", body: "مرحبًا {{customer.name}}", is_active: true, version: 2 }] },
    });
    const r = await saveRecoveryTemplate(
      { id: 7, key: "winback", nameAr: "استعادة (مُعدّلة)", title: "", body: "مرحبًا {{customer.name}} — عدنا", isActive: true },
      { createClient: db.client },
    );
    expect(r.ok).toBe(true);
    const update = db.calls.find((c) => c.op === "update");
    const payload = update?.payload as Record<string, unknown>;
    expect(payload?.version).toBe(3);
    expect(payload?.name_ar).toBe("استعادة (مُعدّلة)");
    expect(db.calls.find((c) => c.op === "update.eq")).toBeTruthy();
  });

  it("S11.4 قالب فيه متغير غير معروف ⇒ رفض بلا كتابة", async () => {
    const db = makeFakeDb();
    const r = await saveRecoveryTemplate(
      { key: "bad", nameAr: "س", title: "", body: "مرحبًا {{unknown.var}}", isActive: true },
      { createClient: db.client },
    );
    expect(r.ok).toBe(false);
    expect(db.calls.filter((c) => c.op === "insert" || c.op === "update")).toHaveLength(0);
  });

  it("S11.5 حذف قالب: معرّف غير صالح مرفوض، والصالح يحذف", async () => {
    expect((await deleteRecoveryTemplate(0, { createClient: makeFakeDb().client })).ok).toBe(false);
    const db = makeFakeDb();
    const r = await deleteRecoveryTemplate(3, { createClient: db.client });
    expect(r.ok).toBe(true);
    const eq = db.calls.find((c) => c.op === "delete.eq");
    expect((eq?.payload as Record<string, unknown>).id).toBe(3);
  });

  it("S11.6 تفعيل/تعطيل قالب: يحدّث is_active فقط", async () => {
    expect((await setRecoveryTemplateActive(-1, true, { createClient: makeFakeDb().client })).ok).toBe(false);
    const db = makeFakeDb();
    const r = await setRecoveryTemplateActive(2, false, { createClient: db.client });
    expect(r.ok).toBe(true);
    const update = db.calls.find((c) => c.op === "update");
    expect((update?.payload as Record<string, unknown>).is_active).toBe(false);
  });

  it("S11.7 readRecoveryTemplatesAll يعرض الكل مع تقييم الصلاحية", async () => {
    const db = makeFakeDb({
      tables: {
        recovery_templates: [
          { id: 1, key: "good", name_ar: "سليم", title: "", body: "مرحبًا {{customer.name}}", is_active: false, version: 1 },
          { id: 2, key: "Bad Key", name_ar: "معطوب", title: "", body: "نص", is_active: true, version: 1 },
        ],
      },
    });
    const r = await readRecoveryTemplatesAll({ createClient: db.client });
    expect(r.templates).toHaveLength(9);
    expect(r.templates[0]?.isActive).toBe(false);
    expect(r.templates[1]?.valid).toBe(false);
    expect(r.templates[1]?.hint).toContain("مفتاح");
  });

  it("S11.8 listStageTemplateBindings يربط المراحل بقوالبها", async () => {
    const db = makeFakeDb({
      tables: {
        recovery_stages: [
          { id: 1, key: "first", name_ar: "أولى", position: 1, delay_minutes: 30, is_active: true, is_terminal: false, max_total_messages: null, template_id: 9 },
          { id: 2, key: "second", name_ar: "ثانية", position: 2, delay_minutes: 60, is_active: true, is_terminal: false, max_total_messages: null, template_id: 9 },
          { id: 3, key: "third", name_ar: "ثالثة", position: 3, delay_minutes: 60, is_active: true, is_terminal: false, max_total_messages: null, template_id: null },
        ],
      },
    });
    const r = await listStageTemplateBindings({ createClient: db.client });
    expect(r.bindings[9]).toHaveLength(2);
    expect(r.bindings[9]?.map((b) => b.key)).toEqual(["first", "second"]);
    expect(r.bindings[10]).toBeUndefined();
  });

  // ============================================================
  // G6-D: discount.* variables — مقفولة بلا قسيمة
  // ============================================================
  describe("G6-D — discount.* variables", () => {
    const coupon: RecoveryCouponView = {
      code: "RC7K4M9QX2",
      type: "percent",
      value: 10,
      computedValue: 40,
      expiresAt: "2026-10-02T00:00:00.000Z",
    };

    it("discount.code/type/value/expires_at تُعرض مع قسيمة", () => {
      const out = renderTemplate(
        "كودك {{discount.code}} — {{discount.type}} {{discount.value}} حتى {{discount.expires_at}}",
        {},
        { coupon }
      );
      expect(out.text).toBe("كودك RC7K4M9QX2 — نسبة 10% حتى 2026/10/02");
      expect(out.blockedCoupon).toEqual([]);
    });

    it("بلا قسيمة ⇒ discount.* تُحجب والقالب كله يُرفض", () => {
      const out = renderTemplate(
        "كودك {{discount.code}} — {{discount.type}} {{discount.value}} حتى {{discount.expires_at}}",
        {},
        { coupon: null }
      );
      expect(out.blockedCoupon).toContain("discount.code");
      expect(out.blockedCoupon).toContain("discount.type");
      expect(out.blockedCoupon).toContain("discount.value");
      expect(out.blockedCoupon).toContain("discount.expires_at");
      expect(out.text).toBe("كودك  —   حتى ");
    });

    it("discount.value لا يتسرب من الاقتراح الداخلي بلا قسيمة", () => {
      const values = buildRecoveryVariables({
        case: {
          id: "case-1",
          customerId: "cust-1",
          customerPhone: "966533220646",
          visitorId: "v",
          sessionId: "s",
          caseType: "ADD_TO_CART",
          status: "OPEN",
          score: 40,
          cartValue: 400,
          productIds: ["p1"],
          preferredProductId: "p1",
          preferredProductSlug: "mini-bag",
          firstDetectedAt: 0,
          lastActivityAt: 0,
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
          createdAt: 0,
          updatedAt: 0,
        },
        discount: { percent: 10, value: 40, cap: 50 },
        coupon: null,
      });
      expect(values["discount.value"]).toBeUndefined();
      expect(values["discount.proposal_value"]).toBe("40");
    });

    it("discount.value يعرض قيمة القسيمة لا الاقتراح عند وجود قسيمة", () => {
      const values = buildRecoveryVariables({
        case: {
          id: "case-1",
          customerId: "cust-1",
          customerPhone: "966533220646",
          visitorId: "v",
          sessionId: "s",
          caseType: "ADD_TO_CART",
          status: "OPEN",
          score: 40,
          cartValue: 400,
          productIds: ["p1"],
          preferredProductId: "p1",
          preferredProductSlug: "mini-bag",
          firstDetectedAt: 0,
          lastActivityAt: 0,
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
          createdAt: 0,
          updatedAt: 0,
        },
        discount: { percent: 10, value: 40, cap: 50 },
        coupon,
      });
      expect(values["discount.value"]).toBe("10%");
    });
  });
});

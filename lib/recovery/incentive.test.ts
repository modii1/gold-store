/**
 * G6-C — اختبارات بوابة قسيمة الاسترجاع.
 *
 * الوحدة خالصة، فكل اختبار هنا قاعدةٌ لا I/O: من يستدعي createIncentive
 * يلتزم بالنتائج. لا اختبار يلمس Supabase ولا شبكة.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_RECOVERY_CONFIG } from "./config";
import type { RecoveryConfig } from "./config";
import { canCreateIncentive, computedDiscount, createIncentive, getExistingIncentive, resolveEndsAt, resolveMaxDiscount, resolvePercent, toView } from "./incentive";
import type { CouponIncentiveRow, IncentiveRequest, IncentiveStore } from "./incentive";
import type { RecoveryCase } from "./types";
import { discountForCoupon } from "@/lib/coupons/policy";

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const HOUR = 3_600_000;
const PHONE = "966500000001";

function cfgWith(over: Partial<RecoveryConfig> = {}): RecoveryConfig {
  return { ...DEFAULT_RECOVERY_CONFIG, enabled: true, dryRun: false, ...over };
}

function caseFixture(over: Partial<RecoveryCase> = {}): RecoveryCase {
  return {
    id: "case-1",
    customerId: "cust-1",
    customerPhone: PHONE,
    visitorId: "visitor-1",
    sessionId: "session-1",
    caseType: "ADD_TO_CART",
    status: "OPEN",
    score: 25,
    cartValue: 600,
    productIds: ["p-1"],
    preferredProductId: "p-1",
    preferredProductSlug: "gold-ring",
    firstDetectedAt: NOW - 8 * HOUR,
    lastActivityAt: NOW - 30 * HOUR,
    lastMessageAt: NOW - 26 * HOUR,
    messageCount: 1,
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
    createdAt: NOW - 8 * HOUR,
    updatedAt: NOW,
    ...over,
  };
}

/**
 * `over.c` هنا تغطية جزئية للحالة: تدمج فوق الـfixture الكامل، فتكتب
 * الاختبارات `request({ c: { discountRef: "X" } })` بلا cast.
 */
function request(over: Partial<Omit<IncentiveRequest, "c">> & { c?: Partial<RecoveryCase> } = {}): IncentiveRequest {
  return {
    c: caseFixture(over.c ?? {}),
    cfg: over.cfg ?? cfgWith(),
    incentiveCandidate: over.incentiveCandidate ?? true,
    now: over.now ?? NOW,
  };
}

/** مخزن في الذاكرة يحاكي unique على recovery_case_id ومولّد أكواد. */
class FakeIncentiveStore implements IncentiveStore {
  readonly rows = new Map<string, CouponIncentiveRow>();
  readonly inserted: CouponIncentiveRow[] = [];
  readonly marks: { caseId: string; code: string; at: number }[] = [];
  takenCodes = new Set<string>();
  failInsert: Error | null = null;
  /** يُكتب في المخزن لحظة محاولة الإدراج ثم يُرفض إدراجنا (سباق حقيقي). */
  raceWinner: CouponIncentiveRow | null = null;
  private attempts = 0;

  constructor(seed?: CouponIncentiveRow) {
    if (seed) {
      this.rows.set(seed.recovery_case_id ?? seed.id, seed);
      this.takenCodes.add(seed.code);
    }
  }

  async findByCaseId(caseId: string) {
    return this.rows.get(caseId) ?? null;
  }

  async codeExists(code: string) {
    return this.takenCodes.has(code);
  }

  async insert(row: CouponIncentiveRow) {
    // سباق حقيقي: يُكتب الفائز في القاعدة أثناء محاولة إدراجنا، ثم يفشل
    // إدراجنا بـ23505. هكذا يُختبر مسار التعافي فعلًا لا القراءة المبكرة.
    if (this.raceWinner) {
      const winner = this.raceWinner;
      this.raceWinner = null;
      this.rows.set(winner.recovery_case_id ?? "", winner);
      this.takenCodes.add(winner.code);
      throw Object.assign(new Error("duplicate key value violates unique constraint \"coupons_recovery_case_unique\""), { code: "23505" });
    }
    if (this.failInsert) throw this.failInsert;
    const caseId = row.recovery_case_id ?? "";
    if (this.rows.has(caseId)) {
      // unique(recovery_case_id) في القاعدة
      throw Object.assign(new Error("duplicate key value violates unique constraint \"coupons_recovery_case_unique\""), { code: "23505" });
    }
    this.rows.set(caseId, row);
    this.inserted.push(row);
    this.takenCodes.add(row.code);
  }

  async markCaseDiscounted(caseId: string, code: string, at: number) {
    this.marks.push({ caseId, code, at });
  }

  /** مولّد حتمي: كود فريد لكل محاولة. */
  nextCode = () => {
    this.attempts += 1;
    return `CODE${String(this.attempts).padStart(12, "0")}`;
  };

  generate = async () => this.nextCode();
}

describe("G6-C — بوابة قسيمة الاسترجاع", () => {
  describe("الأهلية (canCreateIncentive)", () => {
    it("1) مرشّح من المحرك + كل الشروط ⇒ يُنشأ", () => {
      expect(canCreateIncentive(request())).toEqual({ ok: true, percent: 10 });
    });

    it("2) بلا مرشّح من المحرك ⇒ لا شيء (page_view/add_to_cart وحدها لا تكفي)", () => {
      const r = canCreateIncentive(request({ incentiveCandidate: false }));
      expect(r).toEqual({ ok: false, reason: "not_incentive_candidate" });
    });

    it("3) سلة تحت الحد الأدنى (100) ⇒ لا", () => {
      const r = canCreateIncentive(request({ c: { cartValue: 99 } as Partial<RecoveryCase> }));
      expect(r).toEqual({ ok: false, reason: "cart_below_minimum" });
    });

    it("4) أقدم من 24 ساعة فقط ⇒ لا (لا كوبون فوري على سلة حديثة)", () => {
      const r = canCreateIncentive(request({ c: { lastActivityAt: NOW - 23 * HOUR } as Partial<RecoveryCase> }));
      expect(r).toEqual({ ok: false, reason: "too_early" });
    });

    it("5) تجاوز 24 ساعة + تذكير سابق ⇒ نعم", () => {
      const r = canCreateIncentive(request({ c: { lastActivityAt: NOW - 25 * HOUR, messageCount: 1 } as Partial<RecoveryCase> }));
      expect(r.ok).toBe(true);
    });

    it("6) بلا تذكير سابق و discountRequiresPriorReminder ⇒ لا", () => {
      const r = canCreateIncentive(request({ c: { messageCount: 0 } as Partial<RecoveryCase> }));
      expect(r).toEqual({ ok: false, reason: "prior_reminder_missing" });
    });

    it("7) تجاوز maxDiscountsPerCase ⇒ لا", () => {
      const r = canCreateIncentive(request({ c: { discountCount: 1 } as Partial<RecoveryCase> }));
      expect(r).toEqual({ ok: false, reason: "discount_limit_reached" });
    });

    it("8) discountRef موجود ⇒ لا (قيمة من دورة سابقة)", () => {
      const r = canCreateIncentive(request({ c: { discountRef: "SOMECODE" } as Partial<RecoveryCase> }));
      expect(r).toEqual({ ok: false, reason: "discount_limit_reached" });
    });

    it("9) داخل cooldown (168h) ⇒ لا", () => {
      const r = canCreateIncentive(request({ c: { lastDiscountAt: NOW - 100 * HOUR } as Partial<RecoveryCase> }));
      expect(r).toEqual({ ok: false, reason: "cooldown_active" });
    });

    it("10) خارج cooldown ⇒ نعم", () => {
      const r = canCreateIncentive(request({ c: { lastDiscountAt: NOW - 200 * HOUR } as Partial<RecoveryCase> }));
      expect(r.ok).toBe(true);
    });

    it("11) جوال غير صالح ⇒ لا (لا صفّ بلا مالك)", () => {
      const r = canCreateIncentive(request({ c: { customerPhone: "123" } as Partial<RecoveryCase> }));
      expect(r).toEqual({ ok: false, reason: "invalid_phone" });
    });

    it("12) dry_run ⇒ لا كتابة إطلاقًا", () => {
      const r = canCreateIncentive(request({ cfg: cfgWith({ dryRun: true }) }));
      expect(r).toEqual({ ok: false, reason: "dry_run" });
    });

    it("13) recovery_enabled=false ⇒ لا", () => {
      const r = canCreateIncentive(request({ cfg: cfgWith({ enabled: false }) }));
      expect(r).toEqual({ ok: false, reason: "recovery_disabled" });
    });
  });

  describe("السياسات المشتقّة (percent / cap / ends_at)", () => {
    it("14) النسبة = min(الاقتراح، السقف) ولا تُكسر", () => {
      expect(resolvePercent(cfgWith({ proposedRecoveryDiscountPercent: 10, maxRecoveryDiscountPercent: 10 }))).toBe(10);
      expect(resolvePercent(cfgWith({ proposedRecoveryDiscountPercent: 25, maxRecoveryDiscountPercent: 10 }))).toBe(10);
      expect(resolvePercent(cfgWith({ proposedRecoveryDiscountPercent: 7.5, maxRecoveryDiscountPercent: 10 }))).toBe(7);
    });

    it("15) اقتراح أو سقف غير صالح ⇒ null (لا قسيمة بنصف سياسة)", () => {
      expect(resolvePercent(cfgWith({ proposedRecoveryDiscountPercent: 0 }))).toBeNull();
      expect(resolvePercent(cfgWith({ maxRecoveryDiscountPercent: 0 }))).toBeNull();
      expect(resolvePercent(cfgWith({ proposedRecoveryDiscountPercent: Number.NaN }))).toBeNull();
    });

    it("16) سقف المبلغ يأتي من الإعدادات ويُخزَّن في الصف", () => {
      expect(resolveMaxDiscount(cfgWith({ maxRecoveryDiscountAmount: 50 }))).toBe(50);
      expect(resolveMaxDiscount(cfgWith({ maxRecoveryDiscountAmount: 0 }))).toBeNull();
    });

    it("17) ends_at = الأسبق بين صلاحية القسيمة ونهاية مهلة الحالة", () => {
      // الحالة شوهدت قبل ساعتين، والمهلة 96 ساعة ⇒ تنتهي بعد 94 ساعة.
      const fresh = caseFixture({ firstDetectedAt: NOW - 2 * HOUR });
      expect(resolveEndsAt(request({ c: fresh, cfg: cfgWith({ expiryHours: 96 }) }))).toBe(
        new Date(NOW + 94 * HOUR).toISOString()
      );
      // حالة على وشك انتهاء المهلة: مهلة الحالة هي الأسبق (بعد ساعة).
      const aging = caseFixture({ firstDetectedAt: NOW - 95 * HOUR });
      expect(resolveEndsAt(request({ c: aging, cfg: cfgWith({ expiryHours: 96 }) }))).toBe(
        new Date(NOW + HOUR).toISOString()
      );
      // مهلة أقصر من صلاحية القسيمة ⇒ المهلة هي الأسبق.
      expect(resolveEndsAt(request({ c: fresh, cfg: cfgWith({ expiryHours: 3 }) }))).toBe(
        new Date(NOW + HOUR).toISOString()
      );
    });

    it("18) حالة انتهت مهلتها ⇒ لا قسيمة منتهية تُنشأ", () => {
      const r = createIncentive(
        request({ c: { firstDetectedAt: NOW - 200 * HOUR } as Partial<RecoveryCase>, cfg: cfgWith({ expiryHours: 24 }) }),
        new FakeIncentiveStore()
      );
      return expect(r).resolves.toEqual({ ok: false, reason: "invalid_discount_policy", created: false });
    });
  });

  describe("السقف على السلة (computedDiscount)", () => {
    it("19) 10% من 600 = 60 ⇒ تُقصّ إلى 50 (السقف مُطبَّق فعلًا)", () => {
      expect(computedDiscount(10, 600, 50)).toBe(50);
    });

    it("20) 10% من 300 = 30 ⇒ تحت السقف بلا قصّ", () => {
      expect(computedDiscount(10, 300, 50)).toBe(30);
    });

    it("21) الخصم لا يتجاوز السلة ولا السقف — أيهما أصغر", () => {
      // 50% من 40 = 20 (ليس 40: النسبة تُطبَّق على السلة).
      expect(computedDiscount(50, 40, 50)).toBe(20);
      // 100% من 40 = 40 = السلة بالضبط، لا أكثر.
      expect(computedDiscount(100, 40, null)).toBe(40);
      // 90% من 40 = 36 ⇒ السقف 30 هو الأصغر.
      expect(computedDiscount(90, 40, 30)).toBe(30);
      // سلة صفرية ⇒ لا خصم.
      expect(computedDiscount(10, 0, 50)).toBe(0);
    });

    it("22) بلا سقف مبلغ (null) ⇒ النسبة كاملة", () => {
      expect(computedDiscount(10, 1000, null)).toBe(100);
    });
  });

  describe("الإنشاء (createIncentive)", () => {
    it("23) ينشئ صفًا واحدًا بكل القيود ويعيد العرض", async () => {
      const store = new FakeIncentiveStore();
      const res = await createIncentive(request(), store, { generateCode: store.generate });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.created).toBe(true);
      expect(res.coupon.code).toBe("CODE000000000001");
      expect(res.coupon.computedValue).toBe(50);
      const row = store.inserted[0];
      expect(row.usage_limit).toBe(1);
      expect(row.used_count).toBe(0);
      expect(row.customer_identifier).toBe(PHONE);
      expect(row.recovery_case_id).toBe("case-1");
      expect(row.scope).toBe("customer");
      expect(row.source).toBe("recovery");
      expect(row.max_discount).toBe(50);
      expect(row.min_order).toBe(100);
      expect(row.is_active).toBe(true);
    });

    it("24) الاستبدال لا يحدث عند الإنشاء: used_count يبقى صفرًا", async () => {
      const store = new FakeIncentiveStore();
      await createIncentive(request(), store, { generateCode: store.generate });
      expect(store.inserted[0].used_count).toBe(0);
    });

    it("25) حالة الحالة تُعلَّم بالكود بعد الإنشاء", async () => {
      const store = new FakeIncentiveStore();
      const res = await createIncentive(request(), store, { generateCode: store.generate });
      expect(store.marks).toHaveLength(1);
      expect(store.marks[0].code).toBe(res.ok ? res.coupon.code : "");
      expect(store.marks[0].at).toBe(NOW);
    });

    it("26) استدعاء ثانٍ لنفس الحالة ⇒ نفس القسيمة بلا كتابة جديدة (idempotent)", async () => {
      const store = new FakeIncentiveStore();
      const first = await createIncentive(request(), store, { generateCode: store.generate });
      const second = await createIncentive(request(), store, { generateCode: store.generate });
      expect(first.ok && first.created).toBe(true);
      expect(second.ok && second.created).toBe(false);
      expect(second.ok ? second.coupon.code : "").toBe(first.ok ? first.coupon.code : "");
      expect(store.inserted).toHaveLength(1);
    });

    it("27) سباق: الإدراج يفشل بـ23505 ⇒ نقرأ الفائزة ولا نخترع كودًا ثانيًا", async () => {
      const store = new FakeIncentiveStore();
      const winner: CouponIncentiveRow = {
        id: "w-1",
        code: "WINNERCODE000001",
        type: "percent",
        value: 10,
        max_discount: 50,
        min_order: 100,
        starts_at: new Date(NOW).toISOString(),
        ends_at: new Date(NOW + 48 * HOUR).toISOString(),
        usage_limit: 1,
        used_count: 0,
        is_active: true,
        customer_identifier: PHONE,
        recovery_case_id: "case-1",
        scope: "customer",
        source: "recovery",
      };
      // الفائزة تصل أثناء الإدراج: القراءة الأولى لا تراها، والإدراج يفشل.
      store.raceWinner = winner;
      const res = await createIncentive(request(), store, { generateCode: store.generate });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.created).toBe(false);
      expect(res.coupon.code).toBe("WINNERCODE000001");
      // ولا صفّ لنا: كود واحد للحالة.
      expect(store.inserted).toHaveLength(0);
      expect(store.marks).toHaveLength(0);
    });

    it("28) خطأ قاعدة غير unique ⇒ store_error بلا كود مختلَق", async () => {
      const store = new FakeIncentiveStore();
      store.failInsert = Object.assign(new Error("connection refused"), { code: "08006" });
      const res = await createIncentive(request(), store, { generateCode: store.generate });
      expect(res).toEqual({ ok: false, reason: "store_error", created: false });
      expect(store.inserted).toHaveLength(0);
    });

    it("29) فشل توليد الكود (نفاد المخزون) ⇒ no_coupon_inventory بلا صفّ", async () => {
      const store = new FakeIncentiveStore();
      const res = await createIncentive(request(), store, {
        generateCode: async () => {
          throw new Error("coupon code collision: استُنفدت المحاولات");
        },
      });
      expect(res).toEqual({ ok: false, reason: "no_coupon_inventory", created: false });
      expect(store.inserted).toHaveLength(0);
      expect(store.marks).toHaveLength(0);
    });

    it("30) مولّد يعيد كودًا فارغًا ⇒ يُرفض (لا صفّ بكود فارغ)", async () => {
      const store = new FakeIncentiveStore();
      const res = await createIncentive(request(), store, { generateCode: async () => "   " });
      expect(res).toEqual({ ok: false, reason: "no_coupon_inventory", created: false });
    });

    it("31) dry_run لا يكتب شيئًا إطلاقًا", async () => {
      const store = new FakeIncentiveStore();
      const res = await createIncentive(request({ cfg: cfgWith({ dryRun: true }) }), store, { generateCode: store.generate });
      expect(res).toEqual({ ok: false, reason: "dry_run", created: false });
      expect(store.inserted).toHaveLength(0);
      expect(store.marks).toHaveLength(0);
    });

    it("32) الكود يُطبَّع ويُقصَر في العرض (لا رمز مختلَف للعميل)", async () => {
      const store = new FakeIncentiveStore();
      const res = await createIncentive(request(), store, { generateCode: async () => "  mixedcase0001  " });
      expect(res.ok ? res.coupon.code : "").toBe("MIXEDCASE0001");
    });
  });

  describe("القراءة (getExistingIncentive)", () => {
    it("33) حالة بلا قسيمة ⇒ null", async () => {
      expect(await getExistingIncentive(caseFixture(), new FakeIncentiveStore(), NOW)).toBeNull();
    });

    it("34) قسيمة موجودة ⇒ تُقرأ بحساب سقف صحيح", async () => {
      const row: CouponIncentiveRow = {
        id: "r-1",
        code: "EXISTINGCODE0001",
        type: "percent",
        value: 10,
        max_discount: 50,
        min_order: 0,
        starts_at: null,
        ends_at: new Date(NOW + 48 * HOUR).toISOString(),
        usage_limit: 1,
        used_count: 0,
        is_active: true,
        customer_identifier: PHONE,
        recovery_case_id: "case-1",
        scope: "customer",
        source: "recovery",
      };
      const store = new FakeIncentiveStore(row);
      const view = await getExistingIncentive(caseFixture(), store, NOW);
      expect(view?.code).toBe("EXISTINGCODE0001");
      expect(view?.computedValue).toBe(50);
      expect(view?.expiresAt).toBe(new Date(NOW + 48 * HOUR).toISOString());
    });
  });

  describe("idempotency تحت شروط تُرفض — القراءة تسبق الأهلية", () => {
    const existing = (over: Partial<CouponIncentiveRow> = {}): CouponIncentiveRow => ({
      id: "r-1",
      code: "KEEPCODE0000001",
      type: "percent",
      value: 10,
      max_discount: 50,
      min_order: 0,
      starts_at: new Date(NOW - 2 * HOUR).toISOString(),
      ends_at: new Date(NOW + 48 * HOUR).toISOString(),
      usage_limit: 1,
      used_count: 0,
      is_active: true,
      customer_identifier: PHONE,
      recovery_case_id: "case-1",
      scope: "customer",
      source: "recovery",
      ...over,
    });

    it("36) الحالة موسومة بـdiscountRef ⇒ تُعاد القسيمة نفسها لا «تجاوزت الحد»", async () => {
      // هذا هو Sequencing الذي كسر أي مسار يقرأ الأهلية أولًا: بعد نجاح
      // `markCaseDiscounted` تصبح الحالة موسومة، فلو سبقت القراءةُ الفحصَ
      // لعادت `discount_limit_reached` في كل دورة بعد الأولى.
      const store = new FakeIncentiveStore(existing());
      const res = await createIncentive(
        request({ c: { discountRef: "KEEPCODE0000001", discountCount: 1 } }),
        store,
        { generateCode: store.generate }
      );
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.created).toBe(false);
      expect(res.coupon.code).toBe("KEEPCODE0000001");
      expect(store.inserted).toHaveLength(0);
    });

    it("37) الحالة تحت الحد الأدنى بعد الإنشاء ⇒ القسيمة تُعاد كما هي", async () => {
      // لا تغيّر سلة العميل صلاحية ما مُنح له: الخصم يُحتسب على السلة وقت
      // الطلب، ورفض سلة صغيرة عند الطلب لا يلغي حقه في الكود.
      const store = new FakeIncentiveStore(existing());
      const res = await createIncentive(
        request({ c: { cartValue: 10, discountRef: "KEEPCODE0000001" } }),
        store,
        { generateCode: store.generate }
      );
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.coupon.code).toBe("KEEPCODE0000001");
    });

    it("38) قسيمة منتهية الصلاحية ⇒ تخطٍ صريح، ولا ثانية لها", async () => {
      const store = new FakeIncentiveStore(existing({ ends_at: new Date(NOW - 1).toISOString() }));
      const res = await createIncentive(request(), store, { generateCode: store.generate });
      expect(res).toEqual({ ok: false, reason: "coupon_expired", created: false });
      expect(store.inserted).toHaveLength(0);
    });

    it("39) قسيمة مستهلكة (استُخدمت في طلب) ⇒ لا تُعاد للعميل", async () => {
      const store = new FakeIncentiveStore(existing({ used_count: 1 }));
      const res = await createIncentive(request(), store, { generateCode: store.generate });
      expect(res).toEqual({ ok: false, reason: "coupon_used_up", created: false });
      expect(await getExistingIncentive(caseFixture(), store, NOW)).toBeNull();
    });

    it("40) قسيمة معطّلة يدويًا ⇒ لا تُعاد", async () => {
      const store = new FakeIncentiveStore(existing({ is_active: false }));
      const res = await createIncentive(request(), store, { generateCode: store.generate });
      expect(res).toEqual({ ok: false, reason: "coupon_used_up", created: false });
    });

    it("41) الإيقاف والـdry_run يسبقان القراءة (لا I/O بلا سبب)", async () => {
      const store = new FakeIncentiveStore(existing());
      const res = await createIncentive(
        request({ cfg: cfgWith({ dryRun: true }), c: { discountRef: "KEEPCODE0000001" } }),
        store,
        { generateCode: store.generate }
      );
      expect(res).toEqual({ ok: false, reason: "dry_run", created: false });
    });
  });

  describe("العرض (toView) — لا تسريب داخلي", () => {
    it("35) العرض يحمل الكود والقيمة فقط، بلا case id ولا معرّف عميل", () => {
      const row: CouponIncentiveRow = {
        id: "secret-uuid",
        code: "safe000000001",
        type: "percent",
        value: 10,
        max_discount: 50,
        min_order: 0,
        starts_at: null,
        ends_at: null,
        usage_limit: 1,
        used_count: 0,
        is_active: true,
        customer_identifier: "966500000001",
        recovery_case_id: "case-1",
        scope: "customer",
        source: "recovery",
      };
      const view = toView(row, 600);
      expect(Object.keys(view).sort()).toEqual(["code", "computedValue", "expiresAt", "type", "value"]);
      expect(JSON.stringify(view)).not.toContain("case-1");
      expect(JSON.stringify(view)).not.toContain("966500000001");
    });

    it("42) fixed: القيمة المطلقة لا تُعامل كنسبة", () => {
      // خطأ سابق: 50 ثابت على سلة 600 ⇒ 50 لا 60 (النسبة كانت تُطبَّق خطأً).
      const fixed: CouponIncentiveRow = {
        id: "f-1",
        code: "FIXEDCODE00001",
        type: "fixed",
        value: 50,
        max_discount: null,
        min_order: 0,
        starts_at: null,
        ends_at: null,
        usage_limit: 1,
        used_count: 0,
        is_active: true,
        customer_identifier: PHONE,
        recovery_case_id: "case-1",
        scope: "customer",
        source: "recovery",
      };
      expect(toView(fixed, 600).computedValue).toBe(50);
      expect(toView(fixed, 600).computedValue).toBe(discountForCoupon(fixed, 600));
      // ومع سقف: 100 ثابت وسقف 30 ⇒ 30، مطابقًا checkout.
      const capped = { ...fixed, value: 100, max_discount: 30 };
      expect(toView(capped, 600).computedValue).toBe(30);
      expect(toView(capped, 600).computedValue).toBe(discountForCoupon(capped, 600));
      // وسقف 0 ⇒ صفر في العرض كما في الطلب.
      expect(toView({ ...fixed, max_discount: 0 }, 600).computedValue).toBe(0);
    });

    it("43) العرض يطابق checkout لكل تركيبة سقف (الرقم المعلن = الرقم المطبَّق)", () => {
      for (const cap of [null, 0, 30, 50, 500]) {
        for (const percent of [10, 50]) {
          const row: CouponIncentiveRow = {
            id: "p-1",
            code: "PARITYCODE00001",
            type: "percent",
            value: percent,
            max_discount: cap,
            min_order: 0,
            starts_at: null,
            ends_at: null,
            usage_limit: 1,
            used_count: 0,
            is_active: true,
            customer_identifier: PHONE,
            recovery_case_id: "case-1",
            scope: "customer",
            source: "recovery",
          };
          for (const cart of [0, 50, 300, 1000]) {
            expect(toView(row, cart).computedValue).toBe(discountForCoupon(row, cart));
          }
        }
      }
    });
  });
});

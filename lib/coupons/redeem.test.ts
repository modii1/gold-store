/**
 * G6-C — اختبارات استبدال القسيمة (lib/coupons/redeem).
 *
 * تنفّذ على مخازن مزيفة، فلا Supabase ولا شبكة. الهدف إثبات ثلاث قواعد:
 *  1) الاستبدال لا يحدث إلا بعد الطلب (يُستدعى بعد الإدراج) ولا مرتين.
 *  2) الربط يُفحص من الخادم: قسيمة عميل آخر = رفض، والرسالة واحدة.
 *  3) المسار الذرّي يسبق الاحتياطي، والفشل يُعلن ولا يُخفى.
 */

import { describe, expect, it } from "vitest";
import { redeemCouponForOrder } from "./redeem";
import type { AtomicRedeemRow, CouponRedeemResult, CouponRedeemStore } from "./redeem";
import type { BoundCouponRecord } from "./policy";
import { discountForCoupon, evaluateCoupon, internalRejectReason } from "./policy";

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const PHONE = "966500000001";
const OTHER_PHONE = "966500000002";

function row(over: Partial<BoundCouponRecord> = {}): BoundCouponRecord {
  return {
    code: "RECOVERY000001",
    type: "percent",
    value: 10,
    min_order: 100,
    starts_at: null,
    ends_at: new Date(NOW + 48 * 3_600_000).toISOString(),
    usage_limit: 1,
    used_count: 0,
    is_active: true,
    customer_identifier: PHONE,
    recovery_case_id: "case-1",
    max_discount: 50,
    ...over,
  };
}

class FakeRedeemStore implements CouponRedeemStore {
  rows: BoundCouponRecord[] = [];
  atomic = true;
  calls: { code: string; subtotal: number; customerIdentifier: string; now: number }[] = [];
  casWrites: { id: string; from: number; to: number }[] = [];
  casResult: "written" | "raced" = "written";
  atomicFailure: { ok: false; reason: "missing" | "invalid" | "unavailable" | "wrong_customer" | "exhausted" } | null = null;

  async atomicAvailable() {
    return this.atomic;
  }

  async redeemAtomic(input: { code: string; subtotal: number; customerIdentifier: string; now: number }) {
    this.calls.push(input);
    if (this.atomicFailure) return this.atomicFailure;
    const found = this.rows.find((r) => r.code === input.code) ?? null;
    if (!found) return { ok: false as const, reason: "missing" as const };
    // محاكاة القفل الذرّي: الفحص ثم الزيادة في خطوة واحدة.
    const checked = evaluateCoupon(found, {
      now: input.now,
      subtotal: input.subtotal,
      customerIdentifier: input.customerIdentifier,
    });
    if (!checked.ok) {
      return { ok: false as const, reason: internalRejectReason(checked.reason) };
    }
    found.used_count = Number(found.used_count) + 1;
    return { ok: true as const, row: found as unknown as AtomicRedeemRow };
  }

  async readByCode(code: string) {
    return this.rows.find((r) => r.code === code) ?? null;
  }

  usage = {
    readByCode: async (code: string) => {
      const r = this.rows.find((x) => x.code === code);
      if (!r) return null;
      return {
        id: String(r.id ?? "c-1"),
        code: r.code,
        usage_limit: Number(r.usage_limit),
        used_count: Number(r.used_count),
      };
    },
    compareAndSet: async (id: string, observed: number, next: number) => {
      if (this.casResult === "raced") return false;
      const r = this.rows.find((x) => x.code === "RECOVERY000001");
      if (!r || Number(r.used_count) !== observed) return false;
      r.used_count = next;
      this.casWrites.push({ id, from: observed, to: next });
      return true;
    },
  };
}

function order(over: { code?: string | null; subtotal?: number; phone?: string | null } = {}) {
  return {
    code: over.code === undefined ? "RECOVERY000001" : (over.code as string),
    subtotal: over.subtotal ?? 600,
    customerIdentifier: over.phone === undefined ? PHONE : over.phone,
    now: NOW,
  };
}

describe("G6-C — استبدال القسيمة عند إنشاء الطلب", () => {
  it("1) مسار ذرّي: يزيد العدّاد مرة ويعيد الخصم بعد السقف", async () => {
    const store = new FakeRedeemStore();
    store.rows = [row({ id: "c-1" })];
    const res = (await redeemCouponForOrder(store, order())) as CouponRedeemResult;
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.mode).toBe("atomic");
    // 10% من 600 = 60 ⇒ يُقصّ إلى max_discount = 50.
    expect(res.discount).toBe(50);
    expect(store.calls).toHaveLength(1);
    expect(store.rows[0].used_count).toBe(1);
  });

  it("2) قسيمة عميل آخر ⇒ رفض wrong_customer بلا زيادة", async () => {
    const store = new FakeRedeemStore();
    store.rows = [row({ id: "c-1" })];
    const res = await redeemCouponForOrder(store, order({ phone: OTHER_PHONE }));
    expect(res).toEqual({ ok: false, reason: "wrong_customer", mode: "none" });
    expect(store.rows[0].used_count).toBe(0);
  });

  it("3) بلا معرّف عميل من الخادم ⇒ رفض (لا خصم غير مثبَّت)", async () => {
    const store = new FakeRedeemStore();
    store.rows = [row({ id: "c-1" })];
    const res = await redeemCouponForOrder(store, order({ phone: null }));
    expect(res).toEqual({ ok: false, reason: "wrong_customer", mode: "none" });
    expect(store.rows[0].used_count).toBe(0);
  });

  it("4) قسيمة عامة (بلا binding) تعمل لأي عميل — سلوك G6-A محفوظ", async () => {
    const store = new FakeRedeemStore();
    store.rows = [row({ id: "c-1", customer_identifier: null })];
    const res = (await redeemCouponForOrder(store, order({ phone: OTHER_PHONE }))) as CouponRedeemResult;
    expect(res.ok).toBe(true);
  });

  it("5) تحت الحد الأدنى ⇒ رفض بلا زيادة", async () => {
    const store = new FakeRedeemStore();
    store.rows = [row({ id: "c-1" })];
    const res = await redeemCouponForOrder(store, order({ subtotal: 50 }));
    expect(res).toEqual({ ok: false, reason: "unavailable", mode: "none" });
    expect(store.rows[0].used_count).toBe(0);
  });

  it("6) كود غير موجود ⇒ missing", async () => {
    const store = new FakeRedeemStore();
    const res = await redeemCouponForOrder(store, order());
    expect(res).toEqual({ ok: false, reason: "missing", mode: "none" });
  });

  it("7) فارغ ⇒ missing بلا أي استدعاء قاعدة", async () => {
    const store = new FakeRedeemStore();
    const res = await redeemCouponForOrder(store, order({ code: "" }));
    expect(res).toEqual({ ok: false, reason: "missing", mode: "none" });
    expect(store.calls).toHaveLength(0);
  });

  it("8) منتهية ⇒ رفض بلا زيادة", async () => {
    const store = new FakeRedeemStore();
    store.rows = [row({ id: "c-1", ends_at: new Date(NOW - 1).toISOString() })];
    const res = await redeemCouponForOrder(store, order());
    expect(res).toEqual({ ok: false, reason: "unavailable", mode: "none" });
    expect(store.rows[0].used_count).toBe(0);
  });

  it("9) غير فعّالة ⇒ رفض بلا زيادة", async () => {
    const store = new FakeRedeemStore();
    store.rows = [row({ id: "c-1", is_active: false })];
    const res = await redeemCouponForOrder(store, order());
    expect(res).toEqual({ ok: false, reason: "unavailable", mode: "none" });
    expect(store.rows[0].used_count).toBe(0);
  });

  it("10) مستهلكة (usage_limit = 1) ⇒ exhausted بلا زيادة ثانية", async () => {
    const store = new FakeRedeemStore();
    store.rows = [row({ id: "c-1", used_count: 1 })];
    const res = await redeemCouponForOrder(store, order());
    expect(res).toEqual({ ok: false, reason: "exhausted", mode: "none" });
    expect(store.rows[0].used_count).toBe(1);
  });

  it("11) أول استبدال ينجح والثاني يُرفض — usage_limit = 1 لا يُكسر", async () => {
    const store = new FakeRedeemStore();
    store.rows = [row({ id: "c-1" })];
    const first = await redeemCouponForOrder(store, order());
    const second = await redeemCouponForOrder(store, order());
    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, reason: "exhausted", mode: "none" });
    expect(store.rows[0].used_count).toBe(1);
  });

  it("12) بلا migration: المسار الاحتياطي CAS موسوم بوضوح", async () => {
    const store = new FakeRedeemStore();
    store.atomic = false;
    store.rows = [row({ id: "c-1" })];
    const res = (await redeemCouponForOrder(store, order())) as CouponRedeemResult;
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.mode).toBe("cas");
    expect(store.calls).toHaveLength(0);
    expect(store.casWrites).toEqual([{ id: "c-1", from: 0, to: 1 }]);
  });

  it("13) سباق CAS غير محسوم ⇒ لا خصم (لا وعد غير مثبَّت)", async () => {
    const store = new FakeRedeemStore();
    store.atomic = false;
    store.casResult = "raced";
    store.rows = [row({ id: "c-1" })];
    const res = await redeemCouponForOrder(store, order());
    expect(res).toEqual({ ok: false, reason: "invalid", mode: "none" });
  });

  it("14) الاحتياطي يفحص الربط أيضًا", async () => {
    const store = new FakeRedeemStore();
    store.atomic = false;
    store.rows = [row({ id: "c-1" })];
    const res = await redeemCouponForOrder(store, order({ phone: OTHER_PHONE }));
    expect(res).toEqual({ ok: false, reason: "wrong_customer", mode: "none" });
    expect(store.casWrites).toHaveLength(0);
  });

  it("15) السقف مطبَّق في القيمتين: atomic و CAS", async () => {
    const atomicStore = new FakeRedeemStore();
    atomicStore.rows = [row({ id: "c-1" })];
    const a = await redeemCouponForOrder(atomicStore, order({ subtotal: 1000 }));
    const casStore = new FakeRedeemStore();
    casStore.atomic = false;
    casStore.rows = [row({ id: "c-1" })];
    const b = await redeemCouponForOrder(casStore, order({ subtotal: 1000 }));
    expect(a.ok && a.discount).toBe(50);
    expect(b.ok && b.discount).toBe(50);
    // والقيمة الخام من policy.ts هي مصدر الحقيقة الوحيد للرقم.
    expect(discountForCoupon(row(), 1000)).toBe(50);
  });
});

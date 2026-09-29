import { describe, expect, it, vi } from "vitest";
import { incrementCouponUsage, type CouponUsageRecord, type CouponUsageStore } from "./usage";

/**
 * محاكاة لسلوك Postgres: كل successful write يزيد الصف فعليًا، و أي write
 * بـused_count لا يطابق القيمة المقروءة يتجاهَل تمامًا (0 صفوف) — وهو بالضبط
 * ما يفعله update الشرط عبر REST.
 */
function fakeStore(initial: CouponUsageRecord) {
  let row: CouponUsageRecord = { ...initial };
  const calls: Array<{ observed: number; next: number }> = [];

  const store: CouponUsageStore = {
    readByCode: vi.fn(async (code: string) => (row && row.code === code ? { ...row } : null)),
    compareAndSet: vi.fn(async (_id: string, observed: number, next: number) => {
      calls.push({ observed, next });
      if (Number(row.used_count) !== observed) return false;
      row = { ...row, used_count: next };
      return true;
    }),
  };

  return { store, calls, read: () => row };
}

describe("incrementCouponUsage —happy path", () => {
  it("يزيد العدّاد 1 على قيمة مقروءة", async () => {
    const { store, read } = fakeStore({ id: "c1", code: "GOLD10", usage_limit: null, used_count: 0 });
    expect(await incrementCouponUsage(store, "GOLD10")).toBe("incremented");
    expect(read().used_count).toBe(1);
  });

  it("يطبّع الكود قبل القراءة (gold10 = GOLD10)", async () => {
    const { store, read } = fakeStore({ id: "c1", code: "GOLD10", usage_limit: null, used_count: 0 });
    expect(await incrementCouponUsage(store, " gold10 ")).toBe("incremented");
    expect(read().used_count).toBe(1);
  });

  it("كود غير موجود ⇒ missing بلا أي كتابة", async () => {
    const { store } = fakeStore({ id: "c1", code: "GOLD10", usage_limit: null, used_count: 0 });
    expect(await incrementCouponUsage(store, "NOPE")).toBe("missing");
    expect(store.compareAndSet).not.toHaveBeenCalled();
  });

  it("كود فارغ ⇒ missing بلا قراءة", async () => {
    const { store } = fakeStore({ id: "c1", code: "GOLD10", usage_limit: null, used_count: 0 });
    expect(await incrementCouponUsage(store, "")).toBe("missing");
    expect(store.readByCode).not.toHaveBeenCalled();
  });
});

describe("incrementCouponUsage — حد الاستخدام", () => {
  it("usage_limit = null ⇒ غير محدود حتى مع عدّاد كبير", async () => {
    const { store, read } = fakeStore({ id: "c1", code: "GOLD10", usage_limit: null, used_count: 99 });
    expect(await incrementCouponUsage(store, "GOLD10")).toBe("incremented");
    expect(read().used_count).toBe(100);
  });

  it("بلغ الحد ⇒ exhausted بلا كتابة", async () => {
    const { store, read } = fakeStore({ id: "c1", code: "GOLD10", usage_limit: 1, used_count: 1 });
    expect(await incrementCouponUsage(store, "GOLD10")).toBe("exhausted");
    expect(store.compareAndSet).not.toHaveBeenCalled();
    expect(read().used_count).toBe(1);
  });

  it("تحت الحد ⇒ يزيد", async () => {
    const { store, read } = fakeStore({ id: "c1", code: "GOLD10", usage_limit: 2, used_count: 1 });
    expect(await incrementCouponUsage(store, "GOLD10")).toBe("incremented");
    expect(read().used_count).toBe(2);
  });
});

describe("incrementCouponUsage — التزامن (S7)", () => {
  it("سباق حقيقي: كتابة تفشل لأن الصف تغيّر ⇒ إعادة قراءة تنجح (لا lost update)", async () => {
    const { store, calls, read } = fakeStore({ id: "c1", code: "GOLD10", usage_limit: null, used_count: 0 });

    let stolen = true;
    const inner = store.compareAndSet;
    store.compareAndSet = vi.fn(async (id: string, observed: number, next: number) => {
      if (stolen) {
        // طلب آخر سباقنا وغيّر الصف قبل كتابتنا.
        stolen = false;
        await inner(id, observed, observed + 1);
        return false;
      }
      return inner(id, observed, next);
    });

    expect(await incrementCouponUsage(store, "GOLD10")).toBe("incremented");
    // هل ضاع استخدام؟ لا: العدّاد النهائي 2 لا 1.
    expect(read().used_count).toBe(2);
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it("سباق متكرر ينفد ⇒ raced (لا كتابة صامتة، والقرار يُسجَّل لا يفسد الطلب)", async () => {
    const { store } = fakeStore({ id: "c1", code: "GOLD10", usage_limit: null, used_count: 0 });
    store.compareAndSet = vi.fn(async () => false);
    expect(await incrementCouponUsage(store, "GOLD10", 3)).toBe("raced");
    expect(store.compareAndSet).toHaveBeenCalledTimes(3);
  });

  it("عشرة استعمادات متزامنة ⇒ لا lost update: كل نجاح يعدّاد حقيقي (0+1+...+9)", async () => {
    const { store, read } = fakeStore({ id: "c1", code: "GOLD10", usage_limit: null, used_count: 0 });
    const results = await Promise.all(
      Array.from({ length: 10 }, () => incrementCouponUsage(store, "GOLD10", 20))
    );
    expect(results.filter((r) => r === "incremented").length).toBe(10);
    expect(read().used_count).toBe(10);
  });

  it("عشرة استعمادات بمحاولات قليلة ⇒ العدّاد يطابق محاولات النجاح بالضبط (لا نقص في العدّاد)", async () => {
    // مع ازدحام شديد قد يفشل رقمٌ من محاولات إعادة القراءة. المهم: من نجحت
    // كتابته محسوب، ومن لم ينجح مُبلَّغ ("raced") لا يكتب صامتًا — والعدّاد
    // لا ينقص أبدًا (وهو الاتجاه الخطر ماليًا قبل G6-A).
    const { store, read } = fakeStore({ id: "c1", code: "GOLD10", usage_limit: null, used_count: 0 });
    const results = await Promise.all(
      Array.from({ length: 10 }, () => incrementCouponUsage(store, "GOLD10", 3))
    );
    const succeeded = results.filter((r) => r === "incremented").length;
    expect(succeeded).toBe(read().used_count as number);
    expect(succeeded + results.filter((r) => r === "raced").length).toBe(10);
    expect(read().used_count).toBeLessThanOrEqual(10);
  });

  it("حد الاستخدام مع التزامن: لا يتجاوز العدّاد الحد (يبقى <= limit)", async () => {
    const { store, read } = fakeStore({ id: "c1", code: "GOLD10", usage_limit: 3, used_count: 0 });
    const results = await Promise.all(
      Array.from({ length: 8 }, () => incrementCouponUsage(store, "GOLD10", 8))
    );
    expect(results.filter((r) => r === "incremented").length).toBe(3);
    expect(results.filter((r) => r === "exhausted").length).toBe(5);
    expect(read().used_count).toBe(3);
  });
});

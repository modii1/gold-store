import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteCouponAction, saveCouponAction } from "./coupons-admin";

const h = vi.hoisted(() => ({
  isAdmin: false as boolean,
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  eq: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getAdminSession: async () => h.isAdmin,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: h.insert,
      update: h.update,
      delete: h.delete,
    }),
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));

function fd(pairs: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(pairs)) f.set(k, v);
  return f;
}

function validForm() {
  return fd({ code: " gold10 ", type: "percent", value: "10", min_order: "0", usage_limit: "1", is_active: "on" });
}

beforeEach(() => {
  h.isAdmin = false;
  h.insert.mockReset();
  h.update.mockReset();
  h.delete.mockReset();
  h.eq.mockReset();
  h.revalidatePath.mockReset();
  h.insert.mockReturnValue(Promise.resolve({ error: null }));
  h.update.mockReturnValue({ eq: h.eq });
  h.eq.mockReturnValue(Promise.resolve({ error: null }));
  h.delete.mockReturnValue({ eq: h.eq });
});

describe("S1 — صلاحيات إدارة الكوبونات", () => {
  it("غير مصرّح له: حفظ مرفوض + لا كتابة في القاعدة إطلاقًا", async () => {
    h.isAdmin = false;
    const res = await saveCouponAction(validForm());
    expect(res).toEqual({ error: "غير مصرح" });
    expect(h.insert).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });

  it("غير مصرّح له: تعديل مرفوض + لا كتابة", async () => {
    h.isAdmin = false;
    const res = await saveCouponAction(fd({ id: "row-1", code: "GOLD10", value: "10" }));
    expect(res).toEqual({ error: "غير مصرح" });
    expect(h.update).not.toHaveBeenCalled();
  });

  it("غير مصرّح له: حذف مرفوض + لا كتابة", async () => {
    h.isAdmin = false;
    const res = await deleteCouponAction(fd({ id: "row-1" }));
    expect(res).toEqual({ error: "غير مصرح" });
    expect(h.delete).not.toHaveBeenCalled();
  });

  it("عميل مسجّل دخول (غير admin) = نفس الرفض: التحقق على الجلسة الإدارية فقط", async () => {
    // getAdminSession() تعتمد cookie إدارية.httpOnly فقط؛ لا يوجد session عميل
    // يماثلها، فأي زائر أو عميل يمر بالرفض نفسه.
    h.isAdmin = false;
    expect(await saveCouponAction(validForm())).toEqual({ error: "غير مصرح" });
    expect(await deleteCouponAction(fd({ id: "row-1" }))).toEqual({ error: "غير مصرح" });
  });

  it("admin: إنشاء مسموح", async () => {
    h.isAdmin = true;
    const res = await saveCouponAction(validForm());
    expect(res).toEqual({ success: true });
    expect(h.insert).toHaveBeenCalledTimes(1);
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin/coupons");
  });

  it("admin: تعديل مسموح", async () => {
    h.isAdmin = true;
    const res = await saveCouponAction(fd({ id: "row-1", code: "GOLD10", value: "10" }));
    expect(res).toEqual({ success: true });
    expect(h.update).toHaveBeenCalledTimes(1);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("admin: حذف مسموح", async () => {
    h.isAdmin = true;
    const res = await deleteCouponAction(fd({ id: "row-1" }));
    expect(res).toEqual({ success: true });
    expect(h.delete).toHaveBeenCalledTimes(1);
    expect(h.eq).toHaveBeenCalledWith("id", "row-1");
  });
});

describe("S10 — تطبيع الكود (uppercase)", () => {
  it("يُحفظ uppercase مع trim مهما كتب المدير", async () => {
    h.isAdmin = true;
    await saveCouponAction(fd({ code: "  gold10  ", value: "10" }));
    expect(h.insert.mock.calls[0][0]).toMatchObject({ code: "GOLD10" });
  });

  it("الشكل المخزَّن لم يتغيّر: canonical uppercase كما كان", async () => {
    h.isAdmin = true;
    await saveCouponAction(fd({ code: "GOLD10", value: "10" }));
    await saveCouponAction(fd({ code: "gOlD10", value: "10" }));
    expect(h.insert.mock.calls[0][0].code).toBe("GOLD10");
    expect(h.insert.mock.calls[1][0].code).toBe("GOLD10");
  });

  it("كود فارغ بعد التطبيع ⇒ رفض قبل أي كتابة", async () => {
    h.isAdmin = true;
    const res = await saveCouponAction(fd({ code: "   ", value: "10" }));
    expect(res).toEqual({ error: "كود الخصم مطلوب" });
    expect(h.insert).not.toHaveBeenCalled();
  });
});

describe("S9 — ends_at يعني نهاية اليوم", () => {
  it("تاريخ فقط ⇒ 23:59:59+03:00 في الصف المُحفظ", async () => {
    h.isAdmin = true;
    await saveCouponAction(fd({ code: "GOLD10", value: "10", ends_at: "2026-09-30" }));
    expect(h.insert.mock.calls[0][0]).toMatchObject({ ends_at: "2026-09-30T23:59:59+03:00" });
  });

  it("بدون تاريخ ⇒ null (بلا صلاحية)", async () => {
    h.isAdmin = true;
    await saveCouponAction(fd({ code: "GOLD10", value: "10" }));
    expect(h.insert.mock.calls[0][0]).toMatchObject({ ends_at: null });
  });

  it("طابع ISO كامل يمرّ كما هو (Recovery-style)", async () => {
    h.isAdmin = true;
    await saveCouponAction(fd({ code: "GOLD10", value: "10", ends_at: "2026-09-30T21:00:00.000Z" }));
    expect(h.insert.mock.calls[0][0]).toMatchObject({ ends_at: "2026-09-30T21:00:00.000Z" });
  });

  it("التعديل يحفظ نفس القاعدة (لا فرق بين إنشاء وتعديل)", async () => {
    h.isAdmin = true;
    await saveCouponAction(fd({ id: "row-1", code: "GOLD10", value: "10", ends_at: "2026-12-31" }));
    expect(h.update.mock.calls[0][0]).toMatchObject({ ends_at: "2026-12-31T23:59:59+03:00" });
  });
});

describe("بقاء سلوكات الإنشاء السابقة", () => {
  it("يؤكد التحقق الأساسي: كود + قيمة", async () => {
    h.isAdmin = true;
    expect(await saveCouponAction(fd({ value: "10" }))).toEqual({ error: "كود الخصم مطلوب" });
    expect(await saveCouponAction(fd({ code: "GOLD10", value: "0" }))).toEqual({ error: "قيمة الخصم مطلوبة" });
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("payload يحافظ على كل الحقول (سلوك سابق محفوظ)", async () => {
    h.isAdmin = true;
    await saveCouponAction(fd({ code: "GOLD10", type: "fixed", value: "50", min_order: "200", usage_limit: "3", is_active: "on" }));
    expect(h.insert.mock.calls[0][0]).toEqual({
      code: "GOLD10", type: "fixed", value: 50, min_order: 200,
      usage_limit: 3, starts_at: null, ends_at: null, is_active: true,
    });
  });

  it("is_active غير موجود ⇒ false (سلوك سابق محفوظ)", async () => {
    h.isAdmin = true;
    await saveCouponAction(fd({ code: "GOLD10", value: "10" }));
    expect(h.insert.mock.calls[0][0]).toMatchObject({ is_active: false });
  });

  it("حذف بلا id ⇒ رفض قبل أي كتابة", async () => {
    h.isAdmin = true;
    expect(await deleteCouponAction(new FormData())).toEqual({ error: "معرف مطلوب" });
    expect(h.delete).not.toHaveBeenCalled();
  });

  it("خطأ القاعدة يُعاد كما هو (سلوك سابق محفوظ)", async () => {
    h.isAdmin = true;
    h.insert.mockReturnValue(Promise.resolve({ error: { message: "duplicate key" } }));
    expect(await saveCouponAction(validForm())).toEqual({ error: "duplicate key" });
  });
});

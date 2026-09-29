import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildSettingsUpdateData, updateSettingsAction } from "./settings";

const h = vi.hoisted(() => ({
  lastData: undefined as Record<string, unknown> | undefined,
  eq: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      update: (data: unknown) => {
        h.lastData = data as Record<string, unknown>;
        return { eq: h.eq };
      },
    }),
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));

function fd(pairs: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(pairs)) f.set(k, v);
  return f;
}

beforeEach(() => {
  h.lastData = undefined;
  h.eq.mockReset();
  h.revalidatePath.mockReset();
  h.eq.mockReturnValue({ error: null });
});

describe("buildSettingsUpdateData — PATCH جزئي", () => {
  it("حقل numeric واحد فقط (shipping_fee) → لا يتغير إلا shipping_fee، ولا null/0/false لأي حقل آخر", async () => {
    const d = await buildSettingsUpdateData(fd({ shipping_fee: "250" }));
    expect(d).toEqual({ shipping_fee: 250 });
    expect(d.shipping_fee).toBe(250);
    expect(Object.keys(d)).toEqual(["shipping_fee"]);
  });

  it("حقل text واحد فقط (whatsapp) → لا يُتخمين أي حقل آخر", async () => {
    const d = await buildSettingsUpdateData(fd({ whatsapp: "0507606225" }));
    expect(d).toEqual({ whatsapp: "0507606225" });
  });

  it("الحقل الغائب لا يُكتب كـ null / 0 / false", async () => {
    const present = ["site_name", "announcement", "whatsapp", "hero_title", "primary_color", "footer_show_brand"];
    const d = await buildSettingsUpdateData(fd({ shipping_fee: "25" }));
    expect(Object.keys(d)).toEqual(["shipping_fee"]);
    for (const k of present) expect(d).not.toHaveProperty(k);
  });

  it("حقل text موجود بقيمة فارغة → null (سلوك المسح المقصود محفوظ)", async () => {
    expect(await buildSettingsUpdateData(fd({ announcement: "" }))).toEqual({ announcement: null });
  });

  it("حقل numeric موجود بقيمة فارغة → 0 (سلوك سابق محفوظ)", async () => {
    expect(await buildSettingsUpdateData(fd({ shipping_fee: "" }))).toEqual({ shipping_fee: 0 });
  });

  it("boolean: on → true، off → false، غائب → لا يُكتب", async () => {
    expect(await buildSettingsUpdateData(fd({ footer_show_brand: "on" }))).toEqual({ footer_show_brand: true });
    expect(await buildSettingsUpdateData(fd({ footer_show_brand: "off" }))).toEqual({ footer_show_brand: false });
    expect(await buildSettingsUpdateData(fd({}))).not.toHaveProperty("footer_show_brand");
  });

  it("boolean عبر radio بقيمة فارغة (إيقاف) → false", async () => {
    expect(await buildSettingsUpdateData(fd({ mobile_products_allow_user_toggle: "" }))).toEqual({
      mobile_products_allow_user_toggle: false,
    });
    expect(await buildSettingsUpdateData(fd({ mobile_products_allow_user_toggle: "on" }))).toEqual({
      mobile_products_allow_user_toggle: true,
    });
  });

  it("text يحتفظ بـ trim كالسابق", async () => {
    expect(await buildSettingsUpdateData(fd({ announcement: "  مرحباً  " }))).toEqual({ announcement: "مرحباً" });
  });

  it("حفظ كامل للنموذج (كل الحقول موجودة) يكتب كل شيء كما كان سابقًا", async () => {
    const all: Record<string, string> = {};
    for (const f of ["site_name", "announcement", "whatsapp", "hero_title", "shipping_fee", "footer_show_brand", "shipping_display_mode", "primary_color"]) {
      all[f] = "";
    }
    const d = await buildSettingsUpdateData(fd(all));
    for (const f of Object.keys(all)) expect(d).toHaveProperty(f);
  });
});

describe("updateSettingsAction — استدعاء فعلي", () => {
  it("مثل shipping-manager.tsx: حقل واحد shipping_display_mode → يغيّر الحقل فقط ولا يمسح البقية", async () => {
    const res = await updateSettingsAction(fd({ shipping_display_mode: "all" }));
    expect(res.success).toBe(true);
    expect(h.lastData).toMatchObject({ shipping_display_mode: "all" });
    expect(Object.keys(h.lastData!).sort()).toEqual(["shipping_display_mode", "updated_at"]);
    expect(h.lastData).not.toHaveProperty("site_name");
    expect(h.lastData).not.toHaveProperty("whatsapp");
    expect(h.lastData).not.toHaveProperty("shipping_fee");
    expect(h.eq).toHaveBeenCalledWith("id", 1);
  });

  it("حفظ shipping_fee فقط → يتغير shipping_fee فقط + updated_at", async () => {
    const res = await updateSettingsAction(fd({ shipping_fee: "200" }));
    expect(res.success).toBe(true);
    expect(h.lastData).toEqual(expect.objectContaining({ shipping_fee: 200 }));
    for (const k of ["site_name", "announcement", "whatsapp", "hero_title", "primary_color", "footer_show_brand", "free_shipping_threshold"]) {
      expect(h.lastData).not.toHaveProperty(k);
    }
    for (const v of Object.values(h.lastData!)) {
      expect([null, 0, false]).not.toContain(v);
    }
    expect(h.eq).toHaveBeenCalledWith("id", 1);
  });

  it("FormData فارغ → لا يكتب أي null/0/false لأي حقل (لا مسح)", async () => {
    const res = await updateSettingsAction(new FormData());
    expect(res.success).toBe(true);
    expect(Object.keys(h.lastData!)).toEqual(["updated_at"]);
  });
});
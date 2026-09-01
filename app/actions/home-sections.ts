"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import type { HomeSectionType } from "@/types";

// حفظ ترتيب الأقسام وحالة الإظهار دفعة واحدة (تُستدعى من لوحة التحكم عند حفظ الترتيب).
// entries: [{ id, sort_order, is_active }]
export async function saveSectionsOrderAction(entries: { id: string; sort_order: number; is_active: boolean }[]) {
  if (!Array.isArray(entries) || entries.length === 0) return { error: "لا توجد أقسام للحفظ" };
  const supabase = createAdminClient();
  for (const e of entries) {
    const { error } = await supabase
      .from("home_sections")
      .update({ sort_order: Math.max(0, e.sort_order), is_active: !!e.is_active, updated_at: new Date().toISOString() })
      .eq("id", e.id);
    if (error) return { error: error.message };
  }
  revalidatePath("/");
  return { success: true };
}

// إنشاء أو تعديل قسم. تُستخدم للأقسام المخصصة ولتعديل عناوين أقسام المنتجات المدمجة.
export async function upsertSectionAction(formData: FormData) {
  const id = (formData.get("id") as string)?.trim() || null;
  const type = (formData.get("type") as HomeSectionType) || "custom";
  const title = (formData.get("title") as string)?.trim() || null;
  const subtitle = (formData.get("subtitle") as string)?.trim() || null;
  const image_url = (formData.get("image_url") as string)?.trim() || null;
  const icon = (formData.get("icon") as string)?.trim() || null;
  const content = (formData.get("content") as string) || null;
  const dark = formData.get("dark") === "on";

  if (id && type === "custom") {
    // تعديل قسم مخصص
    const { error } = await supabaseUpdate({ title, subtitle, image_url, icon, content, config: { dark }, updated_at: new Date().toISOString() }, id);
    if (error) return { error: error.message };
  } else if (!id) {
    // إنشاء قسم مخصص جديد
    const code = `custom_${Date.now()}`;
    const { error } = await createAdminClient().from("home_sections").insert({
      type: "custom",
      code,
      title,
      subtitle,
      image_url,
      icon,
      content,
      config: { dark },
      is_active: true,
    });
    if (error) return { error: error.message };
  }

  revalidatePath("/");
  return { success: true };
}

// حذف قسم (يُسمح للأقسام المخصصة فقط حتى لا نفقد الأقسام المدمجة).
export async function deleteSectionAction(formData: FormData) {
  const id = (formData.get("id") as string)?.trim();
  if (!id) return { error: "معرف القسم مطلوب" };
  const supabase = createAdminClient();
  const { data: row } = await supabase.from("home_sections").select("type").eq("id", id).maybeSingle();
  if (!row) return { error: "القسم غير موجود" };
  if (row.type !== "custom") return { error: "لا يمكن حذف قسم مدمج — يمكنك إخفاؤه فقط" };
  const { error } = await supabase.from("home_sections").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/");
  return { success: true };
}

function supabaseUpdate(payload: Record<string, unknown>, id: string) {
  return createAdminClient().from("home_sections").update(payload).eq("id", id);
}

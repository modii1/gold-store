"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * تبديل ON/OFF لاستعادة المبيعات.
 *
 * - تعديل جزئي على عمود واحد فقط (recovery_enabled)، لا استبدال كامل
 *   لكائن الإعدادات، ولا لمس لأي عمود آخر.
 * - مصدر الحقيقة في القراءة: readRecoveryEnabled (lib/recovery/toggle.ts).
 * - لا يُخزَّن أو يُعرض أي سر؛ CRON_SECRET يبقى Secret على مستوى النشر.
 * - غير المصرّح لهم يتجاهَلون الطلب بصمت ولا يُجرَون أي كتابة.
 */
export async function setRecoveryEnabled(formData: FormData): Promise<void> {
  if (!(await getAdminSession())) return;

  const raw = formData.get("recovery_enabled");
  const enabled = raw === "on" || raw === "true" || raw === "1";

  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("settings")
      .update({ recovery_enabled: enabled })
      .eq("id", 1);
    if (error) return;

    revalidatePath("/admin/recovery");
    revalidatePath("/admin/recovery/settings");
  } catch {
    /* لا نكسر الصفحة عند فشل الحفظ */
  }
}

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * مصدر الحقيقة لتفعيل «استعادة المبيعات»: settings.recovery_enabled.
 *
 * - قيمة واحدة من قاعدة البيانات، مدعومة بـdefault=false في الـmigration.
 * - OFF عند غياب العمود أو تعذّر القراءة (fail-closed).
 * - لا علاقة لها بمتغيّرات النشر (RECOVERY_ENABLED/RECOVERY_DRY_RUN).
 * - دالة قراءة فقط: لا تكتب ولا تعدّل أي إعداد.
 */
export async function readRecoveryEnabled(): Promise<boolean> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("settings")
      .select("recovery_enabled")
      .eq("id", 1)
      .maybeSingle();
    if (error) return false;
    return data?.recovery_enabled === true;
  } catch {
    return false;
  }
}

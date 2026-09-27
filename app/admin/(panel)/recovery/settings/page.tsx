import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth";
import { loadRecoveryConfig } from "@/lib/recovery/config";
import { RecoverySettingsContent } from "@/components/admin/recovery/recovery-settings-content";

export const metadata = { title: "إعدادات استعادة المبيعات | لمعة" };
export const dynamic = "force-dynamic";

export default async function AdminRecoverySettingsPage() {
  const isAdmin = await getAdminSession();
  if (!isAdmin) redirect("/admin");

  // قراءة الحالة من إعدادات النشر فقط — لا كتابة ولا تعديل لأي إعداد.
  const cfg = loadRecoveryConfig();

  return <RecoverySettingsContent enabled={cfg.enabled} dryRun={cfg.dryRun} />;
}

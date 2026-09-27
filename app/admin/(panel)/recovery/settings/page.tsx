import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth";
import { readRecoveryEnabled } from "@/lib/recovery/toggle";
import { RecoverySettingsContent } from "@/components/admin/recovery/recovery-settings-content";

export const metadata = { title: "إعدادات استعادة المبيعات | لمعة" };
export const dynamic = "force-dynamic";

export default async function AdminRecoverySettingsPage() {
  const isAdmin = await getAdminSession();
  if (!isAdmin) redirect("/admin");

  // مصدر الحقيقة: settings.recovery_enabled (افتراضيًا OFF).
  const enabled = await readRecoveryEnabled();

  return <RecoverySettingsContent enabled={enabled} />;
}

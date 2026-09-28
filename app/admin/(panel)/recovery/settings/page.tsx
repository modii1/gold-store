import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth";
import { loadEffectiveRecoveryConfig, listRecoveryTemplates } from "@/lib/recovery/settings-store";
import { RecoverySettingsContent } from "@/components/admin/recovery/recovery-settings-content";

export const metadata = { title: "إعدادات استعادة المبيعات | لمعة" };
export const dynamic = "force-dynamic";

export default async function AdminRecoverySettingsPage() {
  const isAdmin = await getAdminSession();
  if (!isAdmin) redirect("/admin");

  // مصدر الحقيقة: مفتاح التشغيل + التجاوزات + المراحل (loadEffectiveRecoveryConfig).
  const effective = await loadEffectiveRecoveryConfig();
  const templates = await listRecoveryTemplates();

  const storageReady = !effective.errors.settings && !effective.errors.stages && !templates.error;

  return (
    <RecoverySettingsContent
      enabled={effective.enabled}
      dryRun={effective.cfg.dryRun}
      storageReady={storageReady}
      settingsSource={effective.settingsSource}
      stagesSource={effective.stagesSource}
      readErrors={effective.errors}
      currentConfig={effective.cfg}
      templatesCount={templates.templates.length}
      templatesError={templates.error}
    />
  );
}
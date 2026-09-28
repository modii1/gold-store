import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth";
import {
  loadEffectiveRecoveryConfig,
  readRecoveryStagesAll,
  readRecoveryTemplatesAll,
} from "@/lib/recovery/settings-store";
import { RecoveryStagesContent } from "@/components/admin/recovery/recovery-stages-content";

export const metadata = { title: "مراحل استعادة المبيعات | لمعة" };
export const dynamic = "force-dynamic";

export default async function AdminRecoveryStagesPage() {
  const isAdmin = await getAdminSession();
  if (!isAdmin) redirect("/admin");

  const [effective, stagesAll, templates] = await Promise.all([
    loadEffectiveRecoveryConfig(),
    readRecoveryStagesAll(),
    readRecoveryTemplatesAll(),
  ]);

  const storageReady = !effective.errors.settings && !effective.errors.stages && !templates.error && !stagesAll.error;

  return (
    <RecoveryStagesContent
      rows={stagesAll.rows}
      stagesSource={stagesAll.source}
      readError={stagesAll.error}
      storageReady={storageReady}
      maxMessages={effective.cfg.maxMessages}
      templates={templates.templates}
      templatesError={templates.error}
    />
  );
}
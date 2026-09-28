import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth";
import { listStageTemplateBindings, readRecoveryTemplatesAll } from "@/lib/recovery/settings-store";
import { RecoveryTemplatesContent } from "@/components/admin/recovery/recovery-templates-content";

export const metadata = { title: "قوالب استعادة المبيعات | لمعة" };
export const dynamic = "force-dynamic";

export default async function AdminRecoveryTemplatesPage() {
  const isAdmin = await getAdminSession();
  if (!isAdmin) redirect("/admin");

  const [templates, bindings] = await Promise.all([readRecoveryTemplatesAll(), listStageTemplateBindings()]);
  const storageReady = !templates.error && !bindings.error;

  return (
    <RecoveryTemplatesContent
      templates={templates.templates}
      templatesError={templates.error}
      bindings={bindings.bindings}
      storageReady={storageReady}
    />
  );
}
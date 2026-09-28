import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth";
import { loadEffectiveRecoveryConfig, readRecoveryTemplatesAll } from "@/lib/recovery/settings-store";
import { SupabaseRecoveryStore } from "@/lib/recovery/store";
import { SupabaseRecoveryContactGateway } from "@/lib/recovery/dispatcher";
import { RecoveryDispatchSimulation } from "@/components/admin/recovery/recovery-dispatch-simulation";
import { sampleRecoveryCase, simulateDispatch } from "@/lib/recovery/dispatch-simulation";
import type { DispatchTemplate } from "@/lib/recovery/dispatch-message";

export const metadata = { title: "محاكاة الإرسال | لمعة" };
export const dynamic = "force-dynamic";

export default async function AdminRecoverySimulatorPage() {
  const isAdmin = await getAdminSession();
  if (!isAdmin) redirect("/admin");

  const now = new Date().getTime();
  const [effective, templatesResult] = await Promise.all([
    loadEffectiveRecoveryConfig(),
    readRecoveryTemplatesAll(),
  ]);

  // قراءة صريحة للحقول — الزيادات (valid/hint) بنية توافقية لا يُمرَّر بناؤها.
  const templates: DispatchTemplate[] = templatesResult.templates.map((t) => ({
    id: t.id,
    key: t.key,
    nameAr: t.nameAr,
    title: t.title,
    body: t.body,
    isActive: t.isActive,
    version: t.version,
  }));

  const store = new SupabaseRecoveryStore();
  const storageReady = await store.ensureReady();
  const cases = storageReady ? (await store.listActive()).slice(0, 30) : [];
  const error = storageReady ? templatesResult.error : "تعذّر قراءة التخزين — تُعرض المراحل الافتراضية فقط.";

  // قيد التسليم (in-flight): أي delivery غير مؤكَّد — قراءة حقيقية للمسار.
  const inFlight = new Set<string>();
  if (storageReady && cases.length > 0) {
    const gateway = new SupabaseRecoveryContactGateway();
    const rows = await gateway.listRecoveryDeliveries(cases.map((c) => c.id));
    for (const row of rows) {
      if (row.status !== "sent") inFlight.add(row.caseId);
    }
  }

  const items = cases.map((c) => simulateDispatch(c, effective.cfg, templates, inFlight, now));
  const demo =
    items.length === 0 ? simulateDispatch(sampleRecoveryCase(now), effective.cfg, templates, new Set(), now) : null;

  return (
    <RecoveryDispatchSimulation
      storageReady={storageReady}
      enabled={effective.enabled}
      dryRun={effective.cfg.dryRun}
      items={items}
      demo={demo}
      error={error}
    />
  );
}
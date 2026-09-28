import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadEffectiveRecoveryConfig } from "@/lib/recovery/settings-store";
import { maskPhone, SupabaseRecoveryStore } from "@/lib/recovery/store";
import { RecoveryEngine } from "@/lib/recovery/engine";
import { computeMetrics, isVerifiedRecovery } from "@/lib/recovery/metrics";
import type { RecoveryOrderSummary } from "@/lib/recovery/metrics";
import type { ContactDecision, ContactOutcome, RecoveryCase } from "@/lib/recovery/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/recovery/dashboard — قراءة فقط. لا يكتب شيئًا.
 * يعرض: المرشحون، غير المكتمل، المؤهلون للخصم، المسترجعون، المعدل،
 * الإيراد المسترجع، تكلفة الخصومات، الصافي، والمانعون بسبب cooldown.
 *
 * مصدر الإعدادات نفس مصدر دورة التشغيل (loadEffectiveRecoveryConfig)،
 * فحقل dryRun هنا هو نفسه الذي يحكم الإرسال — لا عرض لواقع آخر.
 */
export async function GET() {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // مصدر الحقيقة للتشغيل: settings.recovery_enabled (لا متغيّرات النشر).
  const { cfg, settingsSource, stagesSource, errors } = await loadEffectiveRecoveryConfig();
  const store = new SupabaseRecoveryStore();
  const ready = await store.ensureReady();

  if (!ready) {
    return NextResponse.json({
      dryRun: cfg.dryRun,
      disabled: !cfg.enabled,
      storageReady: false,
      enabled: cfg.enabled,
      settingsSource,
      stagesSource,
      stagesCount: cfg.stages.length,
      readErrors: errors,
      metrics: null,
      cases: [],
      outcomes: [],
      message: `نظام الاسترجاع في وضع الجاهزية: لا يوجد تخزين فعّال بعد. لن يتم تخزين أي حالة ولا إرسال أي رسالة. (${store.error ?? "الجدول recovery_cases غير موجود — يُحفظ حتى الموافقة على migration-034"})`,
    });
  }


  try {
    const engine = new RecoveryEngine(store, cfg);
    const all = await store.listAll(200);

    // قرارات العرض (DRY_RUN) لكل حالة نشطة.
    const active = all.filter((c) => !["PURCHASED", "EXPIRED", "CANCELLED", "SUPPRESSED"].includes(c.status));
    const outcomes: ContactOutcome[] = [];
    for (const c of active) {
      outcomes.push(await engine.evaluate(c, {}));
    }

    // Recovery-linked orders revenue (read-only).
    const refs = [...new Set(all.filter((c) => c.purchaseRef).map((c) => c.purchaseRef as string))];
    const ordersByRef = new Map<string, RecoveryOrderSummary>();
    const orderCreatedAtByRef = new Map<string, number>();
    if (refs.length) {
      const supabase = createAdminClient();
      const { data: orders } = await supabase.from("orders").select("id, total, discount, created_at").in("id", refs);
      for (const o of (orders || []) as { id: string; total: number; discount: number; created_at?: string | null }[]) {
        ordersByRef.set(o.id, { total: Number(o.total || 0), discount: Number(o.discount || 0) });
        if (o.created_at) {
          const t = new Date(o.created_at).getTime();
          if (Number.isFinite(t)) orderCreatedAtByRef.set(o.id, t);
        }
      }
    }

    // سجل التدخلات الدائم — المصدر الوحيد الذي يثبّت «تمت الاستعادة».
    // فارغ حتى يوجد مُرسِل فعلي ⇒ recovered = 0 (وهو الصحيح اليوم).
    const interventionsByCase = await store.listInterventions(all.map((c) => c.id));

    const metrics = computeMetrics(all, ordersByRef, interventionsByCase, orderCreatedAtByRef);
    const decisionById = new Map<string, ContactDecision>(outcomes.map((o) => [o.caseId, o.decision]));

    return NextResponse.json({
      dryRun: cfg.dryRun,
      disabled: !cfg.enabled,
      storageReady: true,
      enabled: cfg.enabled,
      settingsSource,
      stagesSource,
      stagesCount: cfg.stages.length,
      readErrors: errors,
      metrics,

      cases: all.slice(0, 100).map((c: RecoveryCase) => ({
        id: c.id,
        // الخصوصية: لا نعرض رقم الجوال كاملًا في اللوحة (يظل masker فقط).
        customer: maskPhone(c.customerPhone),
        status: c.status,
        product: c.preferredProductSlug || null,
        cartValue: c.cartValue,
        priority: c.score,
        lastActivityAt: c.lastActivityAt,
        decision: decisionById.get(c.id) || c.decision,
        decisionNote: outcomes.find((o) => o.caseId === c.id)?.recommendedAction || null,
        discountProposal: outcomes.find((o) => o.caseId === c.id)?.recommendedDiscount || null,
        wouldSend: outcomes.find((o) => o.caseId === c.id)?.wouldSend || false,
        messageCount: c.messageCount,
        suppressReason: c.suppressReason,
        // تمييز صريح للصف: شراء طبيعي مقابل استعادة مُثبتة بتدخّل سابق.
        isVerifiedRecovery: isVerifiedRecovery({
          status: c.status,
          purchaseRef: c.purchaseRef,
          orderCreatedAt: c.purchaseRef ? orderCreatedAtByRef.get(c.purchaseRef) ?? null : null,
          interventions: interventionsByCase.get(c.id) ?? [],
          caseCreatedAt: c.firstDetectedAt,
        }),
      })),
      outcomes,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadRecoveryConfig } from "@/lib/recovery/config";
import { maskPhone, SupabaseRecoveryStore } from "@/lib/recovery/store";
import { RecoveryEngine } from "@/lib/recovery/engine";
import { computeMetrics } from "@/lib/recovery/metrics";
import type { RecoveryOrderSummary } from "@/lib/recovery/metrics";
import type { ContactDecision, ContactOutcome, RecoveryCase } from "@/lib/recovery/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/recovery/dashboard — قراءة فقط. لا يكتب شيئًا.
 * يعرض: المرشحون، غير المكتمل، المؤهلون للخصم، المسترجعون، المعدل،
 * الإيراد المسترجع، تكلفة الخصومات، الصافي، والمانعون بسبب cooldown.
 */
export async function GET() {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const cfg = loadRecoveryConfig();
  const store = new SupabaseRecoveryStore();
  const ready = await store.ensureReady();

  if (!ready) {
    return NextResponse.json({
      dryRun: true,
      storageReady: false,
      enabled: cfg.enabled,
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
    if (refs.length) {
      const supabase = createAdminClient();
      const { data: orders } = await supabase.from("orders").select("id, total, discount").in("id", refs);
      for (const o of (orders || []) as { id: string; total: number; discount: number }[]) {
        ordersByRef.set(o.id, { total: Number(o.total || 0), discount: Number(o.discount || 0) });
      }
    }

    const metrics = computeMetrics(all, ordersByRef);
    const decisionById = new Map<string, ContactDecision>(outcomes.map((o) => [o.caseId, o.decision]));

    return NextResponse.json({
      dryRun: cfg.dryRun,
      storageReady: true,
      enabled: cfg.enabled,
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
      })),
      outcomes,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadRecoveryConfig } from "@/lib/recovery/config";
import { maskPhone, resolveOrderRef, SupabaseRecoveryStore } from "@/lib/recovery/store";
import { isCronAuthorized } from "@/lib/recovery/cron-auth";
import { RecoveryEngine } from "@/lib/recovery/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/recovery/run — دورة الاسترجاع (نفس نمط /api/cron/notifications).
 * المرحلة الأولى DRY_RUN إلزاميًا: يقرأ ويقرر فقط، ولا يرسل ولا ينشئ خصومات.
 */
export async function POST(req: NextRequest) {
  // fail-closed: لا مسار مفتوح إطلاقًا — سر غير معرَّف = رفض، لا تمرير.
  if (!isCronAuthorized(req.headers.get("x-cron-secret"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const cfg = loadRecoveryConfig();

  // 1) إتمام الحالات عند شراء حقيقي: نقرأ notification_events من نوع
  //    order.created (المصدر الموثوق الوحيد — لا نلمس جدول orders ولا نعدّله).
  let closedByPurchase = 0;
  let skippedInvalidOrderRef = 0;
  let skippedMissingOrderRef = 0;
  const store = new SupabaseRecoveryStore();
  const ready = await store.ensureReady();

  if (ready && cfg.enabled) {
    try {
      const supabase = createAdminClient();
      const { data: events } = await supabase
        .from("notification_events")
        .select("order_id, customer_identifier, created_at")
        .eq("event_type", "order.created")
        .order("created_at", { ascending: false })
        .limit(200);

      const engine = new RecoveryEngine(store, cfg);
      const seen = new Set<string>();
      for (const e of (events || []) as { order_id?: string | null; customer_identifier: string | null }[]) {
        // order_id فاسد/غائب = لا نُغلق أي حالة (fail-safe). السبب: purchase مُثبت
        // في orders بجدولنا، فمعرّف طلب فارغ ليس دليل إتمام شرائية.
        if (!e.customer_identifier) continue;
        const ref = resolveOrderRef(e.order_id);
        if (!ref.ok) {
          // نُحصّي ونُسجّل السبب فقط — لا PII ولا قيمة الطلب ولا سر.
          if (ref.problem === "missing" || ref.problem === "empty" || ref.problem === "whitespace") {
            skippedMissingOrderRef++;
            console.warn(
              `[recovery] order.created بمعرّف طلب غير موجود (${ref.problem}) — تُركت الحالة دون تغيير وبلا purchase_ref`
            );
          } else {
            skippedInvalidOrderRef++;
            console.warn(
              `[recovery] order.created بمعرّف طلب غير UUID صالح (customer ${maskPhone(e.customer_identifier) ?? "unknown"}) — تم إغلاق الحالة بدون purchase_ref`
            );
          }
          continue;
        }
        if (seen.has(ref.normalized)) continue;
        seen.add(ref.normalized);
        closedByPurchase += await engine.completePurchaseByCustomer(e.customer_identifier, ref.normalized);
      }
    } catch {
      /* نتجاهل: لا نكسر أي شيء */
    }
  }

  // 2) دورة القرار: مخرجات فقط.
  const engine = new RecoveryEngine(store, cfg);
  const { outcomes } = ready && cfg.enabled ? await engine.runDryRunCycle() : { outcomes: [] };

  return NextResponse.json({
    ok: true,
    dryRun: true,
    storageReady: ready,
    enabled: cfg.enabled,
    closedByPurchase,
    skippedInvalidOrderRef,
    skippedMissingOrderRef,
    plannedMessages: outcomes.filter((o) => o.wouldSend).length,
    outcomes: outcomes.slice(0, 50),
  });
}

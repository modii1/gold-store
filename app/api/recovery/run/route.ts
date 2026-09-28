import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readRecoveryEnabled } from "@/lib/recovery/toggle";
import { loadRecoveryConfig } from "@/lib/recovery/config";
import type { RecoveryConfig } from "@/lib/recovery/config";
import { maskPhone, resolveOrderRef, SupabaseRecoveryStore } from "@/lib/recovery/store";
import { isCronAuthorized } from "@/lib/recovery/cron-auth";
import { RecoveryEngine } from "@/lib/recovery/engine";
import { RecoveryDispatcher, SupabaseRecoveryContactGateway } from "@/lib/recovery/dispatcher";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/recovery/run — دورة الاسترجاع (نفس نمط /api/cron/notifications).
 * التشغيل محكوم بـsettings.recovery_enabled من لوحة الإدارة:
 *  - OFF (الافتراضي): يتوقف فورًا بلا استيعاب ولا تقييم ولا معالجة.
 *  - ON: يستوعب الإشارات، يقيّم ويرتّب، ويغلق الحالة عند شراء موثّق.
 *
 * التواصل (عند ON فقط) يمر عبر مسار WhatsApp القائم في gold-store:
 *   notifications → صف تسليم واتساب → qr-server → 'sent'.
 * لا Provider جديد ولا API جديدة، ولا إنشاء أكواد خصم. التسوية
 * (recordIntervention + messageCount + lastMessageAt) لا تحدث إلا بعد قراءة
 * delivery حالتها 'sent' وsent_at موجود من qr-server.
 */
export async function POST(req: NextRequest) {
  // fail-closed: لا مسار مفتوح إطلاقًا — سر غير معرَّف = رفض، لا تمرير.
  if (!isCronAuthorized(req.headers.get("x-cron-secret"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // مصدر الحقيقة بعد التحقق من السر: settings.recovery_enabled (افتراضيًا OFF).
  // OFF ⇒ لا استيعاب ولا تقييم ولا معالجة ولا أي كتابة.
  const enabled = await readRecoveryEnabled();
  const base = loadRecoveryConfig();
  // dryRun ليس قفل تشغيل: عند ON نعمل بالوظائف الموجودة فعليًا في المحرّك.
  const cfg: RecoveryConfig = { ...base, enabled, dryRun: enabled ? false : base.dryRun };

  // OFF: توقف كامل — لا نفتح التخزين ولا نقرأ الإشارات ولا نكتب شيئًا.
  if (!cfg.enabled) {
    return NextResponse.json({
      ok: true,
      disabled: true,
      storageReady: null,
      enabled: false,
      closedByPurchase: 0,
      skippedInvalidOrderRef: 0,
      skippedMissingOrderRef: 0,
      plannedMessages: 0,
      dispatched: null,
      settled: null,
      outcomes: [],
    });
  }

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
      for (const e of (events || []) as {
        order_id?: string | null;
        customer_identifier: string | null;
        created_at?: string | null;
      }[]) {
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
        // orderCreatedAt شرط الإسناد: لا يُغلق طلبٌ حالةَ لم تكن موجودة قبله،
        // ولا يُنسب الشراء لحالة بلا تدخّل موثّق سابق (القياس يقرّر ذلك).
        const orderCreatedAt = e.created_at ? new Date(e.created_at).getTime() : null;
        closedByPurchase += await engine.completePurchaseByCustomer(e.customer_identifier, ref.normalized, {
          orderCreatedAt,
        });
      }
    } catch {
      /* نتجاهل: لا نكسر أي شيء */
    }
  }

  // 2) التسوية أولًا — قبل أي حساب قرارات في هذه الدورة.
  //
  //    الترتيب مقصود: التسوية تكتب messageCount/lastMessageAt لكل delivery
  //    أكّدها qr-server بحالة 'sent'. لو حُسبت القرارات قبلها لكان engine قد
  //    قرأ عدّادًا قديماً فيرسل رسالة ثانية فورًا بعد تأكيد الأولى.
  //    التسوية لا تقيّد نفسها بالحالات النشطة: رسالة مؤكَّدة بعد إغلاق
  //    الحالة بالشراء تبقى إرسالًا حقيقيًا يجب تسجيله.
  const dispatcher = ready && cfg.enabled
    ? new RecoveryDispatcher(store, new SupabaseRecoveryContactGateway(), cfg)
    : null;
  const settled = dispatcher ? await dispatcher.settle() : null;

  // 3) دورة القرار: تُقرأ الآن بعد تسوية كل الإرسالات المؤكَّدة، فالقرارات
  //    تعتمد على عدّاد وحدّاث cooldown صحيحين. التقييم نفسه بلا أي تغيير.
  const engine = new RecoveryEngine(store, cfg);
  const activeCases = ready && cfg.enabled ? await store.listActive() : [];
  const { outcomes } = ready && cfg.enabled ? await engine.runDryRunCycle() : { outcomes: [] };

  // 4) الجدولة: تنشئ notification + delivery واتساب لكل wouldSend.
  //    هي الخطوة الوحيدة التي تُدرج، وهي لا تسجّل شيئًا كإرسال.
  const dispatched = dispatcher ? await dispatcher.dispatch(activeCases, outcomes) : null;

  return NextResponse.json({
    ok: true,
    disabled: false,
    storageReady: ready,
    enabled: cfg.enabled,
    closedByPurchase,
    skippedInvalidOrderRef,
    skippedMissingOrderRef,
    plannedMessages: outcomes.filter((o) => o.wouldSend).length,
    dispatched,
    settled,
    outcomes: outcomes.slice(0, 50),
  });
}

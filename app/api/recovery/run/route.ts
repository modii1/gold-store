import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadEffectiveRecoveryConfig } from "@/lib/recovery/settings-store";
import { maskPhone, resolveOrderRef, SupabaseRecoveryStore } from "@/lib/recovery/store";
import { isCronAuthorized } from "@/lib/recovery/cron-auth";
import { RecoveryEngine } from "@/lib/recovery/engine";
import { RecoveryDispatcher, SupabaseRecoveryContactGateway } from "@/lib/recovery/dispatcher";
import { collectRecoveryEvidence, defaultEvidenceWindowHours } from "@/lib/recovery/evidence";
import { runRecoveryPipeline } from "@/lib/recovery/pipeline";
import { createIncentive } from "@/lib/recovery/incentive";
import { supabaseIncentiveStore } from "@/lib/recovery/incentive-store";


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
 * لا Provider جديد ولا API جديدة. التسوية
 * (recordIntervention + messageCount + lastMessageAt) لا تحدث إلا بعد قراءة
 * delivery حالتها 'sent' وsent_at موجود من qr-server.
 *
 * G6-C: الاسترجاع ينشئ الآن قسائم حقيقية عبر بوابة واحدة (lib/recovery/
 * incentive.ts) — واحدة لكل حالة، مربوطة بجوالها، بسقف مبلغ، ولمرة واحدة.
 * الإنشاء لا يحصل إلا عند `RECOMMEND_INCENTIVE`، والاستبدال لا يحصل هنا
 * إطلاقًا (checkout وحده يستبدل، بعد إنشاء طلب حقيقي).
 *
 * G4 — دورة القرار صارت السلسلة الجديدة كاملة بدل ContactOutcome القديم:
 *   analytics_events (قراءة) → Evidence → Intent → Confidence → Decision
 *   → Marketing → Execution Guard → ContactOutcome (adapter) → dispatcher.
 * sourceOfTruth للإرسال هو Execution Guard وحده: هل أرسل؟ = guard.allowed.
 * المحرك القديم (evaluateContact) لم يُحذف — ما زال يخدم لوحة الاسترجاع —
 * لكنه لم يعد يُستشار في هذه الدورة، فلا يوجد مصدران متنافسان للقرار.
 */
export async function POST(req: NextRequest) {
  // fail-closed: لا مسار مفتوح إطلاقًا — سر غير معرَّف = رفض، لا تمرير.
  if (!isCronAuthorized(req.headers.get("x-cron-secret"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // مصدر الحقيقة بعد التحقق من السر: settings.recovery_enabled (افتراضيًا OFF).
  // OFF ⇒ لا استيعاب ولا تقييم ولا معالجة ولا أي كتابة.
  //
  // loadEffectiveRecoveryConfig يجمع: مفتاح التشغيل + تجاوزات
  // recovery_settings + مراحل recovery_stages، فوق خط أساس البيئة.
  // وحقل dryRun يُحسم بقاعدة واحدة (resolveRecoveryDryRun) كانت مختلفة
  // بين هذا المسار ولوحة الإدارة، فكانت اللوحة تعرض «DRY_RUN» والواقع
  // غير ذلك. الآن المساران يقرآن نفس القيمة المحسومة.
  const { cfg, settingsSource, stagesSource } = await loadEffectiveRecoveryConfig();

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
  //    أكّدها qr-server بحالة 'sent'. لو حُسبت القرارات قبلها لقرأت السلسلة
  //    عدّادًا قديمًا فيُرسَل ثاني فور تأكيد الأولى، ويتجاوز cooldown.
  //    التسوية لا تقيّد نفسها بالحالات النشطة: رسالة مؤكَّدة بعد إغلاق
  //    الحالة بالشراء تبقى إرسالًا حقيقيًا يجب تسجيله.
  //
  //    لحظة واحدة تُمرَّر للـdispatcher وللخطوات أدناه، فيُعاد بناء نص الرسالة
  //    بنفس المدخلات التي فحصها Execution Guard ⇒ ما يُفحص هو ما يُدرَج.
  const cycleNow = Date.now();
  const gateway = ready && cfg.enabled ? new SupabaseRecoveryContactGateway() : null;
  const dispatcher = ready && cfg.enabled && gateway
    ? new RecoveryDispatcher(store, gateway, cfg, () => cycleNow)
    : null;
  const settled = dispatcher ? await dispatcher.settle() : null;

  // G6-C: عدّاد أسباب عدم إنشاء/استخدام القسيمة (بلا PII وبلا كود).
  const skippedIncentives: Record<string, number> = {};
  // G6-D: سبب فشل الإنشاء الأخير — يُمرَّر للتسويق ليميّز «فشل الإنشاء» عن
  // «لا قسيمة متاحة». بلا كود ولا جوال ولا معرّف.
  let couponFailure: string | null = null;
  const incentiveStore = supabaseIncentiveStore();

  // 3) دورة القرار: السلسلة الجديدة كاملة (Evidence → … → Execution Guard).
  //    تُقرأ بعد التسوية، فالقرارات تعتمد على عدّاد وحدّاث cooldown صحيحين.
  //    القراءة والأنواع فقط — ولا إدراج ولا delivery ولا كتابة حالة.
  //
  //    G6-C: وحد الاسترجاع يمرّ ببوابة القسيمة. هي التي تقرر (أ) هل هذه
  //    الحالة مرشّحة فعلًا بكوبون، و(ب) تنشئ قسيمة واحدة مربوطة بالحالة إن
  //    لم تكن موجودة. لا تُنشأ قسيمة عند تصفّح أو سلة أو دفع وحده، ولا
  //    تُستهلك أي قسيمة هنا: الاستبدال يحدث في checkout بعد طلب حقيقي.
  const pipeline = ready && cfg.enabled && gateway
    ? await runRecoveryPipeline({
        cfg,
        store,
        gateway,
        // analytics_events قراءة فقط (service role) — نفس آلية G1 المختبَرة،
        // بلا كتابة وبلا هوية مخترَعة: الهوية من سياق الحالة لا من الأحداث.
        readEvidence: ({ c, asOf, identity }) =>
          collectRecoveryEvidence(
            c.visitorId,
            {
              asOf,
              windowHours: defaultEvidenceWindowHours(cfg),
              identity,
              preferredProductId: c.preferredProductId ?? null,
            },
            cfg
          ),
        resolveCoupon: async (c, context) => {
          const result = await createIncentive(
            {
              c,
              cfg,
              // المحرك وحده يقرر وجود الحافز في هذه الدورة: لا تصفّح ولا
              // إضافة للسلة ولا بدء دفع يكفي.
              incentiveCandidate: context.decision.decision === "RECOMMEND_INCENTIVE",
              now: context.now,
            },
            incentiveStore
          );
          // سبب التخطي يُعدّ للتشخيص فقط — بلا كود ولا جوال ولا معرّف.
          if (!result.ok) {
            skippedIncentives[result.reason] = (skippedIncentives[result.reason] ?? 0) + 1;
            couponFailure = result.reason;
            return null;
          }
          return result.coupon;
        },
        couponFailure,
        now: () => cycleNow,
      })
    : null;

  // 4) الجدولة: نفس الـdispatcher الموجودة، بنفس الصفوف التي حُوِّم عليها
  //    (فالنص المُفحص والمُدرَج نصوص واحدة) ونتائج الـadapter وحدها.
  //    هي الخطوة الوحيدة التي تُدرج، وهي لا تسجّل شيئًا كإرسال.
  const dispatched = dispatcher && pipeline
    ? await dispatcher.dispatch(pipeline.cases, pipeline.outcomes)
    : null;

  const outcomes = pipeline ? pipeline.outcomes : [];
  return NextResponse.json({
    ok: true,
    disabled: false,
    storageReady: ready,
    enabled: cfg.enabled,
    // الوضع الحقيقي كما حُسم: true = لا إرسال في هذه الدورة.
    dryRun: cfg.dryRun,
    settingsSource,
    stagesSource,
    stagesCount: cfg.stages.length,
    closedByPurchase,
    skippedInvalidOrderRef,
    skippedMissingOrderRef,
    plannedMessages: pipeline ? pipeline.counters.allowed : 0,
    // ملخّص Execution Guard: ماذا رُفض ولماذا (بلا PII وبلا نص رسالة).
    pipeline: pipeline
      ? {
          considered: pipeline.counters.considered,
          allowed: pipeline.counters.allowed,
          renderBlocked: pipeline.counters.renderBlocked,
          blockedBy: pipeline.counters.blockedBy,
        }
      : null,
    dispatched,
    settled,
    // G6-C: كم حالة لم تُنشأ لها قسيمة ولماذا — أسماء أسباب فقط.
    incentives: skippedIncentives,
    outcomes: outcomes.slice(0, 50),
  });
}

import { getCustomerSession } from "@/lib/auth";
import { readRecoveryEnabled } from "./toggle";
import { canPersistCases, loadRecoveryConfig } from "./config";
import { SupabaseRecoveryStore } from "./store";
import { RecoveryEngine } from "./engine";
import type { RecoveryInput, SignalType } from "./types";

/**
 * استيعاب إشارة سلوكية في محرك الاسترجاع.
 *
 * قواعد غير قابلة للكسر:
 *  - التشغيل من مفتاح لوحة الإدارة (settings.recovery_enabled) فقط؛ OFF يوقف.
 *  - لا يُرسل أي شيء، ولا يُنشئ كوبون، ولا يمس طلبًا/عميلًا/إعدادات.
 *  - الزائر المجهول يبقى OPEN بلا محاولة تحديد هويته (لا حقل جوال جديد في checkout).
 *  - العميل المسجّل فقط هو من يمكن أن يصبح مؤهلًا للتواصل لاحقًا.
 *  - لا يكسر المسار القائم أبدًا: أي خطأ يُبتلع.
 */

/**
 * الأحداث التي تُترجم إلى إشارة استرجاع.
 * المفتاح = event_type الموجود أصلًا في مسار analytics، والقيمة = SignalType
 * المدعوم أصلًا في المحرّك. لا نضيف أي حدث جديد ولا نظام analytics جديد.
 *
 *   add_to_cart     -> ADD_TO_CART
 *   checkout_start  -> CHECKOUT_STARTED
 *   payment_started -> PAYMENT_STARTED
 *
 * product_view / repeated_product_view غير مُدرجة عمدًا: مخطط recovery_cases
 * لا يملك CaseType يطابقهما، فاستيعابهما ينتج حالة موسومة ADD_TO_CART وهي
 * تسمية خاطئة. تُضافان إن أُضيف نوعهما للمخطط.
 *
 * purchase غير مُدرج: إغلاق الحالات يتم من المصدر الموثوق
 * order.created (notification_events) داخل دورة التشغيل، لا من العميل.
 */
const INGESTIBLE: Record<string, SignalType> = {
  add_to_cart: "add_to_cart",
  checkout_start: "checkout_start",
  payment_started: "payment_started",
};

/**
 * يُستدعى من مسار track بعد نجاح تسجيل الحدث. آمن: أخطاء معطّلة.
 */
export async function maybeIngestRecoverySignal(event: {
  event_type?: string;
  visitor_id?: string;
  session_id?: string;
  product_id?: string | null;
  product_slug?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    // التشغيل محكوم بمفتاح لوحة الإدارة (settings.recovery_enabled) لا بمتغيّر نشر.
    // OFF ⇒ لا استيعاب إطلاقًا. ON ⇒ الاستيعاب يعمل، وdryRun ليس قفل تشغيل.
    const enabled = await readRecoveryEnabled();
    if (!enabled) return;
    const cfg = { ...loadRecoveryConfig(), enabled };
    if (!canPersistCases(cfg)) return;

    const signal = INGESTIBLE[event.event_type || ""];
    if (!signal) return;
    if (!event.visitor_id) return;

    const store = new SupabaseRecoveryStore();
    const ready = await store.ensureReady();
    if (!ready) return;

    const session = await getCustomerSession();
    const subtotal = typeof event.metadata?.subtotal === "number" ? event.metadata.subtotal : null;

    const input: RecoveryInput = {
      visitorId: event.visitor_id,
      sessionId: event.session_id || event.visitor_id,
      signalType: signal,
      productId: event.product_id ?? null,
      productSlug: event.product_slug ?? null,
      subtotal,
      customer: session ? { id: session.id, phone: session.phone } : null,
      occurredAt: Date.now(),
    };

    const engine = new RecoveryEngine(store, cfg);
    await engine.ingest(input);
  } catch {
    // لا نكسر مسار analytics أبدًا.
  }
}

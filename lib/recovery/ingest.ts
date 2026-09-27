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

const INGESTIBLE: Record<string, SignalType> = {
  add_to_cart: "add_to_cart",
  checkout_start: "checkout_start",
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

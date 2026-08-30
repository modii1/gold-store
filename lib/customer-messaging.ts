import { createAdminClient } from "@/lib/supabase/admin";
import { createDeliveries } from "@/lib/notifications/dispatcher";

/**
 * رسالة مباشرة لعميل عبر واتساب (بدون قوالب/قواعد) — تُستخدم لرسائل الحساب
 * (تم إنشاء حسابك + كلمة المرور، إعادة تعيين كلمة المرور). تُنشئ صف إشعار
 * وبالتالي صف تسليم واتساب يلتقطه سيرفر QR الخارجي، بمعزل عن محرك الإشعارات
 * الرئيسي وإعداداته حتى لا نُحدث أي تغيير على سلوكه القائم.
 */
export async function sendCustomerWhatsApp(opts: {
  phone: string;
  title: string;
  message: string;
  type?: string;
  orderId?: string | null;
  orderNumber?: number | null;
  actionUrl?: string | null;
}): Promise<void> {
  const phone = (opts.phone || "").trim();
  if (!phone) return;
  const type = opts.type || "customer.message";
  const supabase = createAdminClient();

  // منع التكرار: نفس الرسالة لنفس العميل خلال آخر 3 دقائق تُتخطى.
  const { data: dup } = await supabase
    .from("notifications")
    .select("id")
    .eq("user_type", "customer")
    .eq("user_id", phone)
    .eq("type", type)
    .eq("title", opts.title)
    .eq("message", opts.message)
    .gte("created_at", new Date(Date.now() - 3 * 60 * 1000).toISOString())
    .limit(1);
  if (dup && dup.length) return;

  const { data, error } = await supabase
    .from("notifications")
    .insert({
      user_type: "customer",
      user_id: phone,
      customer_id: phone,
      order_id: opts.orderId ?? null,
      order_number: opts.orderNumber ?? null,
      type,
      category: "customer",
      severity: "info",
      title: opts.title,
      message: opts.message,
      metadata: {},
      action_url: opts.actionUrl ?? "/account",
      is_read: false,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[customer-messaging] insert failed:", error?.message);
    return;
  }

  await createDeliveries((data as { id: string }).id, ["whatsapp"]);
}
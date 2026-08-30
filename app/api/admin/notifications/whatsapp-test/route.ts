import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendCustomerWhatsApp } from "@/lib/customer-messaging";
import { normalizePhoneInternational } from "@/lib/format";

export const dynamic = "force-dynamic";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * POST /api/admin/notifications/whatsapp-test
 * Creates a test WhatsApp delivery via sendCustomerWhatsApp, then polls the
 * delivery status so the admin panel shows the real result (sent/failed + reason).
 */
export async function POST(req: NextRequest) {
  if (!(await getAdminSession())) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let phone: string | null = null;
  try {
    const body = await req.json();
    phone = normalizePhoneInternational(String(body?.phone || ""));
  } catch {
    return NextResponse.json({ ok: false, error: "طلبات غير صالحة" }, { status: 400 });
  }

  if (!phone) {
    return NextResponse.json({ ok: false, error: "رقم الجوال غير صحيح — الصيغة المطلوبة: 9665xxxxxxxx" }, { status: 400 });
  }

  const testId = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  await sendCustomerWhatsApp({
    phone,
    title: "رسالة اختبار واتساب",
    message: `✅ تم تفعيل إشعارات واتساب بنجاح من لوحة التحكم.\n\nهذه رسالة تجريبية للتأكد من وصول الإشعارات لرقمك.\nمعرف الاختبار: ${testId}`,
    type: "customer.test",
  });

  const supabase = createAdminClient();
  const { data: notifRows } = await supabase
    .from("notifications")
    .select("id")
    .eq("user_type", "customer")
    .eq("user_id", phone)
    .eq("type", "customer.test")
    .like("message", `%${testId}%`)
    .order("created_at", { ascending: false })
    .limit(1);

  const notificationId = (notifRows?.[0]?.id as string | undefined) || null;

  let status = "unknown";
  let errorMessage: string | null = null;
  let sentAt: string | null = null;

  for (let i = 0; i < 7; i++) {
    await sleep(2000);
    if (notificationId) {
      const { data: del } = await supabase
        .from("notification_deliveries")
        .select("status, error_message, sent_at")
        .eq("notification_id", notificationId)
        .eq("channel", "whatsapp")
        .maybeSingle();
      if (del) {
        status = del.status;
        errorMessage = del.error_message;
        sentAt = del.sent_at;
        if (["sent", "delivered", "failed", "permanent_failed"].includes(status)) break;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    phone,
    test_id: testId,
    status,
    sent_at: sentAt,
    error_message: errorMessage,
    hint: "إذا ظهر «لا يوجد رقم واتساب صالح للمستلم»، فسيرفر الواتساب (QR) على جهازك يعمل بنسخة قديمة — حدّث ملف index.js لديه وأعد تشغيله.",
  });
}
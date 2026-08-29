import { createAdminClient } from "@/lib/supabase/admin";
import { getAdminSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { seedNotificationDefaults } from "@/lib/notifications/seed";
import { NotificationSettings } from "@/components/admin/notification-settings";

export const metadata = { title: "إعدادات الإشعارات | لوحة التحكم" };

export default async function AdminNotificationSettingsPage() {
  const isAdmin = await getAdminSession();
  if (!isAdmin) redirect("/admin/login");

  await seedNotificationDefaults();

  const supabase = createAdminClient();

  const [templatesRes, rulesRes, channelsRes, settingsRes] = await Promise.all([
    supabase.from("notification_templates").select("*").order("category", { ascending: true }).order("event_type", { ascending: true }),
    supabase.from("notification_rules").select("*").order("event_type", { ascending: true }),
    supabase.from("notification_channels").select("*").order("code", { ascending: true }),
    supabase.from("settings").select("notifications_paused").eq("id", 1).maybeSingle(),
  ]);

  const templates = templatesRes.data || [];
  const rules = rulesRes.data || [];
  const channels = channelsRes.data || [];
  const paused = Boolean(settingsRes.data && (settingsRes.data as { notifications_paused: boolean }).notifications_paused);

  return (
    <NotificationSettings
      templates={templates}
      rules={rules}
      channels={channels}
      paused={paused}
    />
  );
}

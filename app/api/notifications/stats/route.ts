import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getViewer } from "@/lib/notifications/viewer";

export const dynamic = "force-dynamic";

/**
 * GET /api/notifications/stats?days=7
 * Admin analytics: totals, success rate, by channel, by severity.
 */
export async function GET(req: NextRequest) {
  const viewer = await getViewer();
  if (!viewer || viewer.userType !== "admin") return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const days = Math.min(Number(req.nextUrl.searchParams.get("days") || "7"), 90);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const supabase = createAdminClient();

  const { count: total } = await supabase.from("notifications").select("*", { count: "exact", head: true }).eq("user_type", "admin").gte("created_at", since);

  const bySeverity: Record<string, number> = {};
  for (const severity of ["critical", "warning", "info", "success"]) {
    const { count } = await supabase.from("notifications").select("*", { count: "exact", head: true }).eq("user_type", "admin").eq("severity", severity).gte("created_at", since);
    bySeverity[severity] = count ?? 0;
  }

  const byChannel: Record<string, number> = {};
  for (const channel of ["in_app", "email", "sms", "push", "whatsapp"]) {
    const { count } = await supabase.from("notification_deliveries").select("*", { count: "exact", head: true }).eq("channel", channel).gte("created_at", since);
    const c = count ?? 0;
    if (c > 0) byChannel[channel] = c;
  }

  // Count distinct notifications (not delivery rows) to avoid double-counting
  // when an order creates both admin + customer notifications.
  const { data: successRows } = await supabase
    .from("notification_deliveries")
    .select("notification_id", { count: "exact" })
    .in("status", ["sent", "delivered"])
    .gte("created_at", since);
  const successSet = new Set((successRows || []).map((r: { notification_id: string }) => r.notification_id));
  const success = successSet.size;

  const { data: failedRows } = await supabase
    .from("notification_deliveries")
    .select("notification_id", { count: "exact" })
    .in("status", ["failed", "permanent_failed"])
    .gte("created_at", since);
  const failedSet = new Set((failedRows || []).map((r: { notification_id: string }) => r.notification_id));
  const failed = failedSet.size;

  const deliveriesTotal = success + failed;
  const successRate = deliveriesTotal ? Math.round((success / deliveriesTotal) * 1000) / 10 : 100;

  return NextResponse.json({
    total: total ?? 0,
    success,
    failed,
    successRate,
    bySeverity,
    byChannel,
    days,
  });
}

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
    byChannel[channel] = count ?? 0;
  }

  const { count: success } = await supabase.from("notification_deliveries").select("*", { count: "exact", head: true }).in("status", ["sent", "delivered"]).gte("created_at", since);
  const { count: failed } = await supabase.from("notification_deliveries").select("*", { count: "exact", head: true }).in("status", ["failed", "permanent_failed"]).gte("created_at", since);

  const deliveriesTotal = (success ?? 0) + (failed ?? 0);
  const successRate = deliveriesTotal ? Math.round(((success ?? 0) / deliveriesTotal) * 1000) / 10 : 100;

  return NextResponse.json({
    total: total ?? 0,
    success: success ?? 0,
    failed: failed ?? 0,
    successRate,
    bySeverity,
    byChannel,
    days,
  });
}

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getViewer, viewerFilter } from "@/lib/notifications/viewer";
import { repairStaleNotifications } from "@/lib/notifications/engine";

export const dynamic = "force-dynamic";

/**
 * GET /api/notifications?limit=&offset=&category=&severity=&unread=&q=&order_number=&shipment_id=
 * Returns notifications for the current viewer (admin or customer).
 */
export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const viewer = await getViewer(searchParams.get("as") === "customer" ? "customer" : undefined);
  if (!viewer) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await repairStaleNotifications(100);
  const limit = Math.min(Number(searchParams.get("limit") || "50"), 200);
  const offset = Math.max(Number(searchParams.get("offset") || "0"), 0);

  const supabase = createAdminClient();
  let query = supabase
    .from("notifications")
    .select("id, user_type, order_id, order_number, shipment_id, type, category, severity, title, message, metadata, action_url, is_read, read_at, created_at", { count: "exact" })
    .eq("user_type", viewerFilter(viewer).user_type)
    .order("created_at", { ascending: false });

  if (viewerFilter(viewer).user_id) {
    query = query.eq("user_id", viewerFilter(viewer).user_id);
  }

  const category = searchParams.get("category");
  if (category) query = query.eq("category", category);

  const severity = searchParams.get("severity");
  if (severity) query = query.eq("severity", severity);

  const unread = searchParams.get("unread");
  if (unread === "true") query = query.eq("is_read", false);

  const orderNumber = searchParams.get("order_number");
  if (orderNumber && orderNumber.trim()) query = query.eq("order_number", Number(orderNumber) || -1);

  const q = searchParams.get("q");
  if (q && q.trim()) {
    query = query.or(`title.ilike.%${q.trim()}%,message.ilike.%${q.trim()}%`);
  }

  query = query.range(offset, offset + limit - 1);

  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ notifications: data, total: count ?? 0, limit, offset });
}

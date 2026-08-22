import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getViewer, viewerFilter } from "@/lib/notifications/viewer";

export const dynamic = "force-dynamic";

export async function GET() {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const supabase = createAdminClient();
  let query = supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_type", viewerFilter(viewer).user_type)
    .eq("is_read", false);

  if (viewerFilter(viewer).user_id) {
    query = query.eq("user_id", viewerFilter(viewer).user_id);
  }

  const { count } = await query;

  return NextResponse.json({ count: count ?? 0 });
}

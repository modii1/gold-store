import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getViewer, viewerFilter } from "@/lib/notifications/viewer";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const viewer = await getViewer(req.nextUrl.searchParams.get("as") === "customer" ? "customer" : undefined);
  if (!viewer) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const supabase = createAdminClient();
  const filter = viewerFilter(viewer);
  let builder = supabase
    .from("notifications")
    .update({ is_read: true, read_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("user_type", filter.user_type)
    .eq("is_read", false);
  if (filter.user_id) builder = builder.eq("user_id", filter.user_id);

  const { error } = await builder;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

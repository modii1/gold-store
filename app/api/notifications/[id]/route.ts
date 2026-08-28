import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getViewer, viewerFilter } from "@/lib/notifications/viewer";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const supabase = createAdminClient();
  const filter = viewerFilter(viewer);
  const base = supabase
    .from("notifications")
    .update({ is_read: true, read_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_type", filter.user_type);
  const builder = filter.user_id ? base.eq("user_id", filter.user_id) : base;
  const { data, error } = await builder.select("id").maybeSingle();

  if (error || !data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const supabase = createAdminClient();
  const filter = viewerFilter(viewer);
  const base = supabase
    .from("notifications")
    .delete()
    .eq("id", id)
    .eq("user_type", filter.user_type);
  const builder = filter.user_id ? base.eq("user_id", filter.user_id) : base;
  const { data, error } = await builder.select("id").maybeSingle();

  if (error || !data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}

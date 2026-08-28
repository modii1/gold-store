import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID_TYPES = ["page_view", "product_view", "add_to_cart", "remove_from_cart", "checkout_start", "purchase"];

/**
 * Admin-only. Deletes analytics events (optionally filtered by event type).
 * Orders-based KPIs are unaffected because they come from the orders table.
 * Body: { eventTypes?: string[] } — empty, missing, or ["all"] wipes everything.
 * Returns the number of rows deleted.
 */
export async function DELETE(req: NextRequest) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let eventTypes: string[] = [];
  try {
    const body = await req.json();
    if (Array.isArray(body?.eventTypes)) eventTypes = body.eventTypes;
  } catch {
    eventTypes = [];
  }

  const types = [...new Set(eventTypes.filter((t) => VALID_TYPES.includes(t)))];

  try {
    const supabase = createAdminClient();
    let query = supabase.from("analytics_events").delete().select("id");
    if (types.length > 0) query = query.in("event_type", types) as typeof query;

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ ok: true, count: data?.length ?? 0 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

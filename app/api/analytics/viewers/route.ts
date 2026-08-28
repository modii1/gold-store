import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Returns the real number of distinct visitors currently viewing a product.
 * Counts unique visitor_ids with a product_view in the last 15 minutes,
 * so one device / one visitor is never counted more than once.
 */
export async function GET(req: NextRequest) {
  const productId = req.nextUrl.searchParams.get("product_id");
  if (!productId) return NextResponse.json({ error: "product_id required" }, { status: 400 });

  const VIEW_WINDOW_MS = 15 * 60 * 1000;
  const since = new Date(Date.now() - VIEW_WINDOW_MS).toISOString();

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("analytics_events")
      .select("visitor_id")
      .eq("event_type", "product_view")
      .eq("product_id", productId)
      .gte("created_at", since)
      .limit(500);

    if (error) throw error;
    const real = new Set((data || []).map((r: { visitor_id: string }) => r.visitor_id)).size;
    return NextResponse.json({ viewers: real, real });
  } catch {
    // Table missing (migration not applied) or any error -> 0 (nothing tracked yet).
    return NextResponse.json({ viewers: 0, real: 0 });
  }
}

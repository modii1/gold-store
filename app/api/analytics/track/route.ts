import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_EVENTS = new Set([
  "page_view",
  "product_view",
  "add_to_cart",
  "remove_from_cart",
  "checkout_start",
  "purchase",
]);

type Incoming = {
  visitor_id?: string;
  session_id?: string;
  event_type?: string;
  page_path?: string | null;
  product_id?: string | null;
  product_slug?: string | null;
  referrer?: string | null;
  device_type?: string;
  metadata?: Record<string, unknown>;
};

function sanitize(e: Incoming, fallbackId: string): Incoming | null {
  if (!e || !e.event_type || !ALLOWED_EVENTS.has(e.event_type)) return null;
  if (typeof e.visitor_id !== "string" || e.visitor_id.length < 4 || e.visitor_id.length > 128) return null;
  const sessionId = typeof e.session_id === "string" && e.session_id.length > 0 ? e.session_id : fallbackId;
  const productId = typeof e.product_id === "string" && e.product_id.length > 0 ? e.product_id : null;
  const slug = typeof e.product_slug === "string" && e.product_slug.length > 0 ? e.product_slug.slice(0, 300) : null;
  const path = typeof e.page_path === "string" ? e.page_path.slice(0, 500) : null;
  const referrer = typeof e.referrer === "string" && e.referrer ? e.referrer.slice(0, 500) : null;
  const device = ["mobile", "tablet", "desktop"].includes(e.device_type || "") ? e.device_type : "desktop";
  const metadata = e.metadata && typeof e.metadata === "object" ? e.metadata : {};
  return {
    visitor_id: e.visitor_id,
    session_id: sessionId,
    event_type: e.event_type,
    page_path: path,
    product_id: productId,
    product_slug: slug,
    referrer,
    device_type: device,
    metadata,
  };
}

export async function POST(req: NextRequest) {
  let body: { events?: Incoming[] } & Incoming = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const fallbackId = crypto.randomUUID();
  const list = Array.isArray(body.events) && body.events.length ? body.events : [body];
  const rows = list
    .map((e) => sanitize(e, fallbackId))
    .filter((e): e is NonNullable<typeof e> => Boolean(e));

  if (rows.length === 0) return NextResponse.json({ ok: false }, { status: 400 });

  const supabase = createAdminClient();
  const { error } = await supabase.from("analytics_events").insert(rows);
  if (error) {
    // Table may not exist yet (migration not applied). Silently ignore.
    return NextResponse.json({ ok: rows.length > 0 ? true : false });
  }
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const ALLOWED = new Set(["health", "qr"]);

export async function GET(req: NextRequest) {
  if (!(await getAdminSession())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const path = (req.nextUrl.searchParams.get("path") || "").replace(/^\/+/, "");
  if (!ALLOWED.has(path)) {
    return NextResponse.json({ error: "bad path" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("notification_channels")
    .select("config")
    .eq("code", "whatsapp")
    .maybeSingle();

  const config = (data?.config as Record<string, string> | null) || {};
  const base = (config.bridge_url || "").replace(/\/+$/, "");
  if (!base) {
    return NextResponse.json({ error: "no bridge_url" }, { status: 400 });
  }

  const headers: Record<string, string> = {};
  if (config.bridge_api_key) headers["Authorization"] = `Bearer ${config.bridge_api_key}`;

  try {
    const res = await fetch(`${base}/${path}`, { headers, cache: "no-store" });
    const body = await res.text();
    const contentType = res.headers.get("content-type") || "application/json";
    return new NextResponse(body, {
      status: res.status,
      headers: { "content-type": contentType, "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "لا يمكن الوصول إلى سيرفر الواتساب من Cloudflare — تأكد أنه يعمل وأن الرابط (مع البورت) صحيح." },
      { status: 502 }
    );
  }
}
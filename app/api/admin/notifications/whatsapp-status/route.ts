import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Live status of the WhatsApp QR bridge (written by qr-server to channel config). */
export async function GET() {
  if (!(await getAdminSession())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("notification_channels")
    .select("enabled, config")
    .eq("code", "whatsapp")
    .maybeSingle();

  const config = (data?.config as Record<string, string> | null) || {};
  return NextResponse.json({
    enabled: Boolean(data?.enabled),
    connected: config.connected === "true",
    qr_state: config.qr_state || "idle",
    phone: config.phone || null,
    last_seen: config.last_seen || null,
    bridge_url: config.bridge_url || "",
  });
}
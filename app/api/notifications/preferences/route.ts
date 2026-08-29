import { NextRequest, NextResponse } from "next/server";
import { getCustomerSession } from "@/lib/auth";
import { getCustomerPreferences, saveCustomerPreferences } from "@/lib/notifications/preferences";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Category } from "@/lib/notifications/types";

export const dynamic = "force-dynamic";

const CATEGORIES: Category[] = ["orders", "shipping", "payment", "returns", "marketing"];

type PublicChannel = "email" | "sms" | "push";

/** Channels enabled in the admin panel AND (if the global pause is on) suppressed. */
async function loadEnabledPublicChannels(): Promise<PublicChannel[]> {
  const supabase = createAdminClient();
  try {
    const { data: settings } = await supabase.from("settings").select("notifications_paused").eq("id", 1).maybeSingle();
    if (settings && (settings as { notifications_paused?: boolean }).notifications_paused) return [];
  } catch {}
  const { data } = await supabase.from("notification_channels").select("code, enabled");
  const enabled = new Set<string>();
  for (const row of (data as { code: string; enabled: boolean }[] | null) || []) {
    if (row.enabled) enabled.add(row.code);
  }
  return (["email", "sms", "push"] as PublicChannel[]).filter((c) => enabled.has(c));
}

export async function GET() {
  const session = await getCustomerSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const prefs = await getCustomerPreferences(session.phone);
  const channels = await loadEnabledPublicChannels();
  return NextResponse.json({ preferences: prefs, channels });
}

export async function POST(req: NextRequest) {
  const session = await getCustomerSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const b = body as Record<string, { email?: boolean; sms?: boolean; push?: boolean; in_app?: boolean }>;
  for (const category of CATEGORIES) {
    const values = b[category];
    if (!values) continue;
    await saveCustomerPreferences(session.phone, category, {
      email: Boolean(values.email),
      sms: Boolean(values.sms),
      push: Boolean(values.push),
      in_app: true,
    });
  }

  return NextResponse.json({ success: true });
}

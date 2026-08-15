import { NextRequest, NextResponse } from "next/server";
import { getCustomerSession } from "@/lib/auth";
import { getCustomerPreferences, saveCustomerPreferences } from "@/lib/notifications/preferences";
import type { Category } from "@/lib/notifications/types";

export const dynamic = "force-dynamic";

const CATEGORIES: Category[] = ["orders", "shipping", "payment", "returns", "marketing"];

export async function GET() {
  const session = await getCustomerSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const prefs = await getCustomerPreferences(session.phone);
  return NextResponse.json({ preferences: prefs });
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

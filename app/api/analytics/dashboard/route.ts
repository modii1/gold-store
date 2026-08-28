import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { getDashboard } from "@/lib/analytics/dashboard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rangeParam = req.nextUrl.searchParams.get("range") || "7d";
  const range = rangeParam === "today" || rangeParam === "30d" ? rangeParam : "7d";

  try {
    const data = await getDashboard(range);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

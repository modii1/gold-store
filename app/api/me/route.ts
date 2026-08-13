import { NextResponse } from "next/server";
import { getCustomerSession } from "@/lib/auth";

export async function GET() {
  const session = await getCustomerSession();
  if (!session) return NextResponse.json({ loggedIn: false }, { status: 200 });
  return NextResponse.json({ loggedIn: true, name: session.name, phone: session.phone });
}

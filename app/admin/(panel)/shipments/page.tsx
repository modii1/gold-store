import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ShipmentsTable } from "./shipments-table";

export const dynamic = "force-dynamic";

export default async function AdminShipmentsPage() {
  if (!(await getAdminSession())) redirect("/admin");
  const supabase = createAdminClient();
  const { data: shipments } = await supabase.from("shipments").select("*").order("created_at", { ascending: false }).limit(200);
  return <ShipmentsTable shipments={(shipments as any[]) || []} />;
}

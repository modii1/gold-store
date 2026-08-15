import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ShipmentsTable } from "./shipments-table";
import { syncOtoShipments } from "@/lib/oto/sync";

export const dynamic = "force-dynamic";

export default async function AdminShipmentsPage() {
  if (!(await getAdminSession())) redirect("/admin");

  const supabase = createAdminClient();

  // Pull live tracking data from OTO so local rows show real details
  let syncResult: { total: number; updated: number; failed: number; skipped: number } | null = null;
  try {
    syncResult = await syncOtoShipments(100);
  } catch {
    syncResult = null;
  }

  const { data: shipments } = await supabase.from("shipments").select("*").order("created_at", { ascending: false }).limit(200);
  return <ShipmentsTable shipments={(shipments as any[]) || []} syncResult={syncResult} />;
}

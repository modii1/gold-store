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

  // Attach order number + customer name so the table is actionable even when
  // OTO hasn't assigned tracking details yet.
  const orderIds = Array.from(new Set(((shipments || []) as { order_id: string | null }[]).map((s) => s.order_id).filter(Boolean)));
  const orders = new Map<string, { order_number: number | null; customer_name: string | null; customer_city: string | null }>();
  if (orderIds.length) {
    const { data: orderRows } = await supabase
      .from("orders")
      .select("id, order_number, customer_name, customer_city")
      .in("id", orderIds);
    (orderRows || []).forEach((o) => orders.set(o.id, o));
  }

  const enriched = ((shipments || []) as any[]).map((s) => {
    const o = s.order_id ? orders.get(s.order_id) : undefined;
    return { ...s, order_number: o?.order_number ?? null, customer_name: o?.customer_name ?? null, customer_city: o?.customer_city ?? null };
  });

  return <ShipmentsTable shipments={enriched} syncResult={syncResult} />;
}

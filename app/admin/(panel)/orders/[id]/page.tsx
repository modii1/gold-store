import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { OrderDetail } from "../order-detail";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: order } = await supabase
    .from("orders")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!order) notFound();

  const [statusLog, notes, shipments] = await Promise.all([
    supabase.from("order_status_log").select("*").eq("order_id", id).order("created_at", { ascending: true }).then((r) => r.data || []),
    supabase.from("order_notes").select("*").eq("order_id", id).order("created_at", { ascending: true }).then((r) => r.data || []),
    supabase.from("shipments").select("*").eq("order_id", id).order("created_at", { ascending: false }).then((r) => r.data || []),
  ]);

  return (
    <OrderDetail
      order={order as any}
      statusLog={statusLog as any}
      notes={notes as any}
      shipments={shipments as any}
    />
  );
}

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

  async function safeQuery(table: string, id: string, order: "created_at" | "updated_at", ascending: boolean) {
    try {
      const r = await supabase.from(table).select("*").eq("order_id", id).order(order, { ascending });
      if (r.error) return [];
      return r.data || [];
    } catch {
      return [];
    }
  }

  const [statusLog, notes, shipments] = await Promise.all([
    safeQuery("order_status_log", id, "created_at", true),
    safeQuery("order_notes", id, "created_at", true),
    safeQuery("shipments", id, "created_at", false),
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

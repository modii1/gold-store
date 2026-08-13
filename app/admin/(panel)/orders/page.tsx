import { createClient } from "@/lib/supabase/server";
import { getCarriers } from "@/lib/services/carriers";
import { OrdersTable } from "./orders-table";

export default async function AdminOrdersPage() {
  const supabase = await createClient();
  const [{ data: orders }, carriers] = await Promise.all([
    supabase.from("orders").select("*").order("created_at", { ascending: false }),
    getCarriers(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">الطلبات</h1>
        <p className="mt-1 text-sm text-stone-500">إدارة طلبات العملاء</p>
      </div>
      <OrdersTable orders={orders ?? []} carriers={carriers} />
    </div>
  );
}

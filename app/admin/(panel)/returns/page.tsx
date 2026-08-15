import { createAdminClient } from "@/lib/supabase/admin";
import { ReturnCard } from "./return-card";

export default async function AdminReturnsPage() {
  const { data: returns } = await createAdminClient()
    .from("return_requests")
    .select("*, orders(order_number, customer_name, customer_phone, total)")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">مراجعة المرتجعات</h1>
        <p className="mt-1 text-sm text-stone-500">مراجعة طلبات الاسترجاع واتخاذ القرار.</p>
      </div>
      {!returns?.length ? (
        <div className="rounded-2xl border border-amber-100 bg-white p-12 text-center text-stone-400">
          لا توجد طلبات استرجاع
        </div>
      ) : (
        returns.map((request: any) => (
          <ReturnCard key={request.id} request={request} />
        ))
      )}
    </div>
  );
}

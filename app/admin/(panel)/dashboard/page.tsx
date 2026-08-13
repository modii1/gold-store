import { createClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/format";
import { Currency } from "@/components/storefront/currency";

export default async function AdminDashboardPage() {
  const supabase = await createClient();

  const { count: productsCount } = await supabase.from("products").select("*", { count: "exact", head: true });
  const { count: pendingOrders } = await supabase.from("orders").select("*", { count: "exact", head: true }).eq("status", "pending");
  const { count: paidOrders } = await supabase.from("orders").select("*", { count: "exact", head: true }).eq("status", "paid");
  const { count: totalOrders } = await supabase.from("orders").select("*", { count: "exact", head: true });

  const { data: orders } = await supabase
    .from("orders")
    .select("total, status, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  const revenue = (orders || [])
    .filter((o) => o.status === "paid" || o.status === "delivered")
    .reduce((s, o) => s + (o.total || 0), 0);

  const stats = [
    { label: "المنتجات", value: String(productsCount ?? 0), color: "text-gold", bg: "bg-amber-50" },
    { label: "إجمالي الطلبات", value: String(totalOrders ?? 0), color: "text-teal-700", bg: "bg-teal-50" },
    { label: "طلبات جديدة", value: String(pendingOrders ?? 0), color: "text-amber-700", bg: "bg-amber-50" },
    { label: "طلبات مدفوعة", value: String(paidOrders ?? 0), color: "text-emerald-700", bg: "bg-emerald-50" },
    { label: "الإيرادات", value: <Currency value={revenue} />, color: "text-violet-700", bg: "bg-violet-50" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">الملخص</h1>
        <p className="mt-1 text-sm text-stone-500">نظرة عامة على المتجر</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        {stats.map((s) => (
          <article key={s.label} className="rounded-2xl border border-amber-100 bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-stone-500">{s.label}</p>
            <p className={`mt-2 text-2xl font-bold ${s.color}`}>{s.value}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

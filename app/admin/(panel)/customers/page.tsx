import Link from "next/link";
import { ArrowLeft, Mail, Phone, Users } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatCurrency } from "@/lib/format";
import { Currency } from "@/components/storefront/currency";

type Customer = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  created_at: string;
};

type CustomerOrder = {
  customer_identifier: string | null;
  customer_phone: string;
  total: number;
  status: string;
  created_at: string;
};

export default async function AdminCustomersPage() {
  const supabase = createAdminClient();
  const [{ data: customers }, { data: orders }] = await Promise.all([
    supabase.from("customers").select("id,name,phone,email,created_at").order("created_at", { ascending: false }),
    supabase.from("orders").select("customer_identifier,customer_phone,total,status,created_at").order("created_at", { ascending: false }),
  ]);

  const customerRows = ((customers || []) as Customer[]).map((customer) => {
    const customerOrders = ((orders || []) as CustomerOrder[]).filter(
      (order) => (order.customer_identifier || order.customer_phone) === customer.phone
    );
    const totalSpent = customerOrders
      .filter((order) => ["paid", "delivered"].includes(order.status))
      .reduce((sum, order) => sum + Number(order.total || 0), 0);

    return {
      ...customer,
      orderCount: customerOrders.length,
      totalSpent,
      lastOrder: customerOrders[0]?.created_at || null,
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-gold">
            <Users className="h-5 w-5" />
            <span className="text-sm font-bold">إدارة العملاء</span>
          </div>
          <h1 className="mt-2 text-2xl font-bold text-stone-900">العملاء المسجلون</h1>
          <p className="mt-1 text-sm text-stone-500">ملف كامل لكل عميلة ونشاطها الشرائي في المتجر.</p>
        </div>
        <div className="rounded-2xl border border-amber-100 bg-amber-50 px-5 py-3 text-center">
          <p className="text-xs font-semibold text-stone-500">إجمالي العملاء</p>
          <p className="mt-1 text-2xl font-bold text-gold">{customerRows.length}</p>
        </div>
      </div>

      {customerRows.length === 0 ? (
        <div className="rounded-2xl border border-amber-100 bg-white p-12 text-center text-stone-400">
          لا يوجد عملاء مسجلون حتى الآن
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-amber-100 bg-white shadow-sm">
          <div className="hidden grid-cols-[1.4fr_1fr_1.3fr_.7fr_1fr_auto] gap-4 border-b border-stone-100 bg-stone-50 px-5 py-3 text-xs font-bold text-stone-500 md:grid">
            <span>العميل</span><span>التواصل</span><span>تاريخ التسجيل</span><span>الطلبات</span><span>إجمالي المدفوع</span><span />
          </div>
          <div className="divide-y divide-stone-100">
            {customerRows.map((customer) => (
              <div key={customer.id} className="grid gap-4 px-5 py-5 md:grid-cols-[1.4fr_1fr_1.3fr_.7fr_1fr_auto] md:items-center">
                <div>
                  <p className="font-bold text-stone-900">{customer.name}</p>
                  <p className="mt-1 text-xs text-stone-400">رقم العميل: {customer.id.slice(0, 8)}</p>
                </div>
                <div className="space-y-1 text-sm text-stone-600">
                  <p className="flex items-center gap-1.5" dir="ltr"><Phone className="h-3.5 w-3.5 text-gold" />{customer.phone}</p>
                  {customer.email && <p className="flex items-center gap-1.5 truncate"><Mail className="h-3.5 w-3.5 shrink-0 text-gold" />{customer.email}</p>}
                </div>
                <p className="text-sm text-stone-500">{new Date(customer.created_at).toLocaleDateString("ar-SA")}</p>
                <p className="text-sm font-bold text-stone-800">{customer.orderCount}</p>
                <Currency value={customer.totalSpent} className="text-sm font-bold text-emerald-700" />
                <Link href={`/admin/customers/${customer.id}`} className="inline-flex items-center justify-center gap-1 rounded-xl bg-stone-900 px-3 py-2 text-xs font-bold text-white transition hover:bg-gold">
                  التفاصيل <ArrowLeft className="h-3.5 w-3.5" />
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

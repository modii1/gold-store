import Link from "next/link";
import { ArrowRight, CalendarDays, Mail, MapPin, Package, Phone, ShoppingBag } from "lucide-react";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatCurrency, formatDate, formatDateOnly } from "@/lib/format";
import { Currency } from "@/components/storefront/currency";

export default async function AdminCustomerDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createAdminClient();
  const { data: customer } = await supabase.from("customers").select("id,name,phone,email,created_at").eq("id", id).maybeSingle();
  if (!customer) notFound();

  const { data: orders } = await supabase
    .from("orders")
    .select("id,order_number,customer_name,customer_phone,customer_city,region,address,national_address,items,total,shipping_cost,discount,status,payment_method,shipping_method,notes,created_at")
    .or(`customer_identifier.eq.${customer.phone},customer_phone.eq.${customer.phone}`)
    .order("created_at", { ascending: false });

  const customerOrders = orders || [];
  const paidOrders = customerOrders.filter((order) => ["paid", "delivered"].includes(order.status));
  const totalSpent = paidOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const totalItems = customerOrders.reduce((sum, order) => sum + (Array.isArray(order.items) ? order.items.reduce((n: number, item: { qty?: number }) => n + Number(item.qty || 0), 0) : 0), 0);

  return (
    <div className="space-y-6">
      <Link href="/admin/customers" className="inline-flex items-center gap-2 text-sm font-bold text-stone-500 transition hover:text-gold">
        <ArrowRight className="h-4 w-4" /> العودة إلى العملاء
      </Link>

      <section className="rounded-2xl border border-amber-100 bg-gradient-to-br from-white to-amber-50/50 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="text-sm font-bold text-gold">ملف العميل</p>
            <h1 className="mt-2 text-3xl font-bold text-stone-900">{customer.name}</h1>
            <p className="mt-2 text-xs text-stone-400">معرف العميل: {customer.id}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="الطلبات" value={String(customerOrders.length)} icon={<ShoppingBag className="h-4 w-4" />} />
            <Stat label="المشتريات" value={formatCurrency(totalSpent)} icon={<img src="/currency-mark.svg" alt="" className="h-4 w-4" />} />
            <Stat label="القطع" value={String(totalItems)} icon={<Package className="h-4 w-4" />} />
            <Stat label="المدفوع" value={String(paidOrders.length)} icon={<span className="text-sm">✓</span>} />
          </div>
        </div>
        <div className="mt-6 grid gap-3 border-t border-amber-100 pt-5 text-sm text-stone-600 sm:grid-cols-3">
          <p className="flex items-center gap-2" dir="ltr"><Phone className="h-4 w-4 text-gold" />{customer.phone}</p>
          <p className="flex items-center gap-2"><Mail className="h-4 w-4 text-gold" />{customer.email || "لا يوجد بريد إلكتروني"}</p>
          <p className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-gold" />سجلت في <span className="text-right" dir="ltr">{formatDateOnly(customer.created_at)}</span></p>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div><h2 className="text-xl font-bold text-stone-900">سجل الطلبات</h2><p className="mt-1 text-sm text-stone-500">كل الطلبات المرتبطة برقم جوال العميل.</p></div>
        </div>
        {customerOrders.length === 0 ? (
          <div className="rounded-2xl border border-amber-100 bg-white p-10 text-center text-stone-400">لا توجد طلبات لهذا العميل</div>
        ) : customerOrders.map((order) => (
          <article key={order.id} className="rounded-2xl border border-amber-100 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="font-bold text-stone-900">طلب #{order.order_number}</p>
                <p className="mt-1 text-xs text-stone-400 text-right" dir="ltr">{formatDate(order.created_at)}</p>
              </div>
              <div className="text-start"><Currency value={order.total} className="text-lg font-bold text-gold" /><Status status={order.status} /></div>
            </div>
            <div className="mt-4 grid gap-3 border-t border-stone-100 pt-4 text-sm text-stone-600 sm:grid-cols-2">
              <p className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-gold" />{[order.address, order.national_address, order.region, order.customer_city].filter(Boolean).join("، ") || "لا يوجد عنوان محفوظ"}</p>
              <p>الدفع: {order.payment_method || "غير محدد"} · الشحن: {order.shipping_method || "غير محدد"}</p>
            </div>
            <div className="mt-4 rounded-xl bg-stone-50 p-3 text-sm">
              {(order.items || []).map((item: { name?: string; qty?: number; price?: number }, index: number) => <p key={index} className="flex justify-between gap-3 py-1 text-stone-700"><span>{item.name || "منتج"} × {item.qty || 0}</span><Currency value={Number(item.price || 0) * Number(item.qty || 0)} /></p>)}
            </div>
            {order.notes && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-stone-600">ملاحظات: {order.notes}</p>}
          </article>
        ))}
      </section>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return <div className="min-w-20 rounded-xl border border-amber-100 bg-white px-3 py-2 text-center"><div className="flex items-center justify-center gap-1 text-gold">{icon}</div><p className="mt-1 text-sm font-bold text-stone-900">{value}</p><p className="text-[10px] text-stone-400">{label}</p></div>;
}

function Status({ status }: { status: string }) {
  const labels: Record<string, string> = { pending: "قيد المراجعة", confirmed: "مؤكد", processing: "قيد التجهيز", shipped: "جاري الشحن", picked_up: "استلام الشحنة", in_transit: "في الطريق", out_for_delivery: "خرج للتوصيل", delivered: "تم التسليم", paid: "مدفوع", cancelled: "ملغي", returned: "مرتجع" };
  return <span className="mt-1 inline-block rounded-full bg-stone-100 px-2.5 py-1 text-xs font-semibold text-stone-600">{labels[status] || status}</span>;
}

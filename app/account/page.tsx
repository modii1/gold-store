import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Package, LogOut, Heart, ShoppingBag, Phone, MapPin, ExternalLink, RotateCcw, Truck, Banknote, Home, LayoutDashboard, Bell, Clock, CheckCircle2, XCircle } from "lucide-react";
import { StoreHeader } from "@/components/storefront/header";
import { StoreFooter } from "@/components/storefront/footer";
import { getCustomerSession } from "@/lib/auth";
import { customerLogoutAction } from "@/app/actions/logout";
import { getOrdersByPhoneAction } from "@/app/actions/orders";
import { getSettings } from "@/lib/services/settings";
import { getCategoriesList } from "@/lib/services/products";
import { formatDate } from "@/lib/format";
import { Currency } from "@/components/storefront/currency";
import { createAdminClient } from "@/lib/supabase/admin";
import { createReturnRequestAction } from "@/app/actions/customer-data";
import { CustomerOrdersSection } from "@/components/customer-orders-section";

export const metadata: Metadata = { title: "لوحة حسابي | لمعة" };

async function requestReturnForm(formData: FormData) {
  "use server";
  await createReturnRequestAction(formData);
}

const RETURN_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "قيد المراجعة", cls: "bg-amber-50 text-amber-700" },
  approved: { label: "مقبول", cls: "bg-emerald-50 text-emerald-700" },
  rejected: { label: "مرفوض", cls: "bg-red-50 text-red-600" },
  received: { label: "تم الاستلام", cls: "bg-blue-50 text-blue-700" },
  refunded: { label: "تم رد المبلغ", cls: "bg-stone-100 text-stone-700" },
};

export default async function AccountPage() {
  const session = await getCustomerSession();
  if (!session) redirect("/login");

  const [settings, categories, orders] = await Promise.all([
    getSettings(),
    getCategoriesList(),
    getOrdersByPhoneAction(session.phone),
  ]);
  let addresses: any[] = [];
  let returns: any[] = [];
  let shipmentByOrder = new Map<string, any>();
  try {
    const admin = createAdminClient();
    const result = await Promise.all([
      admin.from("addresses").select("*").eq("customer_identifier", session.phone).order("is_default", { ascending: false }).order("created_at", { ascending: false }),
      admin.from("return_requests").select("id,order_id,reason,details,status,admin_note,created_at").eq("customer_identifier", session.phone).order("created_at", { ascending: false }),
    ]);
    addresses = result[0].data || [];
    returns = result[1].data || [];

    // Attach live shipment data (status, tracking, carrier) from OTO sync.
    const orderIds = orders.map((o) => o.id);
    if (orderIds.length) {
      const { data: shipmentRows } = await admin
        .from("shipments")
        .select("id,order_id,oto_order_id,status,dc_status,tracking_number,dc_tracking_number,tracking_url,branded_tracking_url,print_awb_url,delivery_company,delivery_option_name,driver_name")
        .in("order_id", orderIds)
        .order("created_at", { ascending: false });
      (shipmentRows || []).forEach((s: any) => {
        if (!shipmentByOrder.has(s.order_id)) shipmentByOrder.set(s.order_id, s);
      });
    }
  } catch {
    // The account page remains usable if optional customer tables are unavailable.
  }

  const totalSpent = orders.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const pendingOrders = orders.filter((o) => ["pending", "confirmed", "processing"].includes(o.status)).length;
  const shippedOrders = orders.filter((o) => o.status === "shipped").length;
  const deliveredOrders = orders.filter((o) => ["delivered", "paid"].includes(o.status)).length;
  const cancelledOrders = orders.filter((o) => o.status === "cancelled").length;
  const activeReturnOrderIds = new Set((returns || []).filter((r: any) => ["pending", "approved", "received"].includes(r.status)).map((r: any) => r.order_id));
  const returnableOrders = orders.filter((o) => ["delivered", "paid"].includes(o.status) && !activeReturnOrderIds.has(o.id));

  const stats: { label: string; value?: string; money?: number; icon: typeof Package; cls: string }[] = [
    { label: "إجمالي الطلبات", value: String(orders.length), icon: Package, cls: "bg-amber-50 text-amber-700" },
    { label: "قيد المتابعة", value: String(pendingOrders), icon: Clock, cls: "bg-indigo-50 text-indigo-700" },
    { label: "تم الشحن", value: String(shippedOrders), icon: Truck, cls: "bg-blue-50 text-blue-700" },
    { label: "تم التسليم", value: String(deliveredOrders), icon: CheckCircle2, cls: "bg-teal-50 text-teal-700" },
    { label: "ملغية", value: String(cancelledOrders), icon: XCircle, cls: "bg-red-50 text-red-500" },
    { label: "إجمالي المشتريات", money: totalSpent, icon: Banknote, cls: "bg-emerald-50 text-emerald-700" },
  ];

  return (
    <>
      <StoreHeader settings={settings} categories={categories} />
      <main className="flex-1 mx-auto max-w-7xl px-4 md:px-6 py-8">
        {/* Greeting */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-ink">أهلاً {session.name.split(" ")[0]} 👋</h1>
            <p className="mt-1 text-sm text-stone-500">لوحة حسابك — إدارة طلباتك وعناوينك واسترجاعاتك</p>
          </div>
          <Link href="/shop" className="flex items-center gap-2 rounded-full bg-ink px-6 py-2.5 text-sm font-bold text-ivory hover:bg-gold transition">
            <ShoppingBag className="h-4 w-4" /> متابعة التسوق
          </Link>
        </div>

        <div className="mt-8 flex flex-col gap-6 lg:flex-row">
          {/* ===== Sidebar ===== */}
          <aside className="lg:w-64 shrink-0">
            <div className="rounded-3xl border border-sand bg-white p-5 lg:sticky lg:top-6">
              <div className="flex items-center gap-3 border-b border-sand pb-4">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-gold to-gold-dark text-lg font-bold text-white">
                  {session.name.charAt(0)}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-bold text-ink">{session.name}</p>
                  <p className="flex items-center gap-1 text-xs text-stone-500" dir="ltr">
                    <Phone className="h-3 w-3 text-gold" /> {session.phone}
                  </p>
                </div>
              </div>
              <nav className="mt-4 space-y-1">
                <a href="#overview" className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold text-stone-700 hover:bg-cream hover:text-ink transition">
                  <LayoutDashboard className="h-4 w-4 text-gold" /> نظرة عامة
                </a>
                <a href="#orders" className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold text-stone-700 hover:bg-cream hover:text-ink transition">
                  <Package className="h-4 w-4 text-gold" /> طلباتي
                </a>
                <a href="#addresses" className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold text-stone-700 hover:bg-cream hover:text-ink transition">
                  <MapPin className="h-4 w-4 text-gold" /> عناويني
                </a>
                <a href="#returns" className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold text-stone-700 hover:bg-cream hover:text-ink transition">
                  <RotateCcw className="h-4 w-4 text-gold" /> الاسترجاع
                </a>
                <Link href="/favorites" className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold text-stone-700 hover:bg-cream hover:text-ink transition">
                  <Heart className="h-4 w-4 text-gold" /> المفضلة
                </Link>
                <Link href="/account/notifications" className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold text-stone-700 hover:bg-cream hover:text-ink transition">
                  <Bell className="h-4 w-4 text-gold" /> الإشعارات
                </Link>
                <Link href="/shop" className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold text-stone-700 hover:bg-cream hover:text-ink transition">
                  <Home className="h-4 w-4 text-gold" /> المتجر
                </Link>
                <form action={customerLogoutAction} className="pt-2 border-t border-sand">
                  <button type="submit" className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold text-rose-600 hover:bg-rose-50 transition">
                    <LogOut className="h-4 w-4" /> تسجيل الخروج
                  </button>
                </form>
              </nav>
            </div>
          </aside>

          {/* ===== Content ===== */}
          <div className="flex-1 min-w-0 space-y-8">
            {/* Overview / stats */}
            <section id="overview" className="scroll-mt-24">
              <h2 className="flex items-center gap-2 text-lg font-bold text-ink"><LayoutDashboard className="h-5 w-5 text-gold" /> نظرة عامة</h2>
              <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                {stats.map((s, i) => (
                  <div key={i} className="rounded-3xl border border-sand bg-white p-5">
                    <span className={`flex h-10 w-10 items-center justify-center rounded-2xl ${s.cls}`}>
                      <s.icon className="h-5 w-5" />
                    </span>
                    <p className="mt-3 text-2xl font-bold text-ink">
                      {s.money !== undefined ? <Currency value={s.money} className="text-2xl font-bold text-ink" /> : s.value}
                    </p>
                    <p className="mt-0.5 text-xs text-stone-500">{s.label}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* Orders */}
            <section id="orders" className="scroll-mt-24">
              <h2 className="flex items-center gap-2 text-lg font-bold text-ink"><Package className="h-5 w-5 text-gold" /> طلباتي</h2>
              <CustomerOrdersSection orders={orders} shipmentMap={shipmentByOrder} />
            </section>

            {/* Addresses */}
            <section id="addresses" className="scroll-mt-24 rounded-3xl border border-sand bg-white p-6">
              <h2 className="flex items-center gap-2 text-lg font-bold text-ink"><MapPin className="h-5 w-5 text-gold" /> عناويني المحفوظة</h2>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {(addresses || []).map((address: any) => (
                  <article key={address.id} className="rounded-2xl border border-sand p-4">
                    <div className="flex items-center justify-between"><b>{address.label || "عنواني"}</b>{address.is_default && <span className="text-xs font-bold text-emerald-700">الافتراضي</span>}</div>
                    <p className="mt-2 text-sm text-stone-500">{[address.address, address.city, address.region].filter(Boolean).join("، ") || "موقع محدد بالخريطة"}</p>
                    {address.maps_url && <a href={address.maps_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-gold">فتح الخريطة <ExternalLink className="h-3 w-3" /></a>}
                  </article>
                ))}
                {(addresses || []).length === 0 && <p className="rounded-2xl border border-dashed border-sand bg-stone-50 p-4 text-sm text-stone-500">ستُحفظ عناوينك تلقائياً عند إتمام الطلب.</p>}
              </div>
            </section>

            {/* Returns */}
            <section id="returns" className="scroll-mt-24 rounded-3xl border border-sand bg-white p-6">
              <h2 className="flex items-center gap-2 text-lg font-bold text-ink"><RotateCcw className="h-5 w-5 text-gold" /> طلبات الاسترجاع</h2>
              <div className="mt-4 space-y-3">
                {(returns || []).length === 0 && <p className="text-sm text-stone-400">لا توجد طلبات استرجاع.</p>}
                {(returns || []).map((request: any) => {
                  const rst = RETURN_STATUS[request.status] || { label: request.status, cls: "bg-stone-100 text-stone-700" };
                  return (
                    <div key={request.id} className="rounded-2xl bg-stone-50 p-4 text-sm">
                      <div className="flex justify-between items-center gap-2">
                        <span className="font-bold">طلب #{request.order_id.slice(0, 8)}</span>
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${rst.cls}`}>{rst.label}</span>
                      </div>
                      <p className="mt-1 text-stone-500">{request.reason} {request.details && `— ${request.details}`}</p>
                      {request.admin_note && <p className="mt-1 text-xs text-stone-400">ملاحظة: {request.admin_note}</p>}
                      <p className="mt-1 text-xs text-stone-400 text-right" dir="ltr">{formatDate(request.created_at)}</p>
                    </div>
                  );
                })}
              </div>
              {returnableOrders.length > 0 && (
                <div className="mt-4 border-t border-sand pt-4">
                  <p className="mb-2 text-sm font-bold text-ink">طلب استرجاع لطلب مُسلَّم:</p>
                  <div className="space-y-2">
                    {returnableOrders.map((order) => (
                      <form key={order.id} action={requestReturnForm} className="flex flex-wrap items-center gap-2 rounded-2xl bg-stone-50 p-3">
                        <input type="hidden" name="order_id" value={order.id} />
                        <span className="text-sm font-bold">طلب #{order.order_number}</span>
                        <select name="reason" className="flex-1 min-w-[160px] rounded-xl border border-sand px-3 py-2 text-sm">
                          <option>استرجاع المنتج</option>
                          <option>منتج تالف</option>
                          <option>منتج غير مطابق</option>
                        </select>
                        <button className="rounded-xl bg-ink px-4 py-2 text-xs font-bold text-white hover:bg-gold transition">طلب استرجاع</button>
                      </form>
                    ))}
                  </div>
                </div>
              )}
            </section>
          </div>
        </div>
      </main>
      <StoreFooter settings={settings} />
    </>
  );
}

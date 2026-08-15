import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Package, LogOut, Heart, ShoppingBag, Phone, MapPin, ExternalLink, RotateCcw, Truck, Banknote, Home, LayoutDashboard } from "lucide-react";
import { StoreHeader } from "@/components/storefront/header";
import { StoreFooter } from "@/components/storefront/footer";
import { getCustomerSession } from "@/lib/auth";
import { customerLogoutAction } from "@/app/actions/logout";
import { getOrdersByPhoneAction } from "@/app/actions/orders";
import { getSettings } from "@/lib/services/settings";
import { getCategoriesList } from "@/lib/services/products";
import { formatDate, pluralizeArabic } from "@/lib/format";
import { Currency } from "@/components/storefront/currency";
import { createAdminClient } from "@/lib/supabase/admin";
import { createReturnRequestAction } from "@/app/actions/customer-data";

export const metadata: Metadata = { title: "لوحة حسابي | لمعة" };

async function requestReturnForm(formData: FormData) {
  "use server";
  await createReturnRequestAction(formData);
}

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "قيد المراجعة", cls: "bg-amber-50 text-amber-700" },
  confirmed: { label: "مؤكد", cls: "bg-sky-50 text-sky-700" },
  processing: { label: "قيد التجهيز", cls: "bg-indigo-50 text-indigo-700" },
  shipped: { label: "تم الشحن", cls: "bg-blue-50 text-blue-700" },
  delivered: { label: "تم التسليم", cls: "bg-teal-50 text-teal-700" },
  paid: { label: "مدفوع", cls: "bg-emerald-50 text-emerald-700" },
  cancelled: { label: "ملغي", cls: "bg-red-50 text-red-600" },
  returned: { label: "مرتجع", cls: "bg-rose-50 text-rose-600" },
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
  try {
    const admin = createAdminClient();
    const result = await Promise.all([
      admin.from("addresses").select("*").eq("customer_identifier", session.phone).order("is_default", { ascending: false }).order("created_at", { ascending: false }),
      admin.from("return_requests").select("id,order_id,reason,details,status,admin_note,created_at").eq("customer_identifier", session.phone).order("created_at", { ascending: false }),
    ]);
    addresses = result[0].data || [];
    returns = result[1].data || [];
  } catch {
    // The account page remains usable if optional customer tables are unavailable.
  }

  const totalSpent = orders.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const activeOrders = orders.filter((o) => ["pending", "confirmed", "processing", "shipped"].includes(o.status)).length;
  const returnableOrders = orders.filter((o) => ["delivered", "paid"].includes(o.status));

  const stats: { label: string; value?: string; money?: number; icon: typeof Package; cls: string }[] = [
    { label: "إجمالي الطلبات", value: String(orders.length), icon: Package, cls: "bg-amber-50 text-amber-700" },
    { label: "إجمالي المشتريات", money: totalSpent, icon: Banknote, cls: "bg-emerald-50 text-emerald-700" },
    { label: "طلبات قيد التنفيذ", value: String(activeOrders), icon: Truck, cls: "bg-sky-50 text-sky-700" },
    { label: "العناوين المحفوظة", value: String(addresses.length), icon: MapPin, cls: "bg-violet-50 text-violet-700" },
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
              <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
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
              {orders.length === 0 ? (
                <div className="mt-4 rounded-3xl border border-sand bg-white p-12 text-center">
                  <Package className="mx-auto mb-3 h-10 w-10 text-gold/40" />
                  <p className="text-stone-500">لا توجد طلبات بعد</p>
                  <Link href="/shop" className="mt-4 inline-block rounded-full bg-ink px-8 py-3 text-sm font-bold text-ivory hover:bg-gold transition">
                    ابدئي التسوق
                  </Link>
                </div>
              ) : (
                <>
                  {/* Mobile cards */}
                  <div className="mt-4 space-y-4 lg:hidden">
                    {orders.map((o) => {
                      const st = STATUS[o.status] || STATUS.pending;
                      return (
                        <article key={o.id} className="rounded-3xl border border-sand bg-white p-5">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="font-bold text-ink">طلب #{o.order_number}</p>
                              <p className="mt-0.5 text-xs text-stone-400 text-right" dir="ltr">{formatDate(o.created_at)}</p>
                            </div>
                            <div className="flex items-center gap-2"><span className={`rounded-full px-3 py-1 text-xs font-bold ${st.cls}`}>{st.label}</span>{o.tracking_url && <a href={o.tracking_url} target="_blank" rel="noreferrer" className="text-xs font-bold text-gold">تتبع</a>}</div>
                          </div>
                          <div className="mt-4 space-y-2 border-t border-sand pt-4">
                            {(o.items || []).map((item, i) => (
                              <div key={i} className="flex items-center justify-between text-sm">
                                <span className="text-stone-700">{item.name} × {item.qty}</span>
                                <Currency value={item.price * item.qty} className="text-stone-500" />
                              </div>
                            ))}
                          </div>
                          <div className="mt-4 flex items-center justify-between border-t border-sand pt-4">
                            <span className="text-sm text-stone-500">
                              {o.payment_method} {o.shipping_cost > 0 && <><span> · شحن </span><Currency value={o.shipping_cost} /></>}
                              {o.discount > 0 && <><span> · خصم </span><Currency value={o.discount} /></>}
                            </span>
                            <Currency value={o.total} className="font-bold text-gold-dark" />
                          </div>
                        </article>
                      );
                    })}
                  </div>

                  {/* Desktop table */}
                  <div className="mt-4 hidden lg:block rounded-3xl border border-sand bg-white overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm min-w-[760px]">
                        <thead>
                          <tr className="bg-cream border-b border-sand text-right text-xs text-stone-500">
                            <th className="px-5 py-3.5 font-bold">الطلب</th>
                            <th className="px-5 py-3.5 font-bold">المنتجات</th>
                            <th className="px-5 py-3.5 font-bold">التاريخ</th>
                            <th className="px-5 py-3.5 font-bold">الدفع</th>
                            <th className="px-5 py-3.5 font-bold">الإجمالي</th>
                            <th className="px-5 py-3.5 font-bold">الحالة</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-sand/60">
                          {orders.map((o) => {
                            const st = STATUS[o.status] || STATUS.pending;
                            return (
                              <tr key={o.id} className="hover:bg-cream/60 transition">
                                <td className="px-5 py-4 align-top">
                                  <p className="font-bold text-ink">#{o.order_number}</p>
                                </td>
                                <td className="px-5 py-4 align-top">
                                  <div className="max-w-[260px] space-y-0.5">
                                    {(o.items || []).slice(0, 3).map((item, i) => (
                                      <p key={i} className="truncate text-xs text-stone-500">{item.name} × {item.qty}</p>
                                    ))}
                                    {(o.items || []).length > 3 && <p className="text-xs text-stone-400">+{(o.items || []).length - 3} {pluralizeArabic((o.items || []).length - 3, "منتج", "منتجين", "منتجات")}</p>}
                                  </div>
                                </td>
                                <td className="px-5 py-4 align-top">
                                  <p className="whitespace-nowrap text-xs text-stone-500 text-right" dir="ltr">{formatDate(o.created_at)}</p>
                                </td>
                                <td className="px-5 py-4 align-top">
                                  <p className="text-xs text-stone-600">{o.payment_method || "—"}</p>
                                  {o.shipping_cost > 0 && <p className="mt-0.5 text-[11px] text-stone-400">شحن: <Currency value={o.shipping_cost} /></p>}
                                  {o.discount > 0 && <p className="text-[11px] text-emerald-600">خصم: -<Currency value={o.discount} /></p>}
                                </td>
                                <td className="px-5 py-4 align-top">
                                  <Currency value={o.total} className="whitespace-nowrap text-base font-bold text-gold-dark" />
                                </td>
                                <td className="px-5 py-4 align-top">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold ${st.cls}`}>{st.label}</span>
                                    {o.tracking_url && (
                                      <a href={o.tracking_url} target="_blank" rel="noreferrer" className="text-xs font-bold text-gold hover:underline">
                                        تتبع
                                      </a>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
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
                {(returns || []).map((request: any) => (
                  <div key={request.id} className="rounded-2xl bg-stone-50 p-4 text-sm">
                    <div className="flex justify-between font-bold"><span>طلب #{request.order_id.slice(0, 8)}</span><span className="text-gold-dark">{request.status}</span></div>
                    <p className="mt-1 text-stone-500">{request.reason} {request.details && `— ${request.details}`}</p>
                    {request.admin_note && <p className="mt-1 text-xs text-stone-400">ملاحظة: {request.admin_note}</p>}
                    <p className="mt-1 text-xs text-stone-400 text-right" dir="ltr">{formatDate(request.created_at)}</p>
                  </div>
                ))}
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

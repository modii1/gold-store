import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Package, LogOut, Heart, ShoppingBag, Phone, MapPin, ExternalLink, RotateCcw } from "lucide-react";
import { StoreHeader } from "@/components/storefront/header";
import { StoreFooter } from "@/components/storefront/footer";
import { getCustomerSession } from "@/lib/auth";
import { customerLogoutAction } from "@/app/actions/logout";
import { getOrdersByPhoneAction } from "@/app/actions/orders";
import { getSettings } from "@/lib/services/settings";
import { getCategoriesList } from "@/lib/services/products";
import { formatCurrency } from "@/lib/format";
import { Currency } from "@/components/storefront/currency";
import { createAdminClient } from "@/lib/supabase/admin";
import { createReturnRequestAction, saveCustomerAddressAction } from "@/app/actions/customer-data";

export const metadata: Metadata = { title: "حسابي | لمعة" };

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "قيد المراجعة", cls: "bg-amber-50 text-amber-700" },
  confirmed: { label: "مؤكد", cls: "bg-sky-50 text-sky-700" },
  processing: { label: "قيد التجهيز", cls: "bg-indigo-50 text-indigo-700" },
  shipped: { label: "تم الشحن", cls: "bg-blue-50 text-blue-700" },
  delivered: { label: "تم التسليم", cls: "bg-teal-50 text-teal-700" },
  paid: { label: "مدفوع", cls: "bg-emerald-50 text-emerald-700" },
  cancelled: { label: "ملغي", cls: "bg-red-50 text-red-600" },
};

export default async function AccountPage() {
  const session = await getCustomerSession();
  if (!session) redirect("/login");

  const [settings, categories, orders] = await Promise.all([
    getSettings(),
    getCategoriesList(),
    getOrdersByPhoneAction(session.phone),
  ]);
  const admin = createAdminClient();
  const [{ data: addresses }, { data: returns }] = await Promise.all([
    admin.from("addresses").select("*").eq("customer_identifier", session.phone).order("is_default", { ascending: false }).order("created_at", { ascending: false }),
    admin.from("return_requests").select("id,order_id,reason,details,status,admin_note,created_at").eq("customer_identifier", session.phone).order("created_at", { ascending: false }),
  ]);

  return (
    <>
      <StoreHeader settings={settings} categories={categories} />
      <main className="flex-1 mx-auto max-w-5xl px-4 md:px-6 py-8">
        <h1 className="text-2xl md:text-3xl font-bold text-ink">أهلاً {session.name.split(" ")[0]} 👋</h1>
        <p className="mt-1 text-sm text-stone-500">إدارة حسابك ومتابعة طلباتك</p>

        {/* Profile card */}
        <section className="mt-6 rounded-3xl border border-sand bg-white p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-gold to-gold-dark text-xl font-bold text-white">
                {session.name.charAt(0)}
              </span>
              <div>
                <p className="font-bold text-ink">{session.name}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-sm text-stone-500" dir="ltr">
                  <Phone className="h-3.5 w-3.5 text-gold" /> {session.phone}
                </p>
              </div>
            </div>
            <form action={customerLogoutAction}>
              <button type="submit" className="flex items-center gap-2 rounded-full border border-sand px-5 py-2.5 text-sm font-bold text-stone-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 transition">
                <LogOut className="h-4 w-4" /> تسجيل الخروج
              </button>
            </form>
          </div>
          <div className="mt-5 flex flex-wrap gap-3 border-t border-sand pt-5">
            <Link href="/favorites" className="flex items-center gap-2 rounded-full bg-cream px-5 py-2.5 text-sm font-bold text-ink hover:bg-sand transition">
              <Heart className="h-4 w-4 text-gold" /> المفضلة
            </Link>
            <Link href="/shop" className="flex items-center gap-2 rounded-full bg-cream px-5 py-2.5 text-sm font-bold text-ink hover:bg-sand transition">
              <ShoppingBag className="h-4 w-4 text-gold" /> متابعة التسوق
            </Link>
          </div>
        </section>

        <section className="mt-8 rounded-3xl border border-sand bg-white p-6">
          <h2 className="flex items-center gap-2 text-lg font-bold text-ink"><MapPin className="h-5 w-5 text-gold" /> عناويني المحفوظة</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {(addresses || []).map((address: any) => (
              <article key={address.id} className="rounded-2xl border border-sand p-4">
                <div className="flex items-center justify-between"><b>{address.label || "عنواني"}</b>{address.is_default && <span className="text-xs font-bold text-emerald-700">الافتراضي</span>}</div>
                <p className="mt-2 text-sm text-stone-500">{[address.address, address.city, address.region].filter(Boolean).join("، ") || "موقع محدد بالخريطة"}</p>
                {address.maps_url && <a href={address.maps_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-gold">فتح الخريطة <ExternalLink className="h-3 w-3" /></a>}
              </article>
            ))}
            <form action={async (formData) => { await saveCustomerAddressAction(formData); }} className="rounded-2xl border border-dashed border-gold/50 bg-amber-50/40 p-4 space-y-2">
              <input type="hidden" name="phone" value={session.phone} />
              <input name="label" placeholder="اسم العنوان: المنزل" className="input-lux" />
              <input name="city" placeholder="المدينة" className="input-lux" />
              <input name="address" placeholder="وصف العنوان" className="input-lux" />
              <input name="latitude" placeholder="خط العرض" className="input-lux" required />
              <input name="longitude" placeholder="خط الطول" className="input-lux" required />
              <button className="w-full rounded-xl bg-ink py-2.5 text-sm font-bold text-white">حفظ عنوان بإحداثيات الموقع</button>
            </form>
          </div>
        </section>

        {/* Orders */}
        <section className="mt-8">
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
            <div className="mt-4 space-y-4">
              {orders.map((o) => {
                const st = STATUS[o.status] || STATUS.pending;
                return (
                  <article key={o.id} className="rounded-3xl border border-sand bg-white p-5 md:p-6">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-bold text-ink">طلب #{o.order_number}</p>
                        <p className="mt-0.5 text-xs text-stone-400" dir="ltr">{new Date(o.created_at).toLocaleDateString("en-GB")}</p>
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
          )}
        </section>

        <section className="mt-8 rounded-3xl border border-sand bg-white p-6">
          <h2 className="flex items-center gap-2 text-lg font-bold text-ink"><RotateCcw className="h-5 w-5 text-gold" /> طلبات الاسترجاع</h2>
          <div className="mt-4 space-y-3">
            {(returns || []).map((request: any) => <div key={request.id} className="rounded-2xl bg-stone-50 p-4 text-sm"><div className="flex justify-between font-bold"><span>طلب #{request.order_id.slice(0, 8)}</span><span>{request.status}</span></div><p className="mt-1 text-stone-500">{request.reason} {request.details && `— ${request.details}`}</p></div>)}
          </div>
          {orders.filter((o) => ["delivered", "paid"].includes(o.status)).map((order) => <form key={order.id} action={async (formData) => { await createReturnRequestAction(formData); }} className="mt-3 flex flex-wrap items-center gap-2"><input type="hidden" name="order_id" value={order.id} /><span className="text-sm">طلب #{order.order_number}</span><select name="reason" className="rounded-xl border border-sand px-3 py-2 text-sm"><option>استرجاع المنتج</option><option>منتج تالف</option><option>منتج غير مطابق</option></select><button className="rounded-xl bg-ink px-3 py-2 text-xs font-bold text-white">طلب استرجاع</button></form>)}
        </section>
      </main>
      <StoreFooter settings={settings} />
    </>
  );
}

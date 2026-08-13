"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Tag, ShoppingBag, ShieldCheck, Truck, Landmark, Sparkles } from "lucide-react";
import { useCart } from "@/components/storefront/providers";
import { createOrderAction, validateCouponAction } from "@/app/actions/orders";
import { getCheckoutRatesAction, type CheckoutShippingOption } from "@/app/actions/shipping";
import { Currency } from "@/components/storefront/currency";
import { cn } from "@/lib/utils";
import type { Settings, Carrier, PaymentMethod } from "@/types";

export function CheckoutForm({ settings, shipping, payment }: { settings: Settings; shipping: Carrier[]; payment: PaymentMethod[] }) {
  const { items, subtotal, clearCart } = useCart();
  const router = useRouter();
  const [city, setCity] = useState("");
  const [liveOptions, setLiveOptions] = useState<CheckoutShippingOption[] | null>(null);
  const [ratesLoading, setRatesLoading] = useState(false);
  const [shippingId, setShippingId] = useState<string>(shipping[0]?.id || "");
  const [paymentName, setPaymentName] = useState<string>(payment[0]?.name || "");
  const [coupon, setCoupon] = useState("");
  const [applied, setApplied] = useState<{ code: string; amount: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const estWeightKg = useMemo(() => {
    const grams = items.reduce((s, i) => s + (i as any).weight_grams || 500, 0);
    return Math.max(0.5, grams / 1000);
  }, [items]);

  const fetchRates = useCallback(async (c: string) => {
    if (!c.trim()) { setLiveOptions(null); setRatesLoading(false); return; }
    setRatesLoading(true);
    try {
      const res = await getCheckoutRatesAction(c.trim(), estWeightKg, 0);
      setLiveOptions(res);
      if (res.length && !res.some((o) => o.ref === shippingId)) setShippingId(res[0].ref);
    } finally {
      setRatesLoading(false);
    }
  }, [estWeightKg, shippingId]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchRates(city), 600);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [city, fetchRates]);

  if (items.length === 0) {
    return (
      <div className="mt-8 rounded-2xl border border-sand bg-white p-16 text-center">
        <ShoppingBag className="w-12 h-12 mx-auto mb-3 text-gold/40" />
        <p className="text-stone-500">سلتك فارغة — أضيفي منتجات أولاً</p>
      </div>
    );
  }

  const options: CheckoutShippingOption[] = liveOptions && liveOptions.length ? liveOptions : shipping.map((s) => ({
    carrierId: s.id, carrierCode: s.code, ref: s.id, name: s.name, cost: s.cost,
    estimatedDays: s.estimated_days, freeAbove: s.free_above, live: false, logo: s.logo_url || undefined,
  }));
  const selectedShip = options.find((o) => o.ref === shippingId);
  const shipCost = selectedShip && selectedShip.freeAbove && subtotal >= selectedShip.freeAbove ? 0 : selectedShip?.cost || 0;
  const discount = applied?.amount || 0;
  const total = subtotal + shipCost - discount;

  const applyCoupon = async () => {
    const res = await validateCouponAction(coupon, subtotal);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    const amount = res.type === "percent" ? (subtotal * res.value) / 100 : res.value;
    setApplied({ code: res.code, amount: Math.min(amount, subtotal) });
    setError("");
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const formData = new FormData(e.currentTarget);
    formData.set("items", JSON.stringify(items));
    formData.set("subtotal", String(subtotal));
    formData.set("shipping_cost", String(shipCost));
    formData.set("discount", String(discount));
    formData.set("weight_kg", String(estWeightKg));
    if (applied) formData.set("coupon_code", applied.code);

    const res = (await createOrderAction(formData)) as { error?: string; success?: boolean; orderNumber?: number };
    setLoading(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    clearCart();
    const phone = String(formData.get("phone") || "");
    router.push(`/order-success?num=${res.orderNumber ?? ""}&phone=${encodeURIComponent(phone)}`);
  };

  return (
    <form onSubmit={handleSubmit} className="mt-8 grid gap-8 lg:grid-cols-5">
      {/* بيانات الشحن */}
      <div className="lg:col-span-3 space-y-6">
        <section className="rounded-2xl border border-sand bg-white p-5 md:p-6">
          <h2 className="flex items-center gap-2 font-bold text-ink mb-4"><Truck className="w-5 h-5 text-gold" /> بيانات الشحن</h2>
          <div className="grid grid-cols-2 gap-3">
            <input name="name" required placeholder="الاسم الكامل *" className="col-span-2 input-lux" />
            <input name="phone" required type="tel" placeholder="رقم الجوال *" className="col-span-2 input-lux" dir="ltr" />
            <input name="email" type="email" placeholder="البريد الإلكتروني (اختياري)" className="col-span-2 input-lux" dir="ltr" />
            <input name="city" placeholder="المدينة" value={city} onChange={(e) => setCity(e.target.value)} className="input-lux" />
            <input name="region" placeholder="المنطقة" className="input-lux" />
            <input name="address" required placeholder="العنوان *" className="col-span-2 input-lux" />
            <input name="national_address" placeholder="العنوان الوطني (اختياري)" className="col-span-2 input-lux" dir="ltr" />
            <textarea name="notes" rows={2} placeholder="ملاحظات الطلب (اختياري)" className="col-span-2 input-lux resize-y" />
          </div>
        </section>

        {/* طريقة الشحن */}
        <section className="rounded-2xl border border-sand bg-white p-5 md:p-6">
          <h2 className="flex items-center gap-2 font-bold text-ink mb-4"><Truck className="w-5 h-5 text-gold" /> طريقة الشحن</h2>
          {!city.trim() ? (
            <p className="text-sm text-stone-400 bg-cream/60 rounded-xl p-3">أدخلي المدينة أعلاه لعرض خيارات الشحن والأسعار</p>
          ) : ratesLoading ? (
            <p className="flex items-center gap-2 text-sm text-stone-500"><Loader2 className="w-4 h-4 animate-spin" /> جارٍ جلب الأسعار الحية...</p>
          ) : (
            <div className="space-y-2">
              {options.map((s) => {
                const free = s.freeAbove && subtotal >= s.freeAbove;
                return (
                  <label key={s.ref} className={cn("flex items-center justify-between rounded-xl border p-4 cursor-pointer transition", shippingId === s.ref ? "border-gold bg-cream/50" : "border-sand hover:border-gold/40")}>
                    <div className="flex items-center gap-3">
                      <input type="radio" name="shipping_method" value={s.ref} checked={shippingId === s.ref} onChange={() => setShippingId(s.ref)} className="accent-gold" />
                      {s.logo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={s.logo} alt={s.name} className="h-8 w-8 rounded-lg object-contain" />
                      ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-gold"><Truck className="w-4 h-4" /></div>
                      )}
                      <div>
                        <p className="font-bold text-ink text-sm">{s.name}</p>
                        {s.estimatedDays && <p className="text-xs text-stone-400">{s.estimatedDays}</p>}
                      </div>
                    </div>
                    <span className="font-bold text-gold text-sm">{free ? "مجاني" : <Currency value={s.cost} />}</span>
                  </label>
                );
              })}
            </div>
          )}
          {liveOptions && liveOptions.some((o) => o.live) && (
            <p className="mt-3 flex items-center gap-1 text-xs text-stone-400">
              <Sparkles className="w-3.5 h-3.5 text-gold" /> أسعار حية من OTO — تُحسب حسب المدينة والوزن
            </p>
          )}
        </section>

        {/* طريقة الدفع */}
        <section className="rounded-2xl border border-sand bg-white p-5 md:p-6">
          <h2 className="flex items-center gap-2 font-bold text-ink mb-4"><Landmark className="w-5 h-5 text-gold" /> طريقة الدفع</h2>
          <div className="space-y-2">
            {payment.map((p) => (
              <label key={p.id} className={cn("flex items-center justify-between rounded-xl border p-4 cursor-pointer transition", paymentName === p.name ? "border-gold bg-cream/50" : "border-sand hover:border-gold/40")}>
                <div className="flex items-center gap-3">
                  <input type="radio" name="payment_method" value={p.name} checked={paymentName === p.name} onChange={() => setPaymentName(p.name)} className="accent-gold" />
                  <div>
                    <p className="font-bold text-ink text-sm">{p.name}</p>
                    {p.description && <p className="text-xs text-stone-400">{p.description}</p>}
                  </div>
                </div>
              </label>
            ))}
          </div>
          {settings.payment_instructions && (
            <p className="mt-4 text-xs text-stone-500 leading-relaxed bg-cream/60 rounded-xl p-3 whitespace-pre-line">{settings.payment_instructions}</p>
          )}
        </section>
      </div>

      {/* ملخص الطلب */}
      <aside className="lg:col-span-2">
        <div className="sticky top-24 space-y-4 rounded-2xl border border-sand bg-white p-5 md:p-6">
          <h2 className="flex items-center gap-2 font-bold text-ink"><ShieldCheck className="w-5 h-5 text-gold" /> ملخص الطلب</h2>

          <div className="max-h-64 overflow-y-auto space-y-3">
            {items.map((item) => (
              <div key={item.product_id} className="flex items-center gap-3">
                {item.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.image} alt="" className="h-14 w-14 rounded-lg object-cover" />
                ) : (
                  <div className="h-14 w-14 rounded-lg bg-sand/50" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-ink line-clamp-1">{item.name}</p>
                  <p className="text-xs text-stone-400">{item.qty} × <Currency value={item.price} /></p>
                </div>
                <Currency value={item.price * item.qty} className="text-xs font-bold" />
              </div>
            ))}
          </div>

          {/* Coupon */}
          {!applied ? (
            <div className="flex gap-2">
              <input value={coupon} onChange={(e) => setCoupon(e.target.value)} placeholder="كود الخصم"
                className="flex-1 input-lux" dir="ltr" />
              <button type="button" onClick={applyCoupon} className="flex items-center gap-1 rounded-xl bg-cream px-4 text-sm font-bold text-gold-dark hover:bg-sand transition">
                <Tag className="w-4 h-4" /> تطبيق
              </button>
            </div>
          ) : (
            <p className="flex items-center justify-between rounded-xl bg-emerald-50 text-emerald-700 px-3 py-2 text-sm font-bold">
              <span>كود {applied.code} ✓</span>
              <span className="inline-flex items-center gap-1">-<Currency value={applied.amount} /></span>
            </p>
          )}

          <div className="space-y-2 border-t border-sand pt-4 text-sm">
            <div className="flex justify-between text-stone-500">
              <span>المجموع الفرعي</span><Currency value={subtotal} className="font-bold text-ink" />
            </div>
            <div className="flex justify-between text-stone-500">
              <span>الشحن</span>
              <span className="font-bold text-ink">{shipCost === 0 && subtotal > 0 ? "مجاني" : <Currency value={shipCost} />}</span>
            </div>
            {discount > 0 && (
              <div className="flex justify-between text-emerald-600">
                <span>الخصم</span><span className="inline-flex items-center gap-1 font-bold">-<Currency value={discount} /></span>
              </div>
            )}
            <div className="flex justify-between border-t border-sand pt-3">
              <span className="font-bold text-ink">الإجمالي</span>
              <Currency value={Math.max(0, total)} className="font-bold text-gold-dark text-xl" />
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button type="submit" disabled={loading}
            className="w-full rounded-full bg-ink py-3.5 font-bold text-ivory hover:bg-gold transition disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingBag className="w-4 h-4" />}
            تأكيد الطلب
          </button>
        </div>
      </aside>
    </form>
  );
}

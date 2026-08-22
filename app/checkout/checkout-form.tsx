"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Tag, ShoppingBag, ShieldCheck, Truck, Landmark, MapPin, CheckCircle2 } from "lucide-react";
import { useCart } from "@/components/storefront/providers";
import { createOrderAction, validateCouponAction } from "@/app/actions/orders";
import { getCheckoutRatesAction, reverseGeocodeAction, type CheckoutShippingOption } from "@/app/actions/shipping";
import { Currency } from "@/components/storefront/currency";
import { cn } from "@/lib/utils";
import type { Settings, Carrier, PaymentMethod } from "@/types";

type SavedAddress = { id: string; label: string | null; city: string | null; region: string | null; address: string | null; national_address: string | null; latitude: number | null; longitude: number | null; maps_url: string | null; is_default: boolean };

export function CheckoutForm({ settings, shipping, payment, customer, savedAddresses }: { settings: Settings; shipping: Carrier[]; payment: PaymentMethod[]; customer: { name: string; phone: string } | null; savedAddresses: SavedAddress[] }) {
  const { items, subtotal, clearCart } = useCart();
  const router = useRouter();
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [nationalAddress, setNationalAddress] = useState("");
  const [addressText, setAddressText] = useState("");
  const [liveOptions, setLiveOptions] = useState<CheckoutShippingOption[] | null>(null);
  const [ratesLoading, setRatesLoading] = useState(false);
  const [shippingId, setShippingId] = useState<string>(shipping[0]?.id || "");
  const [paymentName, setPaymentName] = useState<string>(payment[0]?.name || "");
  const [coupon, setCoupon] = useState("");
  const [applied, setApplied] = useState<{ code: string; amount: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationReady, setLocationReady] = useState(false);
  const [manualLocation, setManualLocation] = useState(false);
  const [resolvedAddress, setResolvedAddress] = useState("");
  const [coordinates, setCoordinates] = useState({ latitude: "", longitude: "" });
  const [selectedAddress, setSelectedAddress] = useState(savedAddresses[0]?.id || "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submittingRef = useRef(false);

  useEffect(() => {
    const address = savedAddresses[0];
    if (!address) return;
    setCity(address.city || "");
    setRegion(address.region || "");
    setNationalAddress(address.national_address || "");
    setAddressText(address.address || "");
    setResolvedAddress(address.address || "");
    setCoordinates({ latitude: address.latitude ? String(address.latitude) : "", longitude: address.longitude ? String(address.longitude) : "" });
    setLocationReady(Boolean(address.latitude && address.longitude));
    setManualLocation(!address.latitude || !address.longitude);
  }, [savedAddresses]);

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

  const useCurrentLocation = () => {
    if (!navigator.geolocation) { setManualLocation(true); setError("المتصفح لا يدعم تحديد الموقع، يمكنك إدخال العنوان يدوياً"); return; }
    setLocationLoading(true);
    navigator.geolocation.getCurrentPosition((position) => {
      const latitude = position.coords.latitude.toFixed(7);
      const longitude = position.coords.longitude.toFixed(7);
      setCoordinates({ latitude, longitude });
      reverseGeocodeAction(latitude, longitude).then((result) => {
        if ("error" in result) {
          setManualLocation(true);
          setError("تم تحديد الموقع لكن تعذر قراءة العنوان، يمكنك إدخاله يدوياً");
        } else {
          setLocationReady(true);
          setManualLocation(false);
           setCity(result.city);
           setResolvedAddress(result.address);
           setAddressText(result.address);
          setError("");
        }
        setLocationLoading(false);
      });
    }, () => { setManualLocation(true); setError("لم يتم تفعيل الموقع، يمكنك إدخال العنوان يدوياً"); setLocationLoading(false); }, { enableHighAccuracy: true, timeout: 12000 });
  };

  const chooseAddress = (id: string) => {
    setSelectedAddress(id);
    if (!id) { setManualLocation(false); setLocationReady(false); setCoordinates({ latitude: "", longitude: "" }); setResolvedAddress(""); setAddressText(""); setCity(""); setRegion(""); setNationalAddress(""); return; }
    const address = savedAddresses.find((item) => item.id === id);
    if (!address) return;
    setCity(address.city || "");
    setRegion(address.region || "");
    setNationalAddress(address.national_address || "");
    setAddressText(address.address || "");
    setResolvedAddress(address.address || "");
    setCoordinates({ latitude: address.latitude ? String(address.latitude) : "", longitude: address.longitude ? String(address.longitude) : "" });
    setLocationReady(Boolean(address.latitude && address.longitude));
    setManualLocation(!address.latitude || !address.longitude);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    setError("");
    const formData = new FormData(e.currentTarget);
    formData.set("items", JSON.stringify(items));
    formData.set("subtotal", String(subtotal));
    formData.set("shipping_cost", String(shipCost));
    formData.set("discount", String(discount));
    formData.set("weight_kg", String(estWeightKg));
    if (applied) formData.set("coupon_code", applied.code);

    try {
      const res = (await createOrderAction(formData)) as { error?: string; success?: boolean; orderNumber?: number };
      if (res.error) {
        setError(res.error);
        return;
      }
      clearCart();
      const phone = String(formData.get("phone") || "");
      router.push(`/order-success?num=${res.orderNumber ?? ""}&phone=${encodeURIComponent(phone)}`);
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mt-8 grid gap-8 lg:grid-cols-5">
      {/* بيانات الشحن */}
      <div className="lg:col-span-3 space-y-6">
        <section className="rounded-2xl border border-sand bg-white p-5 md:p-6">
          <h2 className="flex items-center gap-2 font-bold text-ink mb-4"><Truck className="w-5 h-5 text-gold" /> بيانات الشحن</h2>
          <div className="grid grid-cols-2 gap-3">
            <input name="name" required placeholder="الاسم الكامل *" defaultValue={customer?.name || ""} className="col-span-2 input-lux" />
            <input name="phone" required type="tel" placeholder="رقم الجوال *" defaultValue={customer?.phone || ""} className="col-span-2 input-lux" dir="ltr" />
            <input name="email" type="email" placeholder="البريد الإلكتروني (اختياري)" className="col-span-2 input-lux" dir="ltr" />
            {customer && savedAddresses.length > 0 && <div className="col-span-2 rounded-2xl border border-gold/30 bg-amber-50/40 p-3"><label className="mb-2 block text-sm font-bold text-stone-700">اختاري عنواناً محفوظاً</label><select value={selectedAddress} onChange={(e) => chooseAddress(e.target.value)} className="input-lux"><option value="">استخدام موقع جديد</option>{savedAddresses.map((address) => <option key={address.id} value={address.id}>{address.label || "عنوان محفوظ"} — {[address.city, address.address].filter(Boolean).join("، ")}</option>)}</select></div>}
            {manualLocation ? (
              <>
                <input name="city" placeholder="المدينة" value={city} onChange={(e) => setCity(e.target.value)} className="input-lux" />
                <input name="region" placeholder="المنطقة" value={region} onChange={(e) => setRegion(e.target.value)} className="input-lux" />
                <input name="address" required placeholder="العنوان *" value={addressText} onChange={(e) => setAddressText(e.target.value)} className="col-span-2 input-lux" />
                <input name="national_address" placeholder="العنوان الوطني (اختياري)" value={nationalAddress} onChange={(e) => setNationalAddress(e.target.value)} className="col-span-2 input-lux" dir="ltr" />
              </>
            ) : (
              <>
                <input type="hidden" name="city" value={city} />
                <input type="hidden" name="region" value={region} />
                <input type="hidden" name="address" value={addressText || resolvedAddress} />
                <input type="hidden" name="national_address" value={nationalAddress} />
              </>
            )}
            <input type="hidden" name="latitude" value={coordinates.latitude} />
            <input type="hidden" name="longitude" value={coordinates.longitude} />
            <input type="hidden" name="maps_url" value={coordinates.latitude && coordinates.longitude ? `https://maps.google.com/?q=${coordinates.latitude},${coordinates.longitude}` : ""} />
            <button type="button" onClick={useCurrentLocation} className={cn("col-span-2 flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold transition", locationReady ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-gold/40 bg-amber-50 text-gold-dark hover:bg-amber-100")}>
              {locationLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : locationReady ? <CheckCircle2 className="h-4 w-4" /> : <MapPin className="h-4 w-4" />}
              {locationLoading ? "جار تحديد موقعك..." : locationReady ? "تم تحديد الموقع — اضغطي للتغيير" : "تحديد عنواني من موقعي الحالي"}
            </button>
            {manualLocation && <button type="button" onClick={useCurrentLocation} className="col-span-2 text-xs font-bold text-gold underline">محاولة تحديد الموقع مرة أخرى</button>}
            {locationReady && <p className="col-span-2 rounded-xl bg-emerald-50 p-3 text-xs font-semibold text-emerald-700">تم تعبئة العنوان تلقائياً: {resolvedAddress}</p>}
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

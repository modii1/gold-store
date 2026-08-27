"use client";

import { useRouter } from "next/navigation";
import { X, Plus, Minus, Trash2, ShoppingBag } from "lucide-react";
import { useCart } from "./providers";
import { formatCurrency } from "@/lib/format";
import { Currency } from "@/components/storefront/currency";
import type { Settings } from "@/types";

export function CartDrawer({ settings }: { settings: Settings }) {
  const { items, isOpen, closeCart, subtotal, updateQty, removeFromCart } = useCart();
  const router = useRouter();

  const shipping = subtotal >= (settings.free_shipping_threshold || 0) || subtotal === 0 ? 0 : settings.shipping_fee;
  const total = subtotal + shipping;

  if (!isOpen) return null;

  const checkout = () => {
    closeCart();
    router.push("/checkout");
  };

  return (
    <div className="fixed inset-0 z-[90]">
      <div className="absolute inset-0 bg-ink/50 fade-in" onClick={closeCart} />
      <aside className="absolute inset-y-0 start-0 w-full max-w-md bg-ivory shadow-2xl flex flex-col drawer-in">
        <header className="flex items-center justify-between border-b border-sand bg-white px-5 py-4">
          <h2 className="font-bold text-lg text-ink flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-gold" /> سلة التسوق
            {items.length > 0 && <span className="text-sm text-stone-400 font-normal">({items.length})</span>}
          </h2>
          <button onClick={closeCart} className="text-stone-400 hover:text-ink transition">
            <X className="w-6 h-6" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {items.length === 0 ? (
            <div className="text-center py-16 text-stone-400">
              <ShoppingBag className="w-12 h-12 mx-auto mb-3 text-gold/40" />
              <p className="text-sm">سلتك فارغة حالياً</p>
            </div>
          ) : (
            items.map((item) => (
              <article key={`${item.product_id}-${item.color || ""}`} className="flex gap-3 rounded-xl bg-white border border-sand p-3">
                {item.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.image} alt={item.name} loading="lazy" className="h-20 w-20 rounded-lg object-cover" />
                ) : (
                  <div className="h-20 w-20 rounded-lg bg-sand/50" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-ink line-clamp-2">{item.name}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {item.color && <span className="inline-flex items-center gap-1 rounded-full bg-cream px-2 py-0.5 text-[11px] font-bold text-stone-600 border border-sand">اللون: {item.color}</span>}
                    {item.size && <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-stone-600 border border-sand">المقاس: {item.size}</span>}
                    {item.sku && <span className="inline-flex items-center gap-1 rounded-full bg-stone-50 px-2 py-0.5 text-[10px] text-stone-400" dir="ltr">{item.sku}</span>}
                  </div>
                  <Currency value={item.price} className="mt-1 text-sm font-bold text-gold" />
                  <div className="mt-2 flex items-center gap-2">
                    <button onClick={() => updateQty(item.product_id, item.qty - 1, item.color, item.size, item.variant_id)} className="h-7 w-7 rounded-md border border-sand flex items-center justify-center text-stone-500 hover:border-gold hover:text-gold transition">
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="w-7 text-center text-sm font-bold">{item.qty}</span>
                    <button onClick={() => updateQty(item.product_id, item.qty + 1, item.color, item.size, item.variant_id)} className="h-7 w-7 rounded-md border border-sand flex items-center justify-center text-stone-500 hover:border-gold hover:text-gold transition">
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => updateQty(item.product_id, 0, item.color, item.size, item.variant_id)} className="me-auto text-stone-300 hover:text-red-500 transition">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>

        {items.length > 0 && (
          <footer className="border-t border-sand bg-white px-5 py-4 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-stone-500">المجموع الفرعي</span>
              <Currency value={subtotal} className="font-bold" />
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-stone-500">الشحن</span>
              <span className="font-bold">{shipping === 0 && subtotal > 0 ? "مجاني" : <Currency value={shipping} />}</span>
            </div>
            <div className="flex justify-between border-t border-sand pt-3">
              <span className="font-bold text-ink">الإجمالي</span>
              <Currency value={total} className="font-bold text-gold text-lg" />
            </div>
            <button onClick={checkout} className="w-full rounded-full bg-ink py-3 font-bold text-ivory hover:bg-gold transition">
              إتمام الطلب
            </button>
          </footer>
        )}
      </aside>
    </div>
  );
}

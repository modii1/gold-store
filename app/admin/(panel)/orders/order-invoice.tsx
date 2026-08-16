"use client";

import { useEffect, useState } from "react";
import { X, Printer, Loader2 } from "lucide-react";
import { formatArabicDateTime, formatCurrency } from "@/lib/format";
import type { Order, Settings } from "@/types";

type Props = {
  orders: Order[];
  settings: Settings;
  onClose: () => void;
};

const printCss = `
@media print {
  body * { visibility: hidden !important; }
  #invoice-print, #invoice-print * { visibility: visible !important; }
  #invoice-print {
    position: fixed !important;
    inset: 0 !important;
    margin: 0 !important;
    padding: 24px !important;
    background: white !important;
    overflow: visible !important;
    box-shadow: none !important;
    border-radius: 0 !important;
    max-height: none !important;
    width: 100% !important;
    max-width: 100% !important;
  }
  @page { margin: 12mm; }
}
`;

export function InvoicePreview({ orders, settings, onClose }: Props) {
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const print = () => {
    setPrinting(true);
    setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 150);
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <style dangerouslySetInnerHTML={{ __html: printCss }} />
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div className="relative max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
        {/* Toolbar */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-stone-100 bg-white px-5 py-3">
          <h3 className="text-lg font-bold text-stone-900">
            الفاتورة {orders.length > 1 ? `(${orders.length} طلبات)` : `#${orders[0]?.order_number}`}
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={print}
              disabled={printing}
              className="flex items-center gap-1.5 rounded-lg bg-gold px-4 py-2 text-xs font-bold text-white hover:bg-gold-dark disabled:opacity-60"
            >
              {printing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
              طباعة
            </button>
            <button onClick={onClose} aria-label="إغلاق" className="rounded-lg p-2 text-stone-400 hover:bg-stone-100">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Printable content */}
        <div id="invoice-print" className="space-y-6 p-5 md:p-8">
          {orders.map((o) => (
            <Invoice key={o.id} order={o} settings={settings} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Invoice({ order, settings }: { order: Order; settings: Settings }) {
  const items = order.items || [];
  const subtotal = items.reduce((s, it) => s + (it.price || 0) * (it.qty || 1), 0);

  return (
    <div className="break-inside-avoid overflow-hidden rounded-2xl border border-stone-200">
      {/* Store header */}
      <div className="flex items-center justify-between gap-4 bg-cream px-6 py-5">
        <div className="flex items-center gap-3">
          {settings.store_logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={settings.store_logo} alt="" className="h-12 w-12 rounded-xl object-contain" />
          )}
          <div>
            <p className="text-lg font-extrabold text-stone-900">{settings.site_name || "لمعة"}</p>
            <p className="text-xs text-stone-500">فاتورة ضريبية مبسطة</p>
          </div>
        </div>
        <div className="text-left text-xs text-stone-500">
          {settings.phone && <p dir="ltr">{settings.phone}</p>}
          {settings.address && <p>{settings.address}</p>}
        </div>
      </div>

      {/* Meta */}
      <div className="grid grid-cols-2 gap-4 border-b border-stone-100 px-6 py-4 text-sm md:grid-cols-4">
        <div>
          <p className="text-xs text-stone-400">رقم الطلب</p>
          <p className="font-bold text-stone-900">#{order.order_number}</p>
        </div>
        <div>
          <p className="text-xs text-stone-400">التاريخ</p>
          <p className="font-bold text-stone-900">{formatArabicDateTime(order.created_at)}</p>
        </div>
        <div>
          <p className="text-xs text-stone-400">العميل</p>
          <p className="font-bold text-stone-900">{order.customer_name}</p>
        </div>
        <div>
          <p className="text-xs text-stone-400">الهاتف</p>
          <p className="font-bold text-stone-900" dir="ltr">{order.customer_phone}</p>
        </div>
      </div>

      {/* Items */}
      <table className="w-full border-b border-stone-100 text-sm">
        <thead>
          <tr className="bg-stone-50 text-right text-xs text-stone-500">
            <th className="px-6 py-2.5">المنتج</th>
            <th className="px-3 py-2.5">الكمية</th>
            <th className="px-3 py-2.5">السعر</th>
            <th className="px-6 py-2.5">الإجمالي</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {items.map((it, i) => (
            <tr key={i}>
              <td className="px-6 py-3">
                <p className="font-bold text-stone-800">{it.name}</p>
                {it.sku && <p className="text-xs text-stone-400">{it.sku}</p>}
              </td>
              <td className="px-3 py-3 text-stone-600">{it.qty}</td>
              <td className="px-3 py-3 text-stone-600">{formatCurrency(it.price)}</td>
              <td className="px-6 py-3 font-bold text-stone-800">{formatCurrency((it.price || 0) * (it.qty || 1))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      <div className="flex justify-end px-6 py-4">
        <div className="w-full max-w-[260px] space-y-1.5 text-sm">
          <div className="flex justify-between"><span className="text-stone-500">المجموع الفرعي</span><span>{formatCurrency(subtotal)}</span></div>
          {order.discount > 0 && (
            <div className="flex justify-between text-rose-500"><span>الخصم</span><span>-{formatCurrency(order.discount)}</span></div>
          )}
          <div className="flex justify-between"><span className="text-stone-500">الشحن</span><span>{formatCurrency(order.shipping_cost || 0)}</span></div>
          <div className="flex justify-between border-t border-stone-200 pt-2 text-base font-extrabold">
            <span>الإجمالي</span><span>{formatCurrency(order.total)}</span>
          </div>
          <p className="pt-1 text-xs text-stone-500">طريقة الدفع: {order.payment_method || "—"}</p>
          {order.tracking_number && (
            <p className="text-xs text-stone-500" dir="ltr">تتبع: {order.tracking_number}</p>
          )}
        </div>
      </div>

      {/* Footer */}
      {(settings.commercial_register || settings.tax_number) && (
        <div className="flex flex-wrap gap-4 border-t border-stone-100 bg-stone-50 px-6 py-3 text-xs text-stone-500">
          {settings.commercial_register && <span>سجل تجاري: {settings.commercial_register}</span>}
          {settings.tax_number && <span>الرقم الضريبي: {settings.tax_number}</span>}
        </div>
      )}
    </div>
  );
}

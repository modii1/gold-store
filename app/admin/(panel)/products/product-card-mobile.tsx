"use client";

import { useActionState } from "react";
import Link from "next/link";
import { deleteProductAction } from "@/app/actions/products";
import { Currency } from "@/components/storefront/currency";
import type { Product } from "@/types";

export function ProductCardMobile({ product }: { product: Product }) {
  const [, formAction] = useActionState(
    async (_prev: unknown, formData: FormData) => deleteProductAction(formData),
    null
  ) as [unknown, (fd: FormData) => void, boolean];
  const cover = product.images?.[0]?.url;

  return (
    <div className="rounded-2xl border border-amber-100 bg-white p-4 space-y-3">
      <div className="flex items-start gap-3">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" className="h-16 w-16 rounded-lg object-cover shrink-0" />
        ) : (
          <div className="h-16 w-16 rounded-lg bg-stone-100 flex items-center justify-center text-stone-300 text-xs shrink-0">لا صورة</div>
        )}
        <div className="flex-1 min-w-0">
          <p className="font-bold text-stone-900 truncate">{product.name}</p>
          {product.category && <p className="mt-0.5 text-xs text-stone-400">{product.category}</p>}
          <div className="mt-1 flex items-center gap-2">
            <Currency value={product.price} className="font-bold text-gold" />
            {product.sale_price ? <Currency value={product.sale_price} className="text-xs text-stone-400 line-through" /> : null}
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${product.is_available ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
          {product.is_available ? "متوفر" : "غير متوفر"}
        </span>
      </div>
      <div className="flex items-center justify-between pt-2 border-t border-stone-100">
        <span className="text-xs text-stone-400">
          {(product.images?.length || 0)} صور · {(product.videos?.length || 0)} فيديو
        </span>
        <div className="flex items-center gap-2">
          <Link href={`/admin/products/edit/${product.id}`} className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-bold text-gold hover:bg-amber-100 transition">
            تعديل
          </Link>
          <form action={formAction}>
            <input type="hidden" name="id" value={product.id} />
            <button type="submit" onClick={(e) => { if (!confirm("متأكد من الحذف؟")) e.preventDefault(); }} className="rounded-lg px-3 py-1.5 text-xs font-bold text-stone-500 hover:bg-rose-50 hover:text-rose-600 transition">
              حذف
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Pencil, Trash2, PlayCircle, Image as ImageIcon } from "lucide-react";
import { deleteProductAction } from "@/app/actions/products";
import { formatCurrency } from "@/lib/format";
import { Currency } from "@/components/storefront/currency";
import type { Product } from "@/types";

export function ProductRow({ product }: { product: Product }) {
  const [, formAction] = useActionState(
    async (_prev: unknown, formData: FormData) => deleteProductAction(formData),
    null
  ) as [unknown, (fd: FormData) => void, boolean];
  const cover = product.images?.[0]?.url;

  return (
    <tr className="hover:bg-stone-50/50 transition">
      <td className="p-4">
        <div className="flex items-center gap-3">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover} alt="" className="h-12 w-12 rounded-lg object-cover" />
          ) : (
            <div className="h-12 w-12 rounded-lg bg-stone-100 flex items-center justify-center text-stone-300 text-xs">لا صورة</div>
          )}
          <span className="font-semibold text-stone-800">{product.name}</span>
        </div>
      </td>
      <td className="p-4"><Currency value={product.price} className="font-bold text-gold" /></td>
      <td className="p-4 text-stone-500 hidden md:table-cell">{product.category || "-"}</td>
      <td className="p-4 text-stone-500 hidden md:table-cell">
        <span className="flex items-center gap-1.5">
          <ImageIcon className="w-4 h-4 text-stone-400" /> {product.images?.length || 0}
          <PlayCircle className="w-4 h-4 text-gold ml-1" /> {product.videos?.length || 0}
        </span>
      </td>
      <td className="p-4">
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${product.is_available ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
          {product.is_available ? "متوفر" : "غير متوفر"}
        </span>
      </td>
      <td className="p-4">
        <div className="flex items-center gap-2">
          <Link
            href={`/admin/products/edit/${product.id}`}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-stone-500 hover:bg-amber-50 hover:text-gold transition"
            title="تعديل"
          >
            <Pencil className="w-4 h-4" />
          </Link>
          <form action={formAction}>
            <input type="hidden" name="id" value={product.id} />
            <button
              type="submit"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-stone-500 hover:bg-rose-50 hover:text-rose-600 transition"
              title="حذف"
              onClick={(e) => { if (!confirm("متأكد من الحذف؟")) e.preventDefault(); }}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </form>
        </div>
      </td>
    </tr>
  );
}

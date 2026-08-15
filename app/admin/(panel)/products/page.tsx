import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ProductRow } from "./product-row";
import { ProductCardMobile } from "./product-card-mobile";
import { ImportCsvForm } from "./import-csv-form";
import type { Product } from "@/types";

export default async function AdminProductsPage() {
  const supabase = await createClient();
  const { data: products } = await supabase
    .from("products")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">المنتجات</h1>
          <p className="mt-1 text-sm text-stone-500">إدارة المنتجات والصور والفيديوهات</p>
        </div>
        <Link
          href="/admin/products/new"
          className="flex items-center justify-center gap-2 rounded-xl bg-gold px-4 py-2.5 text-sm font-bold text-white hover:bg-gold-light transition"
        >
          <Plus className="w-4 h-4" /> إضافة منتج
        </Link>
      </div>

      {(products ?? []).length === 0 ? (
        <div className="rounded-2xl border border-amber-100 bg-white p-12 text-center text-stone-400">
          لا توجد منتجات — أضف أول منتج
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto rounded-2xl border border-amber-100 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-100 text-end text-stone-500">
                  <th className="p-4 font-semibold">المنتج</th>
                  <th className="p-4 font-semibold">السعر</th>
                  <th className="p-4 font-semibold">الفئة</th>
                  <th className="p-4 font-semibold">وسائط</th>
                  <th className="p-4 font-semibold">الحالة</th>
                  <th className="p-4 font-semibold">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-50">
                {(products ?? []).map((p: Product) => (
                  <ProductRow key={p.id} product={p} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {(products ?? []).map((p: Product) => (
              <ProductCardMobile key={p.id} product={p} />
            ))}
          </div>
        </>
      )}

      <ImportCsvForm />
    </div>
  );
}

import { notFound, redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ProductForm } from "@/components/admin/product-form";
import type { Product } from "@/types";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await getAdminSession())) redirect("/admin");
  const { id } = await params;

  const supabase = await createClient();
  const { data: product } = await supabase.from("products").select("*").eq("id", id).maybeSingle();
  if (!product) notFound();

  // Load variants so table shows existing توليفات and حفظ works (otherwise empty deletes)
  try {
    const admin = createAdminClient();
    const { data: variants } = await admin.from("product_variants").select("*").eq("product_id", id).order("sort_order");
    if (variants?.length) (product as any).variants = variants;
  } catch {}

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-stone-900">تعديل منتج</h1>
      <ProductForm product={product as Product} />
    </div>
  );
}

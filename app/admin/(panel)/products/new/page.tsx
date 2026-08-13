import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth";
import { ProductForm } from "@/components/admin/product-form";

export default async function NewProductPage() {
  if (!(await getAdminSession())) redirect("/admin");
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-stone-900">إضافة منتج</h1>
      <ProductForm />
    </div>
  );
}

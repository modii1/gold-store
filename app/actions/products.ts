"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Product } from "@/types";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || `product-${Date.now()}`;
}

export async function saveProductAction(formData: FormData) {
  const id = formData.get("id") as string | null;
  const name = (formData.get("name") as string).trim();
  const price = parseFloat(formData.get("price") as string);
  const sale_price = formData.get("sale_price") ? parseFloat(formData.get("sale_price") as string) || null : null;
  const category = (formData.get("category") as string).trim() || null;
  const description = (formData.get("description") as string).trim() || null;
  const sku = (formData.get("sku") as string)?.trim() || null;
  const barcode = (formData.get("barcode") as string)?.trim() || null;
  const weight = (formData.get("weight") as string)?.trim() || null;
  const weight_grams = formData.get("weight_grams") ? parseFloat(formData.get("weight_grams") as string) || null : null;
  const karat = (formData.get("karat") as string)?.trim() || null;
  const material = (formData.get("material") as string)?.trim() || null;
  const color = (formData.get("color") as string)?.trim() || null;
  const brand = (formData.get("brand") as string)?.trim() || null;
  const stock = parseInt(formData.get("stock") as string) || 0;
  const is_available = formData.get("is_available") === "on";
  const featured = formData.get("featured") === "on";
  const is_best_seller = formData.get("is_best_seller") === "on";
  const seo_title = (formData.get("seo_title") as string)?.trim() || null;
  const seo_description = (formData.get("seo_description") as string)?.trim() || null;
  const keywords = (formData.get("keywords") as string)?.trim() || null;
  const specs = JSON.parse((formData.get("specs") as string) || "[]") as { label: string; value: string }[];

  const images = JSON.parse((formData.get("images") as string) || "[]");
  const videos = JSON.parse((formData.get("videos") as string) || "[]");

  if (!name) return { error: "اسم المنتج مطلوب" };
  if (!price || price <= 0) return { error: "السعر مطلوب" };

  const supabase = createAdminClient();
  const slug = slugify(name);

  const payload: any = {
    name, slug, price, sale_price, category, description,
    sku, barcode, weight, weight_grams, karat, material, color, brand,
    stock, images, videos, is_available, featured, is_best_seller,
    seo_title, seo_description, keywords, specs: specs.filter((s) => s.label.trim() && s.value.trim()),
  };

  let productId = id;
  if (id) {
    const { error } = await supabase.from("products").update(payload).eq("id", id);
    if (error) return { error: error.message };
  } else {
    const { data, error } = await supabase.from("products").insert(payload).select("id").single();
    if (error) return { error: error.message };
    productId = (data as any).id;
  }

  // Variants (Amazon style) — JSON array from form
  const variantsRaw = formData.get("variants") as string | null;
  if (variantsRaw && productId) {
    interface VariantInput {
      color?: string;
      color_hex?: string;
      size?: string;
      sku?: string;
      price?: string | number;
      sale_price?: string | number;
      stock?: string | number;
      image_url?: string;
    }
    let variants: VariantInput[] = [];
    try {
      variants = JSON.parse(variantsRaw) as VariantInput[];
    } catch {
      return { error: "بيانات التوليفات غير صالحة" };
    }

    // الطريقة الأساسية: دالة DB ذرية (حذف+إدراج في معاملة واحدة) — لا خسارة عند الفشل.
    try {
      const { error: rpcErr } = await supabase.rpc("save_product_variants", {
        p_product_id: productId,
        p_variants: JSON.stringify(variants),
      });
      if (!rpcErr) {
        revalidatePath("/");
        revalidatePath("/admin/products");
        revalidatePath("/product");
        return { success: true };
      }
      // لو الدالة غير منشأة بعد (الترحيل لم يُشغَّل): إبلاغ واضح بدل كتم الخطأ.
      if (!String(rpcErr.code || "").match(/PGRST202/i)) {
        return { error: `تعذر حفظ التوليفات: ${rpcErr.message}` };
      }
    } catch (e) {
      if (!String((e as Error)?.message || "").match(/PGRST202/i)) {
        return { error: `تعذر حفظ التوليفات: ${(e as Error)?.message || String(e)}` };
      }
    }

    // مسار احتياطي (يُستخدم فقط إذا لم تُنشأ الدالة بعد): يُحذف ثم يُدرج —
    // مع التحقق من صلاحية الأرقام قبل أي حذف، ونفس سلوك النسخة الأصلية.
    const rows = variants
      .filter((v) => v.color?.trim() || v.size?.trim() || v.image_url?.trim())
      .map((v, i) => {
        const price = v.price !== "" && v.price != null ? parseFloat(String(v.price)) : null;
        const sale_price = v.sale_price !== "" && v.sale_price != null ? parseFloat(String(v.sale_price)) : null;
        const stock = parseInt(String(v.stock), 10) || 0;
        if ((price != null && Number.isNaN(price)) || (sale_price != null && Number.isNaN(sale_price)) || Number.isNaN(stock)) {
          throw new Error("أرقام التوليفة غير صالحة (سعر/مخزون)");
        }
        return {
          product_id: productId,
          color: (v.color || "").trim() || null,
          color_hex: (v.color_hex || "").trim() || null,
          size: (v.size || "").trim() || null,
          sku: (v.sku || "").trim() || null,
          price,
          sale_price,
          stock,
          image_url: v.image_url || null,
          sort_order: i,
          is_active: true,
        };
      });
    const { error: delErr } = await supabase.from("product_variants").delete().eq("product_id", productId);
    if (delErr) return { error: `تعذر حذف التوليفات القديمة: ${delErr.message}` };
    if (rows.length) {
      const { error: vErr } = await supabase.from("product_variants").insert(rows);
      if (vErr) return { error: `تعذر حفظ التوليفات: ${vErr.message}` };
    }
  }

  revalidatePath("/");
  revalidatePath("/admin/products");
  revalidatePath("/product");
  return { success: true };
}

export async function getFavProductsAction(ids: string[]): Promise<Product[]> {
  if (!ids.length) return [];
  const supabase = await createClient();
  const { data } = await supabase.from("products").select("*").in("id", ids);
  return (data as Product[]) || [];
}

export async function deleteProductAction(formData: FormData) {
  const id = formData.get("id") as string;
  if (!id) return { error: "معرف مطلوب" };

  const supabase = createAdminClient();
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/");
  revalidatePath("/admin/products");
  return { success: true };
}

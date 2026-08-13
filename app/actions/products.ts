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

  const images = JSON.parse((formData.get("images") as string) || "[]");
  const videos = JSON.parse((formData.get("videos") as string) || "[]");

  if (!name) return { error: "اسم المنتج مطلوب" };
  if (!price || price <= 0) return { error: "السعر مطلوب" };

  const supabase = createAdminClient();
  const slug = slugify(name);

  const payload = {
    name, slug, price, sale_price, category, description,
    sku, barcode, weight, weight_grams, karat, material, color, brand,
    stock, images, videos, is_available, featured, is_best_seller,
    seo_title, seo_description, keywords,
  };

  if (id) {
    const { error } = await supabase.from("products").update(payload).eq("id", id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("products").insert(payload);
    if (error) return { error: error.message };
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

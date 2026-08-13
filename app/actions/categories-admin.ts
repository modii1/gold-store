"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

export async function saveCategoryAction(formData: FormData) {
  const id = formData.get("id") as string | null;
  const name = (formData.get("name") as string).trim();
  const slug = (formData.get("slug") as string).trim() || name.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]+/g, "-").replace(/^-|-$/g, "");
  const image = (formData.get("image") as string)?.trim() || null;
  const description = (formData.get("description") as string)?.trim() || null;
  const sort_order = parseInt(formData.get("sort_order") as string) || 0;
  const is_active = formData.get("is_active") === "on";

  if (!name || !slug) return { error: "الاسم مطلوب" };

  const supabase = createAdminClient();
  if (id) {
    const { error } = await supabase.from("categories").update({ name, slug, image, description, sort_order, is_active }).eq("id", id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("categories").insert({ name, slug, image, description, sort_order, is_active });
    if (error) return { error: error.message };
  }

  revalidatePath("/admin/categories");
  revalidatePath("/");
  return { success: true };
}

export async function deleteCategoryAction(formData: FormData) {
  const id = formData.get("id") as string;
  if (!id) return { error: "معرف مطلوب" };
  const supabase = createAdminClient();
  const { error } = await supabase.from("categories").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/categories");
  revalidatePath("/");
  return { success: true };
}

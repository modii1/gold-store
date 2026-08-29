"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

export async function savePageAction(formData: FormData) {
  const id = formData.get("id") as string | null;
  const title = (formData.get("title") as string).trim();
  const rawSlug = (formData.get("slug") as string) || "";
  const slug = id ? rawSlug.trim().toLowerCase() : slugify(rawSlug);
  const content = (formData.get("content") as string) || "";
  const is_active = formData.get("is_active") === "on";

  if (!title || !slug) return { error: "العنوان والمعرّف (slug) مطلوبان" };
  if (!/^[a-z0-9_-]+$/.test(slug)) return { error: "المعرّف يجب أن يحتوي أحرفاً إنجليزية وأرقاماً فقط" };

  const supabase = createAdminClient();

  if (id) {
    const { error } = await supabase.from("pages").update({ title, slug, content, is_active }).eq("id", id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("pages").insert({ title, slug, content, is_active });
    if (error) return { error: error.message };
  }

  revalidatePath("/admin/pages");
  revalidatePath("/");
  return { success: true };
}

export async function deletePageAction(formData: FormData) {
  const id = formData.get("id") as string;
  if (!id) return { error: "معرف مطلوب" };
  const supabase = createAdminClient();
  const { error } = await supabase.from("pages").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/pages");
  revalidatePath("/");
  return { success: true };
}

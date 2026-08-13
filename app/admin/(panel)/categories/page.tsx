import { createClient } from "@/lib/supabase/server";
import { CategoriesManager } from "./categories-manager";
import type { Category } from "@/types";

export default async function AdminCategoriesPage() {
  let categories: Category[] = [];
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("categories").select("*").order("sort_order", { ascending: true });
    if (data) categories = data as Category[];
  } catch {}

  return <CategoriesManager categories={categories} />;
}

import { createClient } from "@/lib/supabase/server";
import type { Page } from "@/types";

export async function getPage(slug: string): Promise<Page | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("pages")
      .select("*")
      .eq("slug", slug)
      .eq("is_active", true)
      .maybeSingle();
    return (data as Page) || null;
  } catch {
    return null;
  }
}

export async function getActivePages(): Promise<Page[]> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("pages")
      .select("id, slug, title, is_active")
      .eq("is_active", true)
      .order("created_at", { ascending: true });
    return (data as Page[]) || [];
  } catch {
    return [];
  }
}

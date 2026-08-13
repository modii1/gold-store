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

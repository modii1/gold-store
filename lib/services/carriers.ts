import { createClient } from "@/lib/supabase/server";
import type { Carrier } from "@/types";

export async function getCarriers(activeOnly = false): Promise<Carrier[]> {
  try {
    const supabase = await createClient();
    let builder = supabase.from("carriers").select("*");
    if (activeOnly) builder = builder.eq("is_active", true);
    const { data } = await builder.order("sort_order", { ascending: true }).order("created_at", { ascending: true });
    return (data as Carrier[]) || [];
  } catch {
    return [];
  }
}

export async function getCarrierByCode(code: string): Promise<Carrier | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("carriers").select("*").eq("code", code).maybeSingle();
    return (data as Carrier) || null;
  } catch {
    return null;
  }
}

import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { SectionsManager } from "./sections-manager";
import type { HomeSection } from "@/types";

export default async function AdminSectionsPage() {
  if (!(await getAdminSession())) redirect("/admin");

  let sections: HomeSection[] = [];
  try {
    const supabase = createAdminClient();
    const { data } = await supabase.from("home_sections").select("*").order("sort_order", { ascending: true });
    sections = (data || []) as HomeSection[];
  } catch {}

  return <SectionsManager sections={sections} />;
}

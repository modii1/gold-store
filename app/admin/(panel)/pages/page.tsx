import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { PagesManager } from "./pages-manager";
import type { Page } from "@/types";

export default async function AdminPagesPage() {
  if (!(await getAdminSession())) redirect("/admin");

  let pages: Page[] = [];
  try {
    const supabase = createAdminClient();
    const { data } = await supabase.from("pages").select("*").order("created_at", { ascending: true });
    pages = (data || []) as Page[];
  } catch {}

  return <PagesManager pages={pages} />;
}

import { createClient } from "@/lib/supabase/server";
import { CouponsManager } from "./coupons-manager";
import type { Coupon } from "@/types";

export default async function AdminCouponsPage() {
  let coupons: Coupon[] = [];
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("coupons").select("*").order("created_at", { ascending: false });
    if (data) coupons = data as Coupon[];
  } catch {}

  return <CouponsManager coupons={coupons} />;
}

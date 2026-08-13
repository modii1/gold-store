import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth";
import { getCarriers } from "@/lib/services/carriers";
import { ShippingManager } from "./shipping-manager";

export default async function AdminShippingPage() {
  if (!(await getAdminSession())) redirect("/admin");
  const carriers = await getCarriers();
  return <ShippingManager carriers={carriers} />;
}

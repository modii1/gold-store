import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth";
import { getCarriers } from "@/lib/services/carriers";
import { getSettings } from "@/lib/services/settings";
import { ShippingManager } from "./shipping-manager";

export default async function AdminShippingPage() {
  if (!(await getAdminSession())) redirect("/admin");
  const [carriers, settings] = await Promise.all([getCarriers(), getSettings()]);
  return <ShippingManager carriers={carriers} shippingDisplayMode={settings.shipping_display_mode} />;
}

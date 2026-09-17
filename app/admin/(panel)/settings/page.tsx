import { getSettings } from "@/lib/services/settings";
import { getCarriers } from "@/lib/services/carriers";
import { SettingsForm } from "./settings-form";
import { ShippingManager } from "../shipping/shipping-manager";

export default async function AdminSettingsPage() {
  const [settings, carriers] = await Promise.all([getSettings(), getCarriers()]);
  return (
    <>
      <SettingsForm settings={settings} />
      <div className="mt-8 border-t border-amber-100 pt-8">
        <ShippingManager carriers={carriers} shippingDisplayMode={settings.shipping_display_mode} />
      </div>
    </>
  );
}

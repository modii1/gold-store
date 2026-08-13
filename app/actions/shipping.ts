"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getOtoRates } from "@/lib/oto/rates";
import { getCarriers } from "@/lib/services/carriers";
import type { Carrier } from "@/types";
import type { ShippingQuote } from "@/lib/shipping";

export type CheckoutShippingOption = ShippingQuote & {
  ref: string;
  optionId?: number;
  logo?: string;
  pickupDropoff?: string;
  freeAbove?: number | null;
};

export async function getCheckoutRatesAction(city: string, weightKg: number, codAmount: number): Promise<CheckoutShippingOption[]> {
  const normalized = (city || "").trim();
  const carriers = await getCarriers(true);

  const flat: CheckoutShippingOption[] = carriers
    .filter((c) => c.provider !== "oto")
    .map((c) => {
      const free = c.free_above && codAmount && codAmount >= c.free_above ? true : false;
      return {
        carrierId: c.id,
        carrierCode: c.code,
        ref: c.id,
        name: c.name,
        cost: free ? 0 : c.cost,
        estimatedDays: c.estimated_days,
        freeAbove: c.free_above,
        live: false,
        logo: c.logo_url || undefined,
      };
    });

  const otoEnabled = process.env.OTO_RATES_ENABLED !== "false";

  if (otoEnabled && normalized && weightKg > 0) {
    try {
      const supabase = createAdminClient();
      const { data: cfg } = await supabase.from("oto_config").select("is_connected").eq("id", 1).maybeSingle();
      if ((cfg as any)?.is_connected) {
        const rates = await getOtoRates({
          destinationCity: normalized,
          weightKg,
          codAmount: codAmount || undefined,
        });
        const oto: CheckoutShippingOption[] = rates.map((r) => ({
          carrierId: "",
          carrierCode: "oto",
          ref: `oto:${r.optionId}`,
          name: r.optionName,
          cost: r.price,
          estimatedDays: r.estimatedDays,
          freeAbove: null,
          live: true,
          optionId: r.optionId,
          logo: r.logo,
          pickupDropoff: r.pickupDropoff,
        }));
        return [...flat, ...oto];
      }
    } catch {
      // OTO unavailable — fall back to flat carriers only
    }
  }

  return flat;
}

export async function resolveShippingRef(ref: string, subtotal: number): Promise<{ cost: number; name: string } | null> {
  if (ref.startsWith("oto:")) {
    const optionId = parseInt(ref.split(":")[1], 10);
    if (!optionId) return null;
    try {
      // Re-fetch authoritative price for OTO options to prevent client tampering
      return null; // resolved in createOrderAction with city context
    } catch {
      return null;
    }
  }
  const supabase = createAdminClient();
  const { data: carrier } = await supabase.from("carriers").select("id, name, cost, free_above").eq("id", ref).maybeSingle();
  if (!carrier) return null;
  const cost = carrier.free_above && subtotal >= carrier.free_above ? 0 : carrier.cost;
  return { cost, name: carrier.name };
}

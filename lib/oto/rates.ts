import { createAdminClient } from "@/lib/supabase/admin";
import { otoCheckDeliveryFee } from "./client";
import type { OtoRateQuote } from "./types";

export type OtoRatesInput = {
  originCity?: string;
  destinationCity: string;
  originCountry?: string;
  destinationCountry?: string;
  weightKg: number;
  codAmount?: number;
  length?: number;
  width?: number;
  height?: number;
  serviceType?: string;
};

function parseDays(text: string | undefined): string | null {
  if (!text) return null;
  const m = text.match(/(\d+)\s*to\s*(\d+)/i);
  if (m) return `${m[1]} - ${m[2]} أيام`;
  const s = text.match(/(\d+)/);
  if (s) return `${s[1]} أيام`;
  return text;
}

export async function getOtoRates(input: OtoRatesInput): Promise<OtoRateQuote[]> {
  const supabase = createAdminClient();
  const { data: cfg } = await supabase.from("oto_config").select("origin_city, origin_country").eq("id", 1).maybeSingle();

  const res = await otoCheckDeliveryFee({
    originCity: input.originCity || (cfg as any)?.origin_city || "Riyadh",
    destinationCity: input.destinationCity,
    originCountry: input.originCountry || (cfg as any)?.origin_country || "SA",
    destinationCountry: input.destinationCountry || "SA",
    weight: input.weightKg,
    currency: "SAR",
    totalDue: input.codAmount,
    packageCount: 1,
    length: input.length,
    width: input.width,
    height: input.height,
    serviceType: input.serviceType,
  });

  if (!res.success || !res.deliveryCompany) return [];

  return res.deliveryCompany.map((o) => ({
    optionId: o.deliveryOptionId,
    companyName: o.deliveryCompanyName,
    optionName: o.deliveryOptionName,
    price: o.price,
    estimatedDays: parseDays(o.avgDeliveryTime),
    codCharge: o.codCharge,
    maxFreeWeight: o.maxFreeWeight,
    extraWeightPerKg: o.extraWeightPerKg,
    maxCODValue: o.maxCODValue,
    maxOrderValue: o.maxOrderValue,
    pickupDropoff: o.pickupDropoff || "freePickup",
    logo: o.logo,
  }));
}

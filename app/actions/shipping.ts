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

export async function reverseGeocodeAction(latitude: string, longitude: string) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { error: "إحداثيات الموقع غير صحيحة" };

  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1&accept-language=ar`, {
      headers: { "User-Agent": "Lama-Gold-Store/1.0" },
      cache: "no-store",
    });
    if (!response.ok) return { error: "تعذر قراءة عنوان الموقع" };
    const result = await response.json() as { display_name?: string; address?: Record<string, string> };
    const address = result.address || {};
    const city = address.city || address.town || address.village || address.municipality || address.county || "";
    const region = address.state || address.region || "";
    const line = [address.road, address.house_number, address.neighbourhood || address.suburb].filter(Boolean).join(" ") || result.display_name || "موقع محدد بالخريطة";
    return { city, region, address: line, displayName: result.display_name || line };
  } catch {
    return { error: "تعذر تحويل الموقع إلى عنوان" };
  }
}

export type NationalAddressResult = {
  building_number: string;
  street: string;
  district: string;
  city: string;
  post_code: string;
  additional_number: string;
  region: string;
  address: string;
  national_address: string;
};

/**
 * A valid Saudi National Address building number is exactly 4 digits (e.g. 1234).
 * Returns the raw value only if it matches that pattern, otherwise "" so the
 * field is left blank instead of showing coordinates or a placeholder.
 */
function cleanBuildingNumber(value: string): string {
  return /^\d{4}$/.test(value) ? value : "";
}

function parseSplAddress(raw: unknown): NationalAddressResult | null {
  try {
    const root = raw as { Addresses?: unknown[]; Result?: unknown };
    let list = Array.isArray(root.Addresses) ? root.Addresses : [];
    if (!list.length && root.Result && (root.Result as { Addresses?: unknown[] }).Addresses) {
      list = (root.Result as { Addresses: unknown[] }).Addresses;
    }
    const item = (list[0] || {}) as Record<string, unknown>;
    if (!item || Object.keys(item).length === 0) return null;

    const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const building = cleanBuildingNumber(s(item.BuildingNumber));
    const street = s(item.Street);
    const district = s(item.District);
    const city = s(item.City);
    const post = s(item.PostCode);
    const additional = s(item.AdditionalNumber);
    const region = s(item.RegionName);

    if (!street && !district && !city && !post) return null;

    // National Address format: "BuildingNo|Street - District|City|Postcode|AdditionalNo"
    const national = [building, street, district, city, post, additional].filter(Boolean).join("|");
    // Readable line for display; building number is kept separate (never coordinates).
    const address = [street, district, building && `مبنى ${building}`].filter(Boolean).join(" ") || city;

    return { building_number: building, street, district, city, post_code: post, additional_number: additional, region, address, national_address: national };
  } catch {
    return null;
  }
}

/**
 * Reverse-geocodes coordinates to a Saudi National Address via Saudi Post (سُبل).
 * Requires NATIONAL_ADDRESS_API_KEY. Falls back to OpenStreetMap if no key is set.
 */
export async function reverseGeocodeNationalAction(latitude: string, longitude: string) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { error: "إحداثيات الموقع غير صحيحة" };

  const apiKey = process.env.NATIONAL_ADDRESS_API_KEY?.trim();

  // 1) Try Saudi National Address API (سُبل) when a key is configured.
  if (apiKey) {
    try {
      const url = `https://apina.address.gov.sa/NationalAddress/v3.1/address/address-geocode?language=A&format=JSON&lat=${lat}&long=${lon}&api_key=${encodeURIComponent(apiKey)}`;
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) {
        const raw = await response.json();
        const parsed = parseSplAddress(raw);
        if (parsed) {
          return {
            ...parsed,
            city: parsed.city,
            region: parsed.region || "",
            address: parsed.address,
            national_address: parsed.national_address,
            displayName: parsed.address,
          };
        }
      }
    } catch {
      /* fall through to OSM */
    }
  }

  // 2) Fallback: generic OpenStreetMap reverse-geocode.
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1&accept-language=ar`, {
      headers: { "User-Agent": "Lama-Gold-Store/1.0" },
      cache: "no-store",
    });
    if (!response.ok) return { error: "تعذر قراءة عنوان الموقع" };
    const result = await response.json() as { display_name?: string; address?: Record<string, string> };
    const a = result.address || {};
    const city = a.city || a.town || a.village || a.municipality || a.county || "";
    const region = a.state || a.region || "";
    // OSM "house_number" is the street house number — only treat it as a Saudi
    // building number when it is exactly 4 digits; otherwise keep it blank
    // rather than putting coordinates or a made-up value in رقم المبنى.
    const building = cleanBuildingNumber(a.house_number || "");
    const street = a.road || "";
    const district = a.neighbourhood || a.suburb || "";
    const post = a.postcode || "";
    const line = [street, district].filter(Boolean).join(" ") || result.display_name || "موقع محدد بالخريطة";
    return {
      building_number: building,
      street,
      district,
      city,
      post_code: post,
      additional_number: "",
      region,
      address: line,
      national_address: "",
      displayName: result.display_name || line,
    };
  } catch {
    return { error: "تعذر تحويل الموقع إلى عنوان" };
  }
}

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

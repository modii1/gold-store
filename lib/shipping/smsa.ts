import type { Carrier } from "@/types";
import { carrierConfigured, flatQuote, type ShippingQuote, type ShippingQuoteInput } from "./types";

// SMSA Express API v3 (Saudi Arabia)
// Base: https://track.smsaexpress.com/connect/api/...
const DEFAULT_ENDPOINT = "https://track.smsaexpress.com/connect";

function creds(carrier: Carrier) {
  const c = carrier.config || {};
  return { passKey: c.apiKey, username: c.username };
}

async function getSmsaRate(carrier: Carrier, input: ShippingQuoteInput): Promise<number> {
  const c = creds(carrier);
  const configuredEndpoint = carrier.config?.endpoint;
  const endpoint = configuredEndpoint?.includes("http") ? configuredEndpoint : DEFAULT_ENDPOINT;

  const auth = Buffer.from(`${c.username || ""}:${c.passKey || ""}`).toString("base64");
  const res = await fetch(`${endpoint}/api/v3/rates`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({
      ref: "rate",
      pc: "TEST",
      totalWeight: Math.max(0.05, input.weightGrams / 1000),
      totalCash: input.subtotal,
      pickupDate: "2026-01-01",
      expectedDeliveryDate: "2026-01-03",
      origin: { city: "Riyadh" },
      destination: { city: input.city || "Riyadh" },
    }),
  });
  if (!res.ok) throw new Error(`SMSA rate failed: ${res.status}`);
  const data = await res.json();

  // SMSA may return the price inside `price`/`amount` depending on version
  const amount = parseFloat(data?.price ?? data?.amount ?? data?.rates?.[0]?.price ?? "0");
  if (!amount || amount <= 0) throw new Error("SMSA returned no amount");
  return Math.round(amount * 100) / 100;
}

export async function smsaQuote(carrier: Carrier, input: ShippingQuoteInput): Promise<ShippingQuote> {
  const base = {
    carrierId: carrier.id,
    carrierCode: carrier.code,
    name: carrier.name,
    estimatedDays: carrier.estimated_days || "2-5 أيام",
    freeAbove: carrier.free_above,
  };

  if (carrier.mode !== "api" || !carrierConfigured(carrier)) {
    return { ...base, cost: carrier.cost || null, live: false };
  }

  try {
    const cost = await getSmsaRate(carrier, input);
    return { ...base, cost, live: true };
  } catch {
    return { ...base, cost: carrier.cost || null, live: false };
  }
}

// Creates an SMSA shipment and returns the waybill/tracking number.
export async function smsaCreateShipment(
  carrier: Carrier,
  shipment: {
    reference: string;
    customerName: string;
    customerPhone: string;
    city: string | null;
    region: string | null;
    address: string | null;
    weightGrams: number;
    description: string;
  }
): Promise<{ trackingNumber: string }> {
  const c = creds(carrier);
  const configuredEndpoint = carrier.config?.endpoint;
  const endpoint = configuredEndpoint?.includes("http") ? configuredEndpoint : DEFAULT_ENDPOINT;

  const auth = Buffer.from(`${c.username || ""}:${c.passKey || ""}`).toString("base64");
  const res = await fetch(`${endpoint}/api/v3/shipments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({
      ref: shipment.reference,
      consignee: shipment.customerName,
      address: shipment.address || "",
      phone: shipment.customerPhone,
      city: shipment.city || "",
      totalWeight: Math.max(0.05, shipment.weightGrams / 1000),
      productGroup: "DOM",
      productType: "ONP",
      description: shipment.description,
    }),
  });
  if (!res.ok) throw new Error(`SMSA create shipment failed: ${res.status}`);
  const data = await res.json();
  const awb = data?.awb ?? data?.waybill ?? data?.shipmentNumber;
  if (!awb) throw new Error("SMSA did not return a waybill");
  return { trackingNumber: awb };
}

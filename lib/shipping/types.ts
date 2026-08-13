import type { Carrier } from "@/types";

export type ShippingQuoteInput = {
  weightGrams: number;
  subtotal: number;
  city: string | null;
  region: string | null;
};

export type ShippingQuote = {
  carrierId: string;
  carrierCode: string;
  name: string;
  cost: number | null;
  estimatedDays: string | null;
  freeAbove: number | null;
  live: boolean;
};

export function carrierConfigured(carrier: Carrier): boolean {
  const c = carrier.config || {};
  return !!(c.apiKey || c.username || c.accountNumber || c.clientCode);
}

export function flatQuote(carrier: Carrier, input: ShippingQuoteInput): ShippingQuote {
  const free = carrier.free_above && input.subtotal >= carrier.free_above;
  return {
    carrierId: carrier.id,
    carrierCode: carrier.code,
    name: carrier.name,
    cost: free ? 0 : carrier.cost,
    estimatedDays: carrier.estimated_days,
    freeAbove: carrier.free_above,
    live: false,
  };
}

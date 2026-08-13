import type { Carrier } from "@/types";
import { aramexQuote, aramexCreateShipment } from "./aramex";
import { smsaQuote, smsaCreateShipment } from "./smsa";
import { flatQuote, type ShippingQuote, type ShippingQuoteInput } from "./types";

export type { ShippingQuote, ShippingQuoteInput } from "./types";

export async function quoteCarrier(carrier: Carrier, input: ShippingQuoteInput): Promise<ShippingQuote> {
  switch (carrier.code) {
    case "aramex":
      return aramexQuote(carrier, input);
    case "smsa":
      return smsaQuote(carrier, input);
    default:
      return flatQuote(carrier, input);
  }
}

export async function quoteCarriers(carriers: Carrier[], input: ShippingQuoteInput): Promise<ShippingQuote[]> {
  const results = await Promise.all(carriers.map((c) => quoteCarrier(c, input)));
  return results.filter((q) => q.cost !== null);
}

export async function createCarrierShipment(
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
): Promise<{ trackingNumber: string; trackingUrl: string | null }> {
  let trackingNumber: string;
  let trackingUrl: string | null = null;

  switch (carrier.code) {
    case "aramex":
      ({ trackingNumber } = await aramexCreateShipment(carrier, shipment));
      trackingUrl = `https://www.aramex.com/tracking?awb=${trackingNumber}`;
      break;
    case "smsa":
      ({ trackingNumber } = await smsaCreateShipment(carrier, shipment));
      trackingUrl = `https://smsaexpress.com/SMOnlineTracking.aspx?awb=${trackingNumber}`;
      break;
    default:
      throw new Error(`الشركة ${carrier.name} لا تدعم إنشاء شحنة تلقائياً`);
  }

  return { trackingNumber, trackingUrl };
}

import type { Carrier } from "@/types";
import { carrierConfigured, flatQuote, type ShippingQuote, type ShippingQuoteInput } from "./types";

// Aramex Shipping API v2 (Saudi Arabia)
// Rates: POST {endpoint}/Shipping/Service_1_0.svc/json/CalculateRate
const DEFAULT_ENDPOINT = "https://ws.shippingapi.aramex.com/ShippingAPI.V2";

type AramexCreds = {
  userName?: string;
  password?: string;
  accountNumber?: string;
  accountPin?: string;
  accountEntity?: string;
  accountCountryCode?: string;
};

function creds(carrier: Carrier): AramexCreds {
  const c = carrier.config || {};
  return {
    userName: c.username,
    password: c.password,
    accountNumber: c.accountNumber,
    accountPin: c.apiKey,
    accountEntity: c.clientCode || "RUH",
    accountCountryCode: c.endpoint || "SA",
  };
}

function totalWeightGrams(input: ShippingQuoteInput): number {
  return Math.max(50, Math.round(input.weightGrams));
}

async function getAramexRate(carrier: Carrier, input: ShippingQuoteInput): Promise<number> {
  const c = creds(carrier);
  const configuredEndpoint = carrier.config?.endpoint;
  const endpoint = configuredEndpoint?.includes("http") ? configuredEndpoint : DEFAULT_ENDPOINT;

  const body = {
    ClientInfo: {
      UserName: c.userName,
      Password: c.password,
      AccountNumber: c.accountNumber,
      AccountPin: c.accountPin,
      AccountEntity: c.accountEntity,
      AccountCountryCode: c.accountCountryCode,
      Source: 24,
    },
    OriginAddress: { StateOrProvince: "Riyadh", City: "Riyadh", CountryCode: "SA" },
    DestinationAddress: {
      StateOrProvince: input.region || input.city || "",
      City: input.city || "",
      CountryCode: "SA",
    },
    ShipmentDetails: {
      DwellingType: "Residential",
      ActualWeight: { Unit: "KG", Value: totalWeightGrams(input) / 1000 },
      ChargeableWeight: { Unit: "KG", Value: totalWeightGrams(input) / 1000 },
      NumberOfPieces: 1,
    },
  };

  const res = await fetch(`${endpoint}/Shipping/Service_1_0.svc/json/CalculateRate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Aramex rate failed: ${res.status}`);
  const data = await res.json();

  const costs: Record<string, number>[] = data?.TotalAmount
    ? [{ TotalAmount: data.TotalAmount }]
    : data?.TotalAmountPerPackageList || [];
  const amount = costs.reduce((sum, p) => sum + (parseFloat(String(p.TotalAmount || "0")) || 0), 0);
  if (!amount || amount <= 0) throw new Error("Aramex returned no amount");
  return Math.round(amount * 100) / 100;
}

export async function aramexQuote(carrier: Carrier, input: ShippingQuoteInput): Promise<ShippingQuote> {
  const base = {
    carrierId: carrier.id,
    carrierCode: carrier.code,
    name: carrier.name,
    estimatedDays: carrier.estimated_days || "2-4 أيام",
    freeAbove: carrier.free_above,
  };

  if (carrier.mode !== "api" || !carrierConfigured(carrier)) {
    return { ...base, cost: carrier.cost || null, live: false };
  }

  try {
    const cost = await getAramexRate(carrier, input);
    return { ...base, cost, live: true };
  } catch {
    return { ...base, cost: carrier.cost || null, live: false };
  }
}

// Creates a shipment on Aramex and returns the tracking number.
// Called from admin after order confirmation (needs configured credentials).
export async function aramexCreateShipment(
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

  const body = {
    ClientInfo: {
      UserName: c.userName,
      Password: c.password,
      AccountNumber: c.accountNumber,
      AccountPin: c.accountPin,
      AccountEntity: c.accountEntity,
      AccountCountryCode: c.accountCountryCode,
      Source: 24,
    },
    LabelInfo: { ReportID: 9201, ReportType: "URL" },
    Shipments: [
      {
        Reference1: shipment.reference,
        Shipper: {
          Reference1: shipment.reference,
          PartyAddress: { Line1: "Riyadh", City: "Riyadh", CountryCode: "SA" },
        },
        Consignee: {
          PartyAddress: {
            Line1: shipment.address || shipment.city || "",
            City: shipment.city || "",
            StateOrProvince: shipment.region || shipment.city || "",
            CountryCode: "SA",
          },
          Contact: {
            PersonName: shipment.customerName,
            PhoneNumber1: shipment.customerPhone,
            CellPhone: shipment.customerPhone,
          },
        },
        Details: {
          Dimensions: { Length: 20, Width: 15, Height: 10, Unit: "cm" },
          ActualWeight: { Unit: "KG", Value: Math.max(0.05, shipment.weightGrams / 1000) },
          ChargeableWeight: { Unit: "KG", Value: Math.max(0.05, shipment.weightGrams / 1000) },
          NumberOfPieces: 1,
          DescriptionOfGoods: shipment.description,
          GoodsOriginCountry: "SA",
        },
      },
    ],
  };

  const res = await fetch(`${endpoint}/Shipping/Service_1_0.svc/json/CreateShipments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Aramex create shipment failed: ${res.status}`);
  const data = await res.json();
  const awb = data?.Shipments?.[0]?.IDNumber;
  if (!awb) throw new Error("Aramex did not return a shipment number");
  return { trackingNumber: awb };
}

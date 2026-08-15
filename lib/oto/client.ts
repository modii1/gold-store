import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret, encryptSecret } from "./crypto";
import type { OtoTokenPair, OtoAccountInfo, OtoDeliveryFeeResponse } from "./types";

const API_BASE = process.env.OTO_API_BASE || "https://api.tryoto.com";
const OTO_ENV = process.env.OTO_ENV || "production";

export function otoBase(): string {
  return API_BASE.replace(/\/$/, "");
}

export function isSandbox(): boolean {
  return OTO_ENV === "sandbox";
}

type OtoConfigRow = {
  refresh_token_enc: string | null;
  access_token: string | null;
  access_token_expires_at: string | null;
};

async function getConfig(): Promise<OtoConfigRow | null> {
  const supabase = createAdminClient();
  const { data } = await supabase.from("oto_config").select("refresh_token_enc, access_token, access_token_expires_at").eq("id", 1).maybeSingle();
  return (data as OtoConfigRow) || null;
}

export async function saveAccessToken(accessToken: string): Promise<void> {
  try {
    const supabase = createAdminClient();
    const expiresAt = new Date(Date.now() + 55 * 60 * 1000).toISOString();
    await supabase.from("oto_config").update({ access_token: accessToken, access_token_expires_at: expiresAt }).eq("id", 1);
  } catch {
    // ignore — token still usable for this request
  }
}

export async function saveRefreshToken(refreshToken: string): Promise<void> {
  try {
    const supabase = createAdminClient();
    await supabase.from("oto_config").update({ refresh_token_enc: encryptSecret(refreshToken) }).eq("id", 1);
  } catch {
    // ignore
  }
}

async function refreshAccessToken(): Promise<string> {
  const supabase = createAdminClient();
  const cfg = await getConfig();
  const stored = cfg?.refresh_token_enc;
  const envRefresh = process.env.OTO_REFRESH_TOKEN;

  const refreshToken = envRefresh && envRefresh.length > 10 ? envRefresh : stored ? decryptSecret(stored) : "";
  if (!refreshToken) throw new Error("لا يوجد refresh_token لـ OTO — اربط الحساب من الإعدادات أولاً");

  const res = await fetch(`${otoBase()}/rest/v2/refreshToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const json = (await res.json()) as OtoTokenPair;
  if (!res.ok || !json.success || !json.access_token) {
    throw new Error(json.success === false ? "فشل تحديث توكن OTO — تأكد من صحة refresh_token" : `OTO error ${res.status}`);
  }
  await saveAccessToken(json.access_token);
  if (json.refresh_token && envRefresh) {
    await saveRefreshToken(json.refresh_token);
  }
  return json.access_token;
}

export async function getAccessToken(): Promise<string> {
  const cfg = await getConfig();
  const envAccess = process.env.OTO_ACCESS_TOKEN;
  if (envAccess) return envAccess;
  const stored = cfg?.access_token;
  const expiresAt = cfg?.access_token_expires_at ? new Date(cfg.access_token_expires_at).getTime() : 0;
  if (stored && Date.now() < expiresAt - 30_000) return stored;
  return refreshAccessToken();
}

export async function otoFetch<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${otoBase()}${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const msg = json.otoErrorMessage || json.errorMessage || json.message || `OTO error ${res.status}`;
    throw new Error(msg);
  }
  return json as T;
}

export async function otoCheckDeliveryFee(params: {
  originCity: string;
  destinationCity: string;
  originCountry?: string;
  destinationCountry?: string;
  weight: number;
  currency?: string;
  totalDue?: number;
  packageCount?: number;
  length?: number;
  width?: number;
  height?: number;
  serviceType?: string;
}): Promise<OtoDeliveryFeeResponse> {
  return otoFetch<OtoDeliveryFeeResponse>("/rest/v2/checkOTODeliveryFee", {
    method: "POST",
    body: params,
  });
}

export async function otoAccountInfo(): Promise<OtoAccountInfo> {
  return otoFetch<OtoAccountInfo>("/rest/v2/clientInfo");
}

export type OtoOrderStatus = {
  success?: boolean;
  orderId?: string;
  otoId?: string | number;
  shipmentId?: string;
  status?: string;
  dcStatus?: string;
  trackingNumber?: string;
  dcTrackingNumber?: string;
  trackingUrl?: string;
  printAWBURL?: string;
  deliveryCompany?: string;
  deliveryOptionName?: string;
  driverName?: string;
  driverPhone?: string;
  driverEmail?: string;
  currentLocation?: { currentCity?: string; currentDistrict?: string; currentBranch?: string };
  date?: string;
  otoErrorMessage?: string;
  errorMessage?: string;
};

/**
 * Track a single order in real time.
 * Accepts either the merchant `orderId` or the OTO-generated `otoId`.
 */
export async function otoOrderStatus(params: { orderId?: string | number; otoId?: string | number }): Promise<OtoOrderStatus> {
  return otoFetch<OtoOrderStatus>("/rest/v2/orderStatus", { method: "POST", body: params });
}

/**
 * Full order details including status history and shipment info.
 * GET with query params: orderId / otoId / ref1 (at least one).
 */
export async function otoOrderDetails(params: { orderId?: string | number; otoId?: string | number; ref1?: string | number }): Promise<Record<string, any>> {
  const qs = new URLSearchParams();
  if (params.orderId !== undefined) qs.set("orderId", String(params.orderId));
  if (params.otoId !== undefined) qs.set("otoId", String(params.otoId));
  if (params.ref1 !== undefined) qs.set("ref1", String(params.ref1));
  const query = qs.toString();
  return otoFetch<Record<string, any>>(`/rest/v2/orderDetails${query ? `?${query}` : ""}`);
}

export async function otoCreateOrder(body: Record<string, unknown>): Promise<{
  success: boolean;
  otoId?: number | string;
  otoErrorMessage?: string;
  deliveryCompany?: string;
  deliveryOptionName?: string;
}> {
  return otoFetch("/rest/v2/createOrder", { method: "POST", body });
}

export async function otoCreateShipment(body: {
  orderId: string;
  deliveryOptionId?: number;
  pickingType?: "PICKUP_BY_DC" | "BRANCH_DROP_OFF";
  whoPays?: "marketplacePaysDeliveryFee" | "sellerPaysDeliveryFee";
}): Promise<{
  success: boolean;
  deliveryCompany?: string;
  trackingNumber?: string;
  dcTrackingNumber?: string;
  trackingUrl?: string;
  printAWBURL?: string;
  brandedTrackingURL?: string;
  errorMessage?: string;
}> {
  return otoFetch("/rest/v2/createShipment", { method: "POST", body });
}

export async function otoCreateReturnShipment(body: {
  orderId: string;
  deliveryOptionId: string;
  pickupLocationCode?: string;
  pickingType?: "PICKUP_BY_DC" | "BRANCH_DROP_OFF";
  items?: { quantity: string; sku: string }[];
}): Promise<{
  success: boolean;
  returnOrderId?: string;
  message?: string;
  otoErrorMessage?: string;
}> {
  return otoFetch("/rest/v2/createReturnShipment", { method: "POST", body });
}

export async function otoGetReturnDetails(orderId: string): Promise<{
  success: boolean;
  returnedItems?: any[];
  returnOrderId?: string;
  returnStatus?: string;
  otoErrorMessage?: string;
}> {
  return otoFetch("/rest/v2/getReturnDetails", { method: "POST", body: { orderId } });
}

export async function otoRegisterWebhook(params: {
  method?: string;
  url: string;
  webhookType?: "orderStatus" | "shipmentError" | "newOrders" | "walletTransaction";
  secretKey?: string;
  authorizationKey?: string;
  timestampFormat?: string;
}): Promise<{ success: boolean; id?: string; message?: string }> {
  return otoFetch("/rest/v2/webhook", {
    method: "POST",
    body: {
      method: params.method || "post",
      url: params.url,
      webhookType: params.webhookType || "orderStatus",
      secretKey: params.secretKey,
      authorizationKey: params.authorizationKey,
      timestampFormat: params.timestampFormat,
    },
  });
}

export async function otoListWebhooks(): Promise<{ success: boolean; webhooks?: any[] }> {
  return otoFetch("/rest/v2/webhook");
}

export async function otoUpdateWebhook(params: {
  id: string | number;
  method?: string;
  url: string;
  webhookType?: string;
  secretKey?: string;
  authorizationKey?: string;
  timestampFormat?: string;
}): Promise<{ success: boolean; message?: string }> {
  return otoFetch("/rest/v2/webhook", {
    method: "PUT",
    body: {
      id: String(params.id),
      method: params.method || "post",
      url: params.url,
      webhookType: params.webhookType,
      secretKey: params.secretKey,
      authorizationKey: params.authorizationKey,
      timestampFormat: params.timestampFormat,
    },
  });
}

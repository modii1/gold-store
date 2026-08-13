"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  saveRefreshToken,
  otoAccountInfo,
  getAccessToken,
  otoRegisterWebhook,
  otoListWebhooks,
  otoUpdateWebhook,
} from "@/lib/oto/client";
import { encryptSecret } from "@/lib/oto/crypto";

export type OtoConnectResult = {
  success: boolean;
  error?: string;
  info?: {
    companyId: string;
    storeName: string;
    packageName: string;
    remainingCredit: number;
    currency: string;
    validityDate?: string;
  };
};

export async function connectOtoAction(formData: FormData): Promise<OtoConnectResult> {
  const refreshToken = (formData.get("refresh_token") as string)?.trim();
  const originCity = (formData.get("origin_city") as string)?.trim() || "Riyadh";
  const originCountry = (formData.get("origin_country") as string)?.trim().toUpperCase() || "SA";

  const supabase = createAdminClient();

  if (refreshToken) {
    await saveRefreshToken(refreshToken);
    await supabase.from("oto_config").update({ refresh_token_enc: encryptSecret(refreshToken) }).eq("id", 1);
  }

  await supabase.from("oto_config").update({ origin_city: originCity, origin_country: originCountry }).eq("id", 1);

  try {
    await getAccessToken();
    const info = await otoAccountInfo();
    await supabase.from("oto_config").update({
      company_id: info.companyId || null,
      store_name: info.storeName || null,
      package_name: info.packageName || null,
      remaining_credit: info.remainingCredit ?? 0,
      currency: info.currency || "SAR",
      validity_date: info.validityDate || null,
      is_connected: true,
    }).eq("id", 1);
    revalidatePath("/admin/shipping");
    return { success: true, info };
  } catch (e) {
    await supabase.from("oto_config").update({ is_connected: false }).eq("id", 1);
    return { success: false, error: (e as Error).message };
  }
}

export async function disconnectOtoAction(): Promise<{ success: boolean }> {
  const supabase = createAdminClient();
  await supabase.from("oto_config").update({
    refresh_token_enc: null,
    access_token: null,
    access_token_expires_at: null,
    is_connected: false,
  }).eq("id", 1);
  revalidatePath("/admin/shipping");
  return { success: true };
}

export async function testOtoConnectionAction(): Promise<{ success: boolean; error?: string; info?: any }> {
  try {
    const info = await otoAccountInfo();
    return { success: true, info };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export async function registerWebhooksAction(): Promise<{ success: boolean; error?: string; results?: any[] }> {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://gold-store.zerof443.workers.dev";
  const url = `${base}/api/webhooks/oto`;
  const secret = process.env.OTO_WEBHOOK_SECRET;
  const results: any[] = [];
  try {
    const existing = await otoListWebhooks();
    const found = (existing.webhooks || []).find((w) => w.url === url);
    if (found) {
      results.push({ type: "all", success: true, id: found.id, message: "مسجل مسبقاً — يُحدَّث التوقيع" });
      if (secret && (!found.secretKey || found.secretKey !== secret)) {
        await otoUpdateWebhook({ id: found.id, method: "post", url, secretKey: secret, authorizationKey: secret, timestampFormat: "yyyy-MM-dd HH:mm:ss" });
        results.push({ type: "all", success: true, id: found.id, message: "حُدّث مفتاح التوقيع" });
      }
    } else {
      const r = await otoRegisterWebhook({
        method: "post",
        url,
        webhookType: "orderStatus",
        secretKey: secret,
        authorizationKey: secret,
        timestampFormat: "yyyy-MM-dd HH:mm:ss",
      });
      results.push({ type: "all", success: r.success, id: r.id, message: r.message });
    }
  } catch (e) {
    results.push({ type: "all", success: false, error: (e as Error).message });
  }
  return { success: results.every((r) => r.success), results };
}

export async function listWebhooksAction(): Promise<{ success: boolean; error?: string; webhooks?: any[] }> {
  try {
    const r = await otoListWebhooks();
    return { success: r.success, webhooks: r.webhooks || [] };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export async function getOtoConfigAction() {
  const supabase = createAdminClient();
  const { data } = await supabase.from("oto_config").select("*").eq("id", 1).maybeSingle();
  return data as any || null;
}

export async function getOtoEnvLabelAction(): Promise<string> {
  const sandbox = process.env.OTO_ENV === "sandbox";
  return sandbox ? "Sandbox (اختبار)" : "Production (إنتاج)";
}

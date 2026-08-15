import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Channel provider settings stored in notification_channels.config (jsonb).
 * Adapters read credentials from here (falling back to env vars) so admins
 * can configure SMS / WhatsApp / Email / Push from the admin panel without
 * redeploying. Secrets are never logged.
 */

export type ChannelConfig = Record<string, string>;

export type ChannelConfigField = {
  key: string;
  label: string;
  type?: "text" | "password";
  placeholder?: string;
  hint?: string;
};

/** Which settings each channel exposes in the admin panel. */
export const CHANNEL_CONFIG_FIELDS: Record<string, ChannelConfigField[]> = {
  email: [
    { key: "provider", label: "المزود", placeholder: "resend / sendgrid / smtp" },
    { key: "api_key", label: "مفتاح API", type: "password", hint: "يُستخدم فقط عند تفعيل المزود" },
    { key: "from", label: "عنوان المرسل", placeholder: "noreply@example.com" },
  ],
  sms: [
    { key: "provider", label: "المزود", placeholder: "twilio / unifonic / smsa" },
    { key: "api_key", label: "مفتاح API", type: "password", hint: "مطلوب لتشغيل الرسائل" },
    { key: "sender", label: "اسم المرسل (Sender ID)", placeholder: "Luma" },
    { key: "from_number", label: "رقم المرسل", placeholder: "+9665xxxxxxx" },
  ],
  whatsapp: [
    { key: "provider", label: "المزود", placeholder: "meta / twilio / oto" },
    { key: "api_key", label: "مفتاح API / Access Token", type: "password", hint: "مطلوب لتشغيل واتساب" },
    { key: "phone_number_id", label: "معرّف رقم الواتساب", placeholder: "100000000000" },
    { key: "from_number", label: "رقم المرسل", placeholder: "+9665xxxxxxx" },
  ],
  push: [
    { key: "vapid_public_key", label: "VAPID Public Key", type: "password" },
    { key: "vapid_private_key", label: "VAPID Private Key", type: "password", hint: "يُحفظ مشفّرًا في القاعدة" },
    { key: "vapid_subject", label: "البريد المسجّل", placeholder: "contact@example.com" },
  ],
};

const cache = new Map<string, { at: number; data: { enabled: boolean; config: ChannelConfig } | null }>();
const CACHE_TTL_MS = 30_000;

export async function loadChannelConfig(code: string): Promise<{ enabled: boolean; config: ChannelConfig }> {
  const hit = cache.get(code);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.data || { enabled: false, config: {} };
  }

  let result: { enabled: boolean; config: ChannelConfig } = { enabled: true, config: {} };
  try {
    const supabase = createAdminClient();
    const { data } = await supabase.from("notification_channels").select("enabled, config").eq("code", code).maybeSingle();
    if (data) {
      result = {
        enabled: Boolean(data.enabled),
        config: (data.config as ChannelConfig) || {},
      };
    }
  } catch {
    // Fall back to defaults if the notifications schema is missing.
  }

  cache.set(code, { at: Date.now(), data: result });
  return result;
}

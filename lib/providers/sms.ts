import type { ChannelAdapter } from "@/lib/notifications/types";
import { loadChannelConfig } from "@/lib/notifications/channel-config";

/**
 * SMS adapter — provider-independent (Twilio, Unifonic, SMSA SMS, ...).
 * Credentials are configured from the admin panel and stored in
 * notification_channels.config; env vars are kept as a fallback.
 */
export const smsAdapter: ChannelAdapter = {
  code: "sms",
  name: "رسائل SMS",
  async isConfigured() {
    const { config } = await loadChannelConfig("sms");
    return Boolean(config.api_key || process.env.SMS_API_KEY);
  },
  async send({ recipient, message }) {
    const { config, enabled } = await loadChannelConfig("sms");
    const apiKey = config.api_key || process.env.SMS_API_KEY;
    if (!enabled || !apiKey) {
      return { ok: false, errorMessage: "مزود الرسائل SMS غير مهيأ" };
    }
    // Placeholder for the provider call — implement send() against the
    // chosen provider here (Twilio / Unifonic / SMSA). Never log secrets.
    return { ok: false, errorMessage: `مزود الرسائل SMS غير مهيأ (للمستلم ${recipient})` };
  },
};

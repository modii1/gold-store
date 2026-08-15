import type { ChannelAdapter } from "@/lib/notifications/types";
import { loadChannelConfig } from "@/lib/notifications/channel-config";

/**
 * WhatsApp adapter — Meta Cloud API / Twilio WA. Credentials are configured
 * from the admin panel and stored in notification_channels.config.
 */
export const whatsappAdapter: ChannelAdapter = {
  code: "whatsapp",
  name: "واتساب",
  async isConfigured() {
    const { config } = await loadChannelConfig("whatsapp");
    return Boolean(config.api_key || process.env.WHATSAPP_API_KEY);
  },
  async send({ recipient, message }) {
    const { config, enabled } = await loadChannelConfig("whatsapp");
    const apiKey = config.api_key || process.env.WHATSAPP_API_KEY;
    if (!enabled || !apiKey) {
      return { ok: false, errorMessage: "مزود واتساب غير مهيأ" };
    }
    // Placeholder for the provider call — implement send() against the
    // chosen provider here. Never log secrets.
    return { ok: false, errorMessage: `مزود واتساب غير مهيأ (للمستلم ${recipient})` };
  },
};

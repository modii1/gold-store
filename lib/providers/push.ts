import type { ChannelAdapter } from "@/lib/notifications/types";
import { loadChannelConfig } from "@/lib/notifications/channel-config";

/**
 * Browser Push adapter (Web Push / VAPID). Credentials are configured from
 * the admin panel and stored in notification_channels.config.
 */
export const pushAdapter: ChannelAdapter = {
  code: "push",
  name: "إشعارات المتصفح",
  async isConfigured() {
    const { config } = await loadChannelConfig("push");
    return Boolean(
      (config.vapid_public_key && config.vapid_private_key) ||
      (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
    );
  },
  async send({ recipient, title }) {
    const { config, enabled } = await loadChannelConfig("push");
    const configured =
      (config.vapid_public_key && config.vapid_private_key) ||
      (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
    if (!enabled || !configured) {
      return { ok: false, errorMessage: "إشعارات المتصفح غير مهيأة" };
    }
    // Placeholder for the provider call — implement web-push here.
    return { ok: false, errorMessage: `إشعارات المتصفح غير مهيأة (للمستلم ${recipient} — ${title})` };
  },
};

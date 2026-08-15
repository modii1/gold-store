import type { ChannelAdapter } from "@/lib/notifications/types";

/**
 * Browser Push adapter (Web Push / VAPID). Not configured in this deployment.
 */
export const pushAdapter: ChannelAdapter = {
  code: "push",
  name: "إشعارات المتصفح",
  isConfigured() {
    return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
  },
  async send({ recipient, title }) {
    if (!this.isConfigured()) {
      return { ok: false, errorMessage: "إشعارات المتصفح غير مهيأة" };
    }
    return { ok: false, errorMessage: `إشعارات المتصفح غير مهيأة (للمستلم ${recipient} — ${title})` };
  },
};

import type { ChannelAdapter } from "@/lib/notifications/types";
import { loadChannelConfig } from "@/lib/notifications/channel-config";

/**
 * Email adapter — provider-independent (Resend, SendGrid, SES, SMTP).
 * Credentials are configured from the admin panel and stored in
 * notification_channels.config; env vars are kept as a fallback.
 */
export const emailAdapter: ChannelAdapter = {
  code: "email",
  name: "البريد الإلكتروني",
  async isConfigured() {
    const { config } = await loadChannelConfig("email");
    return Boolean(
      config.api_key || config.provider || process.env.EMAIL_API_KEY || process.env.SMTP_HOST
    );
  },
  async send({ recipient, title }) {
    const { config, enabled } = await loadChannelConfig("email");
    const configured =
      config.api_key || config.provider || process.env.EMAIL_API_KEY || process.env.SMTP_HOST;
    if (!enabled || !configured) {
      return { ok: false, errorMessage: "مزود البريد الإلكتروني غير مهيأ" };
    }
    // Placeholder for the provider call — implement send() against the
    // chosen provider here. Never log secrets.
    return { ok: false, errorMessage: `مزود البريد الإلكتروني غير مهيأ (للمستلم ${recipient} — ${title})` };
  },
};

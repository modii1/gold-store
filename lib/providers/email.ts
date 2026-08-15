import type { ChannelAdapter } from "@/lib/notifications/types";

/**
 * Email adapter — provider-independent. Currently no SMTP/email provider is
 * configured, so it is reported as not configured and deliveries are skipped.
 * To activate: set EMAIL_API_KEY / EMAIL_FROM (or SMTP_*) and implement the
 * send() call to the chosen provider (Resend, SendGrid, SES, ...) here.
 */
export const emailAdapter: ChannelAdapter = {
  code: "email",
  name: "البريد الإلكتروني",
  isConfigured() {
    return Boolean(process.env.EMAIL_API_KEY || process.env.SMTP_HOST);
  },
  async send({ recipient, title, message }) {
    if (!this.isConfigured()) {
      return { ok: false, errorMessage: "مزود البريد الإلكتروني غير مهيأ" };
    }
    // Placeholder for the actual provider call. Never log secrets here.
    return { ok: false, errorMessage: `مزود البريد الإلكتروني غير مهيأ (للمستلم ${recipient} — ${title})` };
  },
};

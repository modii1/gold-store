import type { ChannelAdapter } from "@/lib/notifications/types";

/**
 * SMS adapter — provider-independent (Twilio, Unifonic, SMSA SMS, ...).
 * Activate by setting SMS_API_KEY / SMS_SENDER and implementing send().
 */
export const smsAdapter: ChannelAdapter = {
  code: "sms",
  name: "رسائل SMS",
  isConfigured() {
    return Boolean(process.env.SMS_API_KEY);
  },
  async send({ recipient, message }) {
    if (!this.isConfigured()) {
      return { ok: false, errorMessage: "مزود الرسائل SMS غير مهيأ" };
    }
    return { ok: false, errorMessage: `مزود الرسائل SMS غير مهيأ (للمستلم ${recipient})` };
  },
};

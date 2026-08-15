import type { ChannelAdapter } from "@/lib/notifications/types";

/**
 * WhatsApp adapter — planned for future use (Meta Cloud API / Twilio WA).
 * Keeping the contract in place so enabling it never touches the engine.
 */
export const whatsappAdapter: ChannelAdapter = {
  code: "whatsapp",
  name: "واتساب",
  isConfigured() {
    return Boolean(process.env.WHATSAPP_API_KEY);
  },
  async send({ recipient, message }) {
    if (!this.isConfigured()) {
      return { ok: false, errorMessage: "مزود واتساب غير مهيأ" };
    }
    return { ok: false, errorMessage: `مزود واتساب غير مهيأ (للمستلم ${recipient})` };
  },
};

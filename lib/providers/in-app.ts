import type { ChannelAdapter } from "@/lib/notifications/types";

/**
 * In-App adapter — the notification row itself is the delivery. This adapter
 * exists so the registry stays uniform; the dispatcher marks in-app deliveries
 * as delivered without calling send().
 */
export const inAppAdapter: ChannelAdapter = {
  code: "in_app",
  name: "داخل التطبيق",
  isConfigured() {
    return true;
  },
  async send() {
    return { ok: true, status: "delivered" };
  },
};

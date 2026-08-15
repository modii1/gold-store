import type { ChannelAdapter, ChannelCode } from "@/lib/notifications/types";
import { inAppAdapter } from "./in-app";
import { emailAdapter } from "./email";
import { smsAdapter } from "./sms";
import { pushAdapter } from "./push";
import { whatsappAdapter } from "./whatsapp";

/**
 * Channel Adapter registry — the Notification Engine never talks to a
 * provider directly. To swap a provider (e.g. Twilio -> WhatsApp), replace the
 * implementation of the corresponding adapter here; nothing else changes.
 */
const ADAPTERS: Record<ChannelCode, ChannelAdapter> = {
  in_app: inAppAdapter,
  email: emailAdapter,
  sms: smsAdapter,
  push: pushAdapter,
  whatsapp: whatsappAdapter,
};

export function getAdapter(code: ChannelCode): ChannelAdapter | null {
  return ADAPTERS[code] ?? null;
}

export function listAdapters(): ChannelAdapter[] {
  return Object.values(ADAPTERS);
}

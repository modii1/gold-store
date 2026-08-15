import { createAdminClient } from "@/lib/supabase/admin";
import type { Category, ChannelCode } from "./types";

/**
 * Customer preferences — essential categories (orders, payment, shipping,
 * returns) are never blocked entirely; only the marketing category is fully
 * opt-in. In-app is always enabled.
 */

const ESSENTIAL_CATEGORIES: Category[] = ["orders", "payment", "shipping", "returns"];

export async function getCustomerPreferences(
  customerIdentifier: string
): Promise<Record<Category, { in_app: boolean; email: boolean; sms: boolean; push: boolean }>> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("notification_preferences")
    .select("category, in_app_enabled, email_enabled, sms_enabled, push_enabled")
    .eq("customer_identifier", customerIdentifier);

  const defaults = {
    in_app: true,
    email: false,
    sms: true,
    push: false,
  };

  const result = {} as Record<Category, { in_app: boolean; email: boolean; sms: boolean; push: boolean }>;
  for (const category of ESSENTIAL_CATEGORIES) {
    result[category] = { ...defaults };
  }
  result.marketing = { in_app: false, email: false, sms: false, push: false };

  for (const row of data || []) {
    const cat = row.category as Category;
    if (result[cat]) {
      result[cat] = {
        in_app: row.in_app_enabled ?? true,
        email: row.email_enabled ?? false,
        sms: row.sms_enabled ?? true,
        push: row.push_enabled ?? false,
      };
    }
  }
  return result;
}

export function filterChannelsForCustomer(
  category: Category,
  channels: ChannelCode[],
  prefs: Record<Category, { in_app: boolean; email: boolean; sms: boolean; push: boolean }>
): ChannelCode[] {
  const p = prefs[category];
  if (!p) return channels.filter((c) => c === "in_app");
  const essential = ESSENTIAL_CATEGORIES.includes(category);
  return channels.filter((c) => {
    if (c === "in_app") return true;
    if (c === "email") return p.email || (!essential && false);
    if (c === "sms") return p.sms;
    if (c === "push") return p.push;
    return false;
  });
}

export async function saveCustomerPreferences(
  customerIdentifier: string,
  category: Category,
  values: { email?: boolean; sms?: boolean; push?: boolean; in_app?: boolean }
): Promise<void> {
  const supabase = createAdminClient();
  await supabase.from("notification_preferences").upsert(
    {
      customer_identifier: customerIdentifier,
      category,
      in_app_enabled: values.in_app ?? true,
      email_enabled: values.email ?? false,
      sms_enabled: values.sms ?? true,
      push_enabled: values.push ?? false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "customer_identifier,category" }
  );
}

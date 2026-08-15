import { createAdminClient } from "@/lib/supabase/admin";
import { BUILT_IN_TEMPLATES } from "./templates";
import { BUILT_IN_RULES } from "./rules";

/**
 * Seeds notification_templates / notification_rules from the built-in lists.
 * Idempotent — safe to run on every admin settings load.
 */
export async function seedNotificationDefaults(): Promise<void> {
  const supabase = createAdminClient();

  for (const t of BUILT_IN_TEMPLATES) {
    await supabase.from("notification_templates").upsert(
      { ...t, is_active: true, updated_at: new Date().toISOString() },
      { onConflict: "event_type" }
    );
  }

  const { data: existingRules } = await supabase
    .from("notification_rules")
    .select("event_type, name");

  const seen = new Set<string>();
  for (const r of existingRules || []) {
    seen.add(`${r.event_type}::${r.name}`);
  }

  for (const r of BUILT_IN_RULES) {
    if (seen.has(`${r.event_type}::${r.name}`)) continue;
    await supabase.from("notification_rules").insert({
      ...r,
      is_active: true,
      updated_at: new Date().toISOString(),
    });
  }
}

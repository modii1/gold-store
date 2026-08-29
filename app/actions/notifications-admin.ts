"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAdminSession } from "@/lib/auth";
import { validateTemplateVariables } from "@/lib/notifications/templates";
import type { ChannelCode, Rule } from "@/lib/notifications/types";

function ok() {
  return { success: true };
}

function fail(error: string) {
  return { success: false, error };
}

export async function requireAdminOrThrow(): Promise<boolean> {
  const isAdmin = await getAdminSession();
  if (!isAdmin) throw new Error("غير مصرح");
  return true;
}

export async function updateTemplateAction(formData: FormData) {
  try {
    await requireAdminOrThrow();
  } catch {
    return fail("غير مصرح");
  }

  const eventType = String(formData.get("event_type") || "");
  const name = String(formData.get("name") || "");
  const title = String(formData.get("title") || "");
  const body = String(formData.get("body") || "");
  const severity = String(formData.get("severity") || "info");
  const category = String(formData.get("category") || "orders");
  const channels = (formData.getAll("channels") as string[]).filter((c): c is ChannelCode =>
    ["in_app", "email", "sms", "push", "whatsapp"].includes(c)
  );
  const isActive = formData.get("is_active") === "on";

  if (!eventType || !name || !title || !body) return fail("املأ جميع الحقول المطلوبة");

  const unknown = validateTemplateVariables(title + " " + body);
  if (unknown.length > 0) {
    return fail(`متغيرات غير معروفة: ${unknown.join(", ")}`);
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("notification_templates").upsert(
    {
      event_type: eventType,
      name,
      title,
      body,
      severity,
      category,
      channels,
      is_active: isActive,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "event_type" }
  );

  if (error) return fail(error.message);
  revalidatePath("/admin/settings/notifications");
  return ok();
}

export async function updateRuleAction(formData: FormData) {
  try {
    await requireAdminOrThrow();
  } catch {
    return fail("غير مصرح");
  }

  const eventType = String(formData.get("event_type") || "");
  const name = String(formData.get("name") || "");
  const channels = (formData.getAll("channels") as string[]).filter((c): c is ChannelCode =>
    ["in_app", "email", "sms", "push", "whatsapp"].includes(c)
  );
  const recipients = (formData.getAll("recipients") as string[]).filter(Boolean);
  const isActive = formData.get("is_active") === "on";

  if (!eventType || !name) return fail("نوع الحدث واسم القاعدة مطلوبان");
  if (channels.length === 0) return fail("اختر قناة واحدة على الأقل");

  const supabase = createAdminClient();
  const { data: existing } = await supabase
    .from("notification_rules")
    .select("*")
    .eq("event_type", eventType);

  const rule: Omit<Rule, "is_active"> & { is_active: boolean } = {
    event_type: eventType,
    name,
    condition: (existing?.[0]?.condition as Record<string, unknown>) || {},
    channels,
    recipients,
    is_active: isActive,
  };

  if (existing && existing.length > 0) {
    const { error } = await supabase.from("notification_rules").update({ ...rule, updated_at: new Date().toISOString() }).eq("event_type", eventType);
    if (error) return fail(error.message);
  } else {
    const { error } = await supabase.from("notification_rules").insert({ ...rule, updated_at: new Date().toISOString() });
    if (error) return fail(error.message);
  }

  revalidatePath("/admin/settings/notifications");
  return ok();
}

export async function toggleTemplateAction(eventType: string, isActive: boolean) {
  try {
    await requireAdminOrThrow();
  } catch {
    return fail("غير مصرح");
  }
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("notification_templates")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("event_type", eventType);
  if (error) return fail(error.message);
  revalidatePath("/admin/settings/notifications");
  return ok();
}

export async function toggleRuleAction(eventType: string, isActive: boolean) {
  try {
    await requireAdminOrThrow();
  } catch {
    return fail("غير مصرح");
  }
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("notification_rules")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("event_type", eventType);
  if (error) return fail(error.message);
  revalidatePath("/admin/settings/notifications");
  return ok();
}

/** Save a channel's enabled flag + provider config from the admin panel. */
export async function updateChannelAction(formData: FormData) {
  try {
    await requireAdminOrThrow();
  } catch {
    return fail("غير مصرح");
  }

  const code = String(formData.get("code") || "");
  const enabled = formData.get("enabled") === "on";
  if (!["in_app", "email", "sms", "push", "whatsapp"].includes(code)) {
    return fail("قناة غير معروفة");
  }

  const supabase = createAdminClient();
  const { data: existing } = await supabase.from("notification_channels").select("code, config").eq("code", code);

  // Keep bridge-written status keys (connected/phone/last_seen/qr_state) intact.
  const prevConfig = (existing?.[0]?.config as Record<string, string> | null) || {};
  const editable: Record<string, string> = {};
  for (const field of ["provider", "api_key", "sender", "from_number", "phone_number_id", "from", "vapid_public_key", "vapid_private_key", "vapid_subject", "bridge_url", "bridge_api_key", "admin_number"]) {
    const value = String(formData.get(field) || "").trim();
    if (value) editable[field] = value;
  }
  const config: Record<string, string> = {
    ...prevConfig,
    ...editable,
  };

  if (existing && existing.length > 0) {
    const { error } = await supabase
      .from("notification_channels")
      .update({ enabled, config, updated_at: new Date().toISOString() })
      .eq("code", code);
    if (error) return fail(error.message);
  } else {
    const names: Record<string, string> = {
      in_app: "داخل التطبيق",
      email: "البريد الإلكتروني",
      sms: "رسائل SMS",
      push: "إشعارات المتصفح",
      whatsapp: "واتساب",
    };
    const { error } = await supabase
      .from("notification_channels")
      .insert({ code, name: names[code] || code, enabled, config });
    if (error) return fail(error.message);
  }

  revalidatePath("/admin/settings/notifications");
  return ok();
}

/** Master switch: temporarily pause ALL notification channels. */
export async function setNotificationsPausedAction(paused: boolean) {
  try {
    await requireAdminOrThrow();
  } catch {
    return fail("غير مصرح");
  }
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("settings")
    .update({ notifications_paused: paused })
    .eq("id", 1);
  if (error) return fail(error.message);
  revalidatePath("/admin/settings/notifications");
  revalidatePath("/admin/settings");
  return ok();
}

export async function resetTemplateAction(eventType: string) {
  try {
    await requireAdminOrThrow();
  } catch {
    return fail("غير مصرح");
  }
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("notification_templates")
    .select("*")
    .eq("event_type", eventType)
    .single();
  if (data) {
    const { error } = await supabase
      .from("notification_templates")
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .eq("event_type", eventType);
    if (error) return fail(error.message);
  }
  revalidatePath("/admin/settings/notifications");
  return ok();
}

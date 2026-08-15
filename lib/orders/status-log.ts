import { createAdminClient } from "@/lib/supabase/admin";

export async function logOrderStatusChange(
  orderId: string,
  oldStatus: string | null,
  newStatus: string,
  changedBy: string = "admin",
  note?: string
) {
  const supabase = createAdminClient();
  try {
    await supabase.from("order_status_log").insert({
      order_id: orderId,
      old_status: oldStatus,
      new_status: newStatus,
      changed_by: changedBy,
      note: note || null,
    });
  } catch {
    // table not migrated yet — skip logging
  }
}

export async function getOrderStatusLog(orderId: string) {
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("order_status_log")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });
    return data || [];
  } catch {
    return [];
  }
}

export async function getOrderNotes(orderId: string) {
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("order_notes")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });
    return data || [];
  } catch {
    return [];
  }
}

export async function addOrderNote(orderId: string, content: string, author: string = "admin", isInternal: boolean = true) {
  const supabase = createAdminClient();
  const { error } = await supabase.from("order_notes").insert({
    order_id: orderId,
    content,
    author,
    is_internal: isInternal,
  });
  if (error) throw new Error(error.message);
}

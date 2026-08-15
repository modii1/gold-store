"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth";
import { syncOtoShipments } from "@/lib/oto/sync";

export async function refreshOtoShipmentsAction() {
  const isAdmin = await getAdminSession();
  if (!isAdmin) return { success: false, error: "غير مصرح" };

  try {
    const result = await syncOtoShipments(100);
    revalidatePath("/admin/shipments");
    return { success: true, ...result };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

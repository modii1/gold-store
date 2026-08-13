"use server";

import { redirect } from "next/navigation";
import { clearAdminSession, clearCustomerSession } from "@/lib/auth";

export async function adminLogoutAction() {
  await clearAdminSession();
  redirect("/admin");
}

export async function customerLogoutAction() {
  await clearCustomerSession();
  redirect("/");
}

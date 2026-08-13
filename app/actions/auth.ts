"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { setAdminSession, setCustomerSession } from "@/lib/auth";

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

// ---------- ADMIN ----------

export async function adminLoginAction(formData: FormData) {
  const username = (formData.get("username") as string)?.trim() || "";
  const password = (formData.get("password") as string) || "";

  const expectedUser = process.env.ADMIN_USERNAME || "admin";
  const expectedPass = process.env.ADMIN_PASSWORD || "admin123";

  if (username !== expectedUser || password !== expectedPass) {
    return { error: "بيانات الدخول غير صحيحة" };
  }

  await setAdminSession();
  redirect("/admin/dashboard");
}

// ---------- CUSTOMER ----------

export async function registerCustomerAction(formData: FormData) {
  const name = (formData.get("name") as string).trim();
  const phone = normalizePhone(formData.get("phone") as string);
  const email = (formData.get("email") as string)?.trim() || null;
  const password = formData.get("password") as string;
  const confirm = formData.get("confirm") as string;

  if (name.length < 2) return { error: "أدخلي اسمك الكامل" };
  if (phone.length < 9) return { error: "رقم الجوال غير صحيح" };
  if (password.length < 6) return { error: "كلمة المرور يجب أن تكون 6 أحرف على الأقل" };
  if (password !== confirm) return { error: "كلمتا المرور غير متطابقتين" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_customer", {
    p_phone: phone,
    p_name: name,
    p_email: email,
    p_password: password,
  });

  if (error) {
    const msg = (error.message || "").toLowerCase();
    if (msg.includes("phone_exists") || msg.includes("duplicate key")) return { error: "رقم الجوال مسجل بالفعل — سجّلي الدخول" };
    return { error: `حدث خطأ أثناء التسجيل: ${error.message}` };
  }

  const customer = Array.isArray(data) ? data[0] : data;
  if (!customer) return { error: "حدث خطأ أثناء التسجيل" };

  await setCustomerSession({ id: customer.id, name: customer.name, phone: customer.phone });
  redirect("/account");
}

export async function customerLoginAction(formData: FormData) {
  const phone = normalizePhone(formData.get("phone") as string);
  const password = formData.get("password") as string;

  if (!phone || !password) return { error: "أدخلي رقم الجوال وكلمة المرور" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_customer_by_credentials", {
    p_phone: phone,
    p_password: password,
  });

  if (error) {
    return { error: `تعذر تسجيل الدخول: ${error.message}` };
  }
  if (!data || (Array.isArray(data) && data.length === 0)) {
    return { error: "رقم الجوال أو كلمة المرور غير صحيحة" };
  }

  const customer = Array.isArray(data) ? data[0] : data;
  await setCustomerSession({ id: customer.id, name: customer.name, phone: customer.phone });
  redirect("/account");
}

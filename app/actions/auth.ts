"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { setAdminSession, setCustomerSession } from "@/lib/auth";
import { normalizePhoneInternational, toLocalSaudiPhone } from "@/lib/format";
import { sendCustomerWhatsApp } from "@/lib/customer-messaging";

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
  const phone = normalizePhoneInternational(formData.get("phone") as string);
  const email = (formData.get("email") as string)?.trim() || null;
  const password = formData.get("password") as string;
  const confirm = formData.get("confirm") as string;

  if (name.length < 2) return { error: "أدخلي اسمك الكامل" };
  if (!phone) return { error: "رقم الجوال غير صحيح — الصيغة المسموحة: 9665xxxxxxxx (دولي)" };
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
  const input = (formData.get("phone") as string) || "";
  const password = formData.get("password") as string;

  if (!input || !password) return { error: "أدخلي رقم الجوال وكلمة المرور" };

  const normalized = normalizePhoneInternational(input);
  if (!normalized) return { error: "رقم الجوال غير صحيح — الصيغة المسموحة: 9665xxxxxxxx (دولي)" };

  const supabase = await createClient();
  // يُحاول بالصيغة الدولية أولاً، ثم بالصيغة المحلية القديمة (05xxxxxxxx)
  // لمطابقة العملاء المسجلين قبل توحيد الصيغة.
  const candidates = [normalized];
  const local = toLocalSaudiPhone(normalized);
  if (local && local !== normalized) candidates.push(local);

  let lastError: string | null = null;
  for (const candidate of candidates) {
    const { data, error } = await supabase.rpc("get_customer_by_credentials", {
      p_phone: candidate,
      p_password: password,
    });
    if (error) {
      lastError = error.message;
      continue;
    }
    if (data && (!Array.isArray(data) || data.length > 0)) {
      const customer = Array.isArray(data) ? data[0] : data;
      await setCustomerSession({ id: customer.id, name: customer.name, phone: customer.phone });
      redirect("/account");
    }
  }

  if (lastError) return { error: `تعذر تسجيل الدخول: ${lastError}` };
  return { error: "رقم الجوال أو كلمة المرور غير صحيحة" };
}

export async function customerForgotPasswordAction(formData: FormData) {
  const input = (formData.get("phone") as string) || "";
  const normalized = normalizePhoneInternational(input);
  if (!normalized) return { error: "رقم الجوال غير صحيح — الصيغة المسموحة: 9665xxxxxxxx (دولي)" };

  const admin = createAdminClient();
  let customer: { id: string; name: string; phone: string } | null = null;
  const { data: byNorm } = await admin.from("customers").select("id, name, phone").eq("phone", normalized).maybeSingle();
  if (byNorm) {
    customer = byNorm as { id: string; name: string; phone: string };
  } else {
    const local = toLocalSaudiPhone(normalized);
    if (local && local !== normalized) {
      const { data: byLocal } = await admin.from("customers").select("id, name, phone").eq("phone", local).maybeSingle();
      if (byLocal) customer = byLocal as { id: string; name: string; phone: string };
    }
  }

  // رسالة موحدة حتى لا يُكشف ما إذا كان الرقم مسجلاً أم لا
  if (!customer) return { success: true };

  const newPassword = String(Math.floor(100000 + Math.random() * 900000));
  const { error } = await admin.rpc("reset_customer_password", {
    p_phone: customer.phone,
    p_new_password: newPassword,
  });
  if (error) return { error: `تعذر إعادة تعيين كلمة المرور: ${error.message}` };

  await sendCustomerWhatsApp({
    phone: customer.phone,
    title: "كلمة مرور جديدة",
    message: `مرحباً ${customer.name}، تم إنشاء كلمة مرور جديدة لحسابك: ${newPassword}. استخدميها للدخول من صفحة تسجيل الدخول ومتابعة طلباتك ضمن "طلباتي".`,
    type: "customer.password_reset",
  });

  return { success: true };
}

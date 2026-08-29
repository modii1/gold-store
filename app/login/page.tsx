import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/storefront/auth-shell";
import { LoginForm } from "./login-form";
import { getCustomerSession } from "@/lib/auth";

export const metadata: Metadata = { title: "تسجيل الدخول | متجر لمعة للاكسسوارات المطلية" };

export default async function LoginPage() {
  if (await getCustomerSession()) redirect("/account");

  return (
    <AuthShell
      title="تسجيل الدخول"
      subtitle="أهلاً بعودتك — أدخلي بياناتك للمتابعة"
      footer={
        <>
          <p className="text-center text-sm text-stone-500">
            ليس لديك حساب؟{" "}
            <Link href="/register" className="font-bold text-gold-dark hover:text-gold transition">
              أنشئي حساباً
            </Link>
          </p>
          <Link href="/" className="mt-3 block text-center text-xs text-stone-400 hover:text-gold transition">
            العودة إلى المتجر
          </Link>
        </>
      }
    >
      <LoginForm />
    </AuthShell>
  );
}

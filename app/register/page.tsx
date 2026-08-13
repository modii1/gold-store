import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/storefront/auth-shell";
import { RegisterForm } from "./register-form";
import { getCustomerSession } from "@/lib/auth";

export const metadata: Metadata = { title: "إنشاء حساب | لمعة" };

export default async function RegisterPage() {
  if (await getCustomerSession()) redirect("/account");

  return (
    <AuthShell
      title="إنشاء حساب"
      subtitle="انضمي إلينا لتسوق وتتبعي طلباتك بسهولة"
      footer={
        <>
          <p className="text-center text-sm text-stone-500">
            لديك حساب بالفعل؟{" "}
            <Link href="/login" className="font-bold text-gold-dark hover:text-gold transition">
              سجّلي الدخول
            </Link>
          </p>
          <Link href="/" className="mt-3 block text-center text-xs text-stone-400 hover:text-gold transition">
            العودة إلى المتجر
          </Link>
        </>
      }
    >
      <RegisterForm />
    </AuthShell>
  );
}

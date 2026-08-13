import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth";
import { AdminLoginForm } from "./admin-login-form";
import { LayoutDashboard, Package, ShoppingCart, Settings } from "lucide-react";

export const metadata: Metadata = { title: "لوحة الإدارة | لمعة" };

const features = [
  { icon: Package, text: "إدارة المنتجات والصور والفيديوهات" },
  { icon: ShoppingCart, text: "متابعة الطلبات وتحديث حالاتها" },
  { icon: Settings, text: "تخصيص الموقع والإعدادات" },
];

export default async function AdminLoginPage() {
  if (await getAdminSession()) {
    redirect("/admin/dashboard");
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2 bg-ivory">
      {/* Branding panel */}
      <aside className="relative hidden overflow-hidden bg-ink lg:flex flex-col justify-between p-12 xl:p-16">
        <div className="absolute -top-24 -right-24 h-96 w-96 rounded-full bg-gold/10 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-gold-dark/20 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-gold to-gold-dark text-white">
            <LayoutDashboard className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-bold text-ivory">لوحة الإدارة</p>
            <p className="text-xs text-ivory/50">لمعة للاكسسوارات المطلية</p>
          </div>
        </div>

        <div className="relative">
          <p className="text-gold-light text-sm font-semibold tracking-[0.35em] uppercase">Admin Control</p>
          <h2 className="mt-4 text-4xl xl:text-5xl font-bold leading-tight text-ivory">
            إدارة متجرك<br />بانسيابية
          </h2>
          <div className="mt-10 space-y-4">
            {features.map((f) => (
              <div key={f.text} className="flex items-center gap-3 text-ivory/80">
                <span className="flex h-9 w-9 items-center justify-center rounded-full border border-gold/30 bg-white/5 text-gold-light">
                  <f.icon className="h-4 w-4" />
                </span>
                <span className="text-sm">{f.text}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-xs text-ivory/40">© {new Date().getFullYear()} لمعة — جميع الحقوق محفوظة</p>
      </aside>

      {/* Login form panel */}
      <main className="relative flex items-center justify-center px-4 py-12 lg:px-8">
        <div className="w-full max-w-sm slide-up">
          <div className="mb-8 lg:hidden flex items-center justify-center gap-2">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-gold to-gold-dark text-white">
              <LayoutDashboard className="h-5 w-5" />
            </span>
            <p className="font-bold text-ink">لوحة الإدارة</p>
          </div>

          <h1 className="text-2xl font-bold text-ink text-center">تسجيل الدخول</h1>
          <p className="mt-2 text-center text-sm text-stone-500">منطقة محمية — أدخلي بياناتك للمتابعة</p>

          <div className="mt-8">
            <AdminLoginForm />
          </div>

          <Link href="/" className="mt-8 block text-center text-xs text-stone-400 hover:text-gold transition">
            العودة إلى المتجر
          </Link>
        </div>
      </main>
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Package, ShoppingCart, Settings, Tag, FolderOpen, LogOut, Users, Truck, Zap, PackageSearch, RotateCcw, Bell, Settings2 } from "lucide-react";
import { adminLogoutAction } from "@/app/actions/logout";

const links = [
  { href: "/admin/dashboard", label: "الملخص", icon: LayoutDashboard },
  { href: "/admin/products", label: "المنتجات", icon: Package },
  { href: "/admin/categories", label: "التصنيفات", icon: FolderOpen },
  { href: "/admin/shipping", label: "الشحن", icon: Truck },
  { href: "/admin/oto", label: "إعدادات OTO", icon: Zap },
  { href: "/admin/shipments", label: "الشحنات", icon: PackageSearch },
  { href: "/admin/notifications", label: "الإشعارات", icon: Bell },
  { href: "/admin/settings/notifications", label: "إعدادات الإشعارات", icon: Settings2 },
  { href: "/admin/coupons", label: "أكواد الخصم", icon: Tag },
  { href: "/admin/orders", label: "الطلبات", icon: ShoppingCart },
  { href: "/admin/customers", label: "العملاء", icon: Users },
  { href: "/admin/returns", label: "المرتجعات", icon: RotateCcw },
  { href: "/admin/settings", label: "الإعدادات", icon: Settings },
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-full flex-col rounded-2xl border border-amber-100 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3 border-b border-amber-50 pb-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-gold to-gold-dark text-white font-bold text-lg">
          ذ
        </div>
        <div>
          <p className="text-sm font-bold text-stone-900">لوحة التحكم</p>
          <p className="text-xs text-stone-400">متجر الذهب</p>
        </div>
      </div>

      <nav className="mt-4 flex-1 space-y-1">
        {links.map((link) => {
          const isActive = pathname === link.href;
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                isActive ? "bg-amber-50 text-gold" : "text-stone-600 hover:bg-stone-50 hover:text-stone-900"
              }`}
            >
              <Icon className="h-5 w-5" />
              {link.label}
            </Link>
          );
        })}
      </nav>

      <form action={adminLogoutAction} className="border-t border-amber-50 pt-3">
        <button className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-stone-600 transition hover:bg-rose-50 hover:text-rose-600">
          <LogOut className="h-5 w-5" />
          تسجيل خروج
        </button>
      </form>
    </aside>
  );
}

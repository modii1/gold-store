"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Package, ShoppingCart, Settings, Users } from "lucide-react";

const links = [
  { href: "/admin/dashboard", label: "الملخص", icon: LayoutDashboard },
  { href: "/admin/products", label: "المنتجات", icon: Package },
  { href: "/admin/orders", label: "الطلبات", icon: ShoppingCart },
  { href: "/admin/customers", label: "العملاء", icon: Users },
  { href: "/admin/settings", label: "الإعدادات", icon: Settings },
];

export function AdminMobileNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 block border-t border-amber-100 bg-white shadow-2xl md:hidden">
      <div className="flex items-center justify-around py-1.5">
        {links.map((link) => {
          const isActive = pathname === link.href;
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex flex-col items-center gap-0.5 rounded-lg px-2 py-1 transition ${
                isActive ? "text-gold" : "text-stone-500"
              }`}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px] font-semibold leading-tight">{link.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

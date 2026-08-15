"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Package, ShoppingCart, Settings, Tag, FolderOpen, Users, Truck, Zap, PackageSearch, RotateCcw, Bell } from "lucide-react";

const links = [
  { href: "/admin/dashboard", label: "الملخص", icon: LayoutDashboard },
  { href: "/admin/products", label: "المنتجات", icon: Package },
  { href: "/admin/categories", label: "التصنيفات", icon: FolderOpen },
  { href: "/admin/shipping", label: "الشحن", icon: Truck },
  { href: "/admin/oto", label: "OTO", icon: Zap },
  { href: "/admin/shipments", label: "الشحنات", icon: PackageSearch },
  { href: "/admin/notifications", label: "الإشعارات", icon: Bell },
  { href: "/admin/coupons", label: "الخصومات", icon: Tag },
  { href: "/admin/orders", label: "الطلبات", icon: ShoppingCart },
  { href: "/admin/customers", label: "العملاء", icon: Users },
  { href: "/admin/returns", label: "المرتجعات", icon: RotateCcw },
  { href: "/admin/settings", label: "الإعدادات", icon: Settings },
];

export function AdminMobileNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 block border-t border-amber-100 bg-white shadow-2xl md:hidden">
      <div className="flex items-center overflow-x-auto py-1.5 scrollbar-hide">
        {links.map((link) => {
          const isActive = pathname === link.href;
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex shrink-0 flex-col items-center gap-0.5 rounded-lg px-3 py-1 transition ${
                isActive ? "text-gold" : "text-stone-500"
              }`}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px] font-semibold leading-tight whitespace-nowrap">{link.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

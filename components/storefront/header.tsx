"use client";

import { useState } from "react";
import Link from "next/link";
import { Search, Heart, User, ShoppingBag, Menu, X } from "lucide-react";
import { useCart, useFavorites } from "./providers";
import { AccountLink } from "./account-link";
import { BrandLogo } from "./brand-logo";
import { SearchOverlay } from "./search-overlay";
import { CartDrawer } from "./cart-drawer";
import type { Settings } from "@/types";
import type { Category } from "@/types";

export function StoreHeader({ settings, categories }: { settings: Settings; categories: Category[] }) {
  const { count, openCart } = useCart();
  const { favs } = useFavorites();
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const nav = categories.slice(0, 7);

  return (
    <>
      <header className="sticky top-0 z-50" style={{ fontSize: `${settings.header_footer_font_size || 14}px` }}>
        {settings.announcement && (
          <div className="bg-ink text-amber-100 text-center text-xs py-2 px-4 tracking-wide">
            {settings.announcement}
          </div>
        )}
        <div className="bg-ivory/95 backdrop-blur border-b border-sand">
          <div className="mx-auto max-w-7xl px-3 md:px-6">
            {/* 3 أعمدة متساوية على سطح المكتب: اللوغو (بداية)، الناف (منتصف)،
                الأيقونات (نهاية). منتصف العمود الأوسط = منتصف الـ Header بالضبط. */}
            <div className="grid grid-cols-[auto_1fr_auto] md:grid-cols-3 items-center h-16 md:h-20 gap-1 md:gap-4">
              {/* Mobile: menu button + Logo (start) */}
              <div className="flex items-center min-w-0 gap-1">
                <button onClick={() => setMenuOpen(true)} className="md:hidden text-ink p-1 shrink-0" aria-label="القائمة">
                  <Menu className="w-6 h-6" />
                </button>
                <div className="flex min-w-0 justify-start">
                  <BrandLogo settings={settings} />
                </div>
              </div>

              {/* Desktop nav — متمركز في المنتصف */}
                <nav className="hidden md:flex items-center justify-center gap-5 lg:gap-7 font-semibold text-stone-600" style={{ fontSize: `${settings.header_footer_font_size || 13}px` }}>
                <Link href="/" className="hover:text-gold transition whitespace-nowrap">الرئيسية</Link>
                {nav.map((c) => (
                  <Link key={c.id} href={`/category/${c.slug}`} className="hover:text-gold transition whitespace-nowrap">
                    {c.name}
                  </Link>
                ))}
                <Link href="/shop" className="hover:text-gold transition whitespace-nowrap">عروض</Link>
              </nav>

              {/* Icons (end) */}
              <div className="flex items-center justify-end gap-0.5 md:gap-2 shrink-0">
                <button onClick={() => setSearchOpen(true)} className="p-2 text-ink hover:text-gold transition" aria-label="بحث">
                  <Search className="w-5 h-5 md:w-6 md:h-6" />
                </button>
                <AccountLink className="hidden md:block p-2 text-ink hover:text-gold transition" />
                <Link href="/favorites" className="hidden sm:block p-2 text-ink hover:text-gold transition relative" aria-label="المفضلة">
                  <Heart className="w-5 h-5 md:w-6 md:h-6" />
                  {favs.size > 0 && (
                    <span className="absolute -top-0.5 -start-0.5 h-4 w-4 rounded-full bg-gold text-white text-[9px] flex items-center justify-center font-bold">
                      {favs.size}
                    </span>
                  )}
                </Link>
                <button onClick={openCart} className="p-2 text-ink hover:text-gold transition relative" aria-label="السلة">
                  <ShoppingBag className="w-5 h-5 md:w-6 md:h-6" />
                  {count > 0 && (
                    <span className="absolute -top-0.5 -start-0.5 h-4 w-4 rounded-full bg-gold text-white text-[9px] flex items-center justify-center font-bold">
                      {count}
                    </span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="fixed inset-0 z-[80] md:hidden">
          <div className="absolute inset-0 bg-ink/50 fade-in" onClick={() => setMenuOpen(false)} />
          <aside className="absolute inset-y-0 right-0 w-72 bg-ivory shadow-2xl drawer-in-right">
            <div className="flex items-center justify-between px-4 py-4 border-b border-sand bg-white">
              <p className="font-bold text-ink">القائمة</p>
              <button onClick={() => setMenuOpen(false)} className="text-stone-400 hover:text-ink">
                <X className="w-6 h-6" />
              </button>
            </div>
            <nav className="p-4 space-y-1" style={{ fontSize: `${settings.header_footer_font_size || 13}px` }}>
              <Link href="/" onClick={() => setMenuOpen(false)} className="block rounded-lg px-3 py-2.5 text-sm font-bold text-ink hover:bg-white transition">الرئيسية</Link>
              {categories.map((c) => (
                <Link key={c.id} href={`/category/${c.slug}`} onClick={() => setMenuOpen(false)} className="block rounded-lg px-3 py-2.5 text-sm font-semibold text-stone-600 hover:bg-white hover:text-gold transition">
                  {c.name}
                </Link>
              ))}
              <Link href="/shop" onClick={() => setMenuOpen(false)} className="block rounded-lg px-3 py-2.5 text-sm font-bold text-gold hover:bg-white transition">العروض</Link>
              <Link href="/account" onClick={() => setMenuOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold text-stone-600 hover:bg-white transition">
                <User className="w-4 h-4" /> حسابي
              </Link>              <Link href="/favorites" onClick={() => setMenuOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold text-stone-600 hover:bg-white transition">
                <Heart className="w-4 h-4" /> المفضلة
              </Link>
            </nav>
          </aside>
        </div>
      )}

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
      <CartDrawer settings={settings} />
    </>
  );
}

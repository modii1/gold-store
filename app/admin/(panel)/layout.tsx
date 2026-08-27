import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { AdminMobileNav } from "@/components/admin/admin-mobile-nav";
import { NotificationBell } from "@/components/notifications/notification-bell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await getAdminSession())) {
    redirect("/admin");
  }

  return (
    <div className="min-h-screen bg-stone-50 pb-16 md:pb-0">
      <div className="mx-auto flex max-w-screen-2xl gap-6 px-4 py-6 md:px-6 xl:px-10">
        <div className="hidden w-64 shrink-0 md:block xl:w-72">
          <div className="sticky top-6">
            <AdminSidebar />
          </div>
        </div>
        <main className="min-w-0 flex-1">
          <div className="mb-4 flex items-center justify-between rounded-2xl border border-amber-100 bg-white px-4 py-3 shadow-sm md:px-6">
            <div className="flex items-center gap-3">
              <span className="text-sm font-bold text-stone-900">اشعارات النظام</span>
              <span className="hidden text-xs text-stone-400 sm:inline">متجر الذهب — لوحة التحكم</span>
            </div>
            <NotificationBell scope="admin" />
          </div>
          <div className="rounded-2xl border border-amber-100 bg-white p-4 shadow-sm md:p-8">
            {children}
          </div>
        </main>
      </div>
      <AdminMobileNav />
    </div>
  );
}

import type { Severity } from "@/lib/notifications/types";

export function severityMeta(severity: string): { dot: string; badge: string; label: string } {
  switch (severity) {
    case "critical":
      return { dot: "bg-red-500", badge: "bg-red-50 text-red-600 border border-red-200", label: "حرج" };
    case "warning":
      return { dot: "bg-amber-500", badge: "bg-amber-50 text-amber-700 border border-amber-200", label: "تحذير" };
    case "success":
      return { dot: "bg-emerald-500", badge: "bg-emerald-50 text-emerald-700 border border-emerald-200", label: "نجاح" };
    default:
      return { dot: "bg-sky-500", badge: "bg-sky-50 text-sky-700 border border-sky-200", label: "معلومة" };
  }
}

export const CATEGORY_LABELS: Record<string, string> = {
  orders: "الطلبات",
  shipping: "الشحن",
  payment: "الدفع",
  returns: "المرتجعات",
  customer: "العملاء",
  system: "النظام",
  security: "الأمان",
  webhook: "Webhooks",
  marketing: "تسويق",
};

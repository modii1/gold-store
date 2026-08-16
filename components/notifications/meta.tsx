import { Fragment } from "react";
import type { ReactNode } from "react";
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

const URL_RE = /(https?:\/\/[^\s<>"'.,;،؛:()]+)/g;

/**
 * Renders a stored notification message, converting long URLs into a short
 * "اضغط هنا" link and dropping any leftover {{...}} placeholders from old
 * rows. `clickable` is false where the message sits inside a clickable button
 * (notification bell) to avoid nesting interactive elements.
 */
export function renderMessageWithLinks(message: string, linkClassName: string, clickable = true): ReactNode {
  const cleaned = message.replace(/\{\{[\w.]+\}\}/g, "").replace(/\s{2,}/g, " ").trim();
  const parts = cleaned.split(URL_RE);
  return parts.map((part, i) => {
    if (/^https?:\/\//.test(part)) {
      if (!clickable) return <span key={i} className={linkClassName}>اضغط هنا</span>;
      return (
        <a key={i} href={part} target="_blank" rel="noopener noreferrer" className={linkClassName}>
          اضغط هنا
        </a>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

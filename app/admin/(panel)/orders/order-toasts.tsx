"use client";

import { CheckCircle2, XCircle, Info, X } from "lucide-react";

export type Toast = {
  id: number;
  kind: "success" | "error" | "info";
  text: string;
};

const kindStyles: Record<Toast["kind"], { cls: string; icon: typeof CheckCircle2 }> = {
  success: { cls: "border-emerald-200 text-emerald-700", icon: CheckCircle2 },
  error: { cls: "border-red-200 text-red-600", icon: XCircle },
  info: { cls: "border-sky-200 text-sky-700", icon: Info },
};

export function ToastViewport({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-20 left-1/2 z-[120] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4 md:bottom-6" aria-live="polite">
      {toasts.map((t) => {
        const style = kindStyles[t.kind];
        const Icon = style.icon;
        return (
          <div
            key={t.id}
            role="status"
            className={`flex items-start gap-2 rounded-xl border bg-white p-3 shadow-lg shadow-black/5 ${style.cls}`}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="flex-1 text-sm font-semibold leading-snug">{t.text}</p>
            <button
              onClick={() => onDismiss(t.id)}
              aria-label="إغلاق الإشعار"
              className="shrink-0 text-stone-400 hover:text-stone-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

"use client";

import { useEffect } from "react";
import { X, AlertTriangle } from "lucide-react";

type Props = {
  open: boolean;
  title: string;
  danger?: boolean;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
};

export function Modal({ open, title, danger, onClose, children, footer, width = "max-w-md" }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className={`relative w-full ${width} max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl`}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-lg font-bold text-stone-900">
            {danger && <AlertTriangle className="h-5 w-5 text-rose-500" />}
            {title}
          </h3>
          <button onClick={onClose} aria-label="إغلاق" className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
        {footer && <div className="mt-5 flex flex-wrap items-center justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

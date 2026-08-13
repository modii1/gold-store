"use client";

import { useActionState, useState } from "react";
import { Phone, Mail, User, Lock, Eye, EyeOff, Loader2, UserPlus } from "lucide-react";
import { registerCustomerAction } from "@/app/actions/auth";

export function RegisterForm() {
  const [state, formAction, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => registerCustomerAction(formData),
    null
  ) as [null | Awaited<ReturnType<typeof registerCustomerAction>>, (fd: FormData) => void, boolean];
  const [show, setShow] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label className="mb-1.5 block text-sm font-bold text-ink">الاسم الكامل *</label>
        <div className="relative">
          <User className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gold" />
          <input name="name" required placeholder="مثال: نورة أحمد" className="input-lux pr-11 py-3" />
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-bold text-ink">رقم الجوال *</label>
        <div className="relative">
          <Phone className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gold" />
          <input name="phone" type="tel" required placeholder="05xxxxxxxx" dir="ltr" className="input-lux pr-11 py-3" />
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-bold text-ink">البريد الإلكتروني (اختياري)</label>
        <div className="relative">
          <Mail className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gold" />
          <input name="email" type="email" placeholder="you@example.com" dir="ltr" className="input-lux pr-11 py-3" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1.5 block text-sm font-bold text-ink">كلمة المرور *</label>
          <div className="relative">
            <Lock className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gold" />
            <input name="password" type={show ? "text" : "password"} required placeholder="6+ أحرف" dir="ltr"
              className="input-lux pr-11 pl-9 py-3" />
            <button type="button" onClick={() => setShow((s) => !s)}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 p-1 text-stone-400 hover:text-ink transition" aria-label="إظهار/إخفاء">
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-bold text-ink">تأكيد المرور *</label>
          <div className="relative">
            <Lock className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gold" />
            <input name="confirm" type={showConfirm ? "text" : "password"} required placeholder="تأكيد" dir="ltr"
              className="input-lux pr-11 pl-9 py-3" />
            <button type="button" onClick={() => setShowConfirm((s) => !s)}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 p-1 text-stone-400 hover:text-ink transition" aria-label="إظهار/إخفاء">
              {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>

      {state && "error" in state && state.error && (
        <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-ink py-3.5 font-bold text-ivory hover:bg-gold transition disabled:opacity-60"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
        إنشاء الحساب
      </button>
    </form>
  );
}

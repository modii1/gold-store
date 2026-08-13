"use client";

import { useActionState, useState } from "react";
import { User, Lock, Eye, EyeOff, Loader2, LogIn } from "lucide-react";
import { adminLoginAction } from "@/app/actions/auth";

export function AdminLoginForm() {
  const [state, formAction, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => adminLoginAction(formData),
    null
  ) as [null | Awaited<ReturnType<typeof adminLoginAction>>, (fd: FormData) => void, boolean];
  const [show, setShow] = useState(false);

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label className="mb-1.5 block text-sm font-bold text-ink">اسم المستخدم</label>
        <div className="relative">
          <User className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gold" />
          <input
            name="username"
            defaultValue="admin"
            autoComplete="username"
            dir="ltr"
            className="input-lux pr-11 py-3"
          />
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-bold text-ink">كلمة المرور</label>
        <div className="relative">
          <Lock className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gold" />
          <input
            name="password"
            type={show ? "text" : "password"}
            required
            autoComplete="current-password"
            placeholder="••••••••"
            dir="ltr"
            className="input-lux pr-11 pl-11 py-3"
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute left-3 top-1/2 -translate-y-1/2 p-1 text-stone-400 hover:text-ink transition"
            aria-label={show ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
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
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
        دخول اللوحة
      </button>
    </form>
  );
}

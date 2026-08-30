"use client";

import { useActionState, useEffect, useState } from "react";
import { Phone, Lock, Eye, EyeOff, Loader2, LogIn, KeyRound } from "lucide-react";
import { customerLoginAction, customerForgotPasswordAction } from "@/app/actions/auth";

const STORAGE_KEY = "gs_customer_login";

export function LoginForm() {
  const [state, formAction, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => customerLoginAction(formData),
    null
  ) as [null | Awaited<ReturnType<typeof customerLoginAction>>, (fd: FormData) => void, boolean];
  const [show, setShow] = useState(false);
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showReset, setShowReset] = useState(false);
  const [resetState, resetAction, resetPending] = useActionState(
    async (_prev: unknown, formData: FormData) => customerForgotPasswordAction(formData),
    null
  ) as [null | Awaited<ReturnType<typeof customerForgotPasswordAction>>, (fd: FormData) => void, boolean];

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      if (typeof saved.phone === "string") setPhone(saved.phone);
      if (typeof saved.password === "string") setPassword(saved.password);
    } catch {
      // ignore
    }
  }, []);

  const persist = (p: string, pw: string) => {
    setPhone(p);
    setPassword(pw);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ phone: p, password: pw }));
    } catch {
      // ignore
    }
  };

  return (
    <>
      <form action={formAction} className="space-y-5">
      <div>
        <label className="mb-1.5 block text-sm font-bold text-ink">رقم الجوال</label>
        <div className="relative">
          <Phone className="absolute end-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gold" />
          <input
            name="phone"
            type="tel"
            required
            value={phone}
            onChange={(e) => persist(e.target.value, password)}
            placeholder="9665xxxxxxxx"
            dir="ltr"
            className="input-lux pe-11 ps-4 py-3"
          />
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-bold text-ink">كلمة المرور</label>
        <div className="relative">
          <Lock className="absolute end-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gold" />
          <input
            name="password"
            type={show ? "text" : "password"}
            required
            value={password}
            onChange={(e) => persist(phone, e.target.value)}
            placeholder="••••••••"
            dir="ltr"
            className="input-lux pe-11 ps-11 py-3"
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute start-3 top-1/2 -translate-y-1/2 p-1 text-stone-400 hover:text-ink transition"
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
        تسجيل الدخول
      </button>

      <button type="button" onClick={() => setShowReset((s) => !s)} className="mx-auto flex items-center gap-1.5 text-xs font-bold text-gold hover:text-ink transition">
        <KeyRound className="h-3.5 w-3.5" /> نسيت كلمة المرور؟
      </button>
    </form>

    {showReset && (
      <form action={resetAction} className="mt-6 space-y-4 rounded-2xl border border-sand bg-cream/60 p-5">
        <p className="text-sm font-bold text-ink">إعادة تعيين كلمة المرور</p>
        <div className="relative">
          <Phone className="absolute end-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gold" />
          <input
            name="phone"
            type="tel"
            required
            placeholder="رقم الجوال — مثال: 9665xxxxxxxx"
            dir="ltr"
            className="input-lux pe-11 ps-4 py-3"
          />
        </div>
        {resetState && (
          <p className={`rounded-xl px-4 py-3 text-sm font-semibold ${resetState && "success" in resetState ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-600"}`}>
            {resetState && "success" in resetState
              ? "إذا كان الرقم مسجلاً، فسنرسل كلمة مرور جديدة عبر واتساب خلال لحظات."
              : resetState && "error" in resetState && resetState.error}
          </p>
        )}
        <button
          type="submit"
          disabled={resetPending}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-gold py-3 font-bold text-white hover:bg-ink transition disabled:opacity-60"
        >
          {resetPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          إرسال كلمة مرور جديدة
        </button>
      </form>
    )}
    </>
  );
}

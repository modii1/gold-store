"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PlugZap, Unplug, RefreshCw, Wallet, Zap, ShieldCheck, ExternalLink } from "lucide-react";
import {
  connectOtoAction,
  disconnectOtoAction,
  testOtoConnectionAction,
  registerWebhooksAction,
} from "@/app/actions/oto-admin";

type Config = {
  refresh_token_enc: string | null;
  access_token: string | null;
  company_id: string | null;
  store_name: string | null;
  package_name: string | null;
  remaining_credit: number | null;
  currency: string | null;
  validity_date: string | null;
  origin_city: string | null;
  origin_country: string | null;
  is_connected: boolean;
};

export function OtoManager({ initialConfig, envLabel }: { initialConfig: Config | null; envLabel: string }) {
  const router = useRouter();
  const [refreshToken, setRefreshToken] = useState("");
  const [originCity, setOriginCity] = useState(initialConfig?.origin_city || "Riyadh");
  const [originCountry, setOriginCountry] = useState(initialConfig?.origin_country || "SA");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [info, setInfo] = useState<{ companyId?: string; storeName?: string; packageName?: string; remainingCredit?: number; currency?: string; validityDate?: string } | null>(null);
  const [webhookResults, setWebhookResults] = useState<string[]>([]);

  const connected = initialConfig?.is_connected || false;

  const inputCls = "w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:border-gold focus:outline-none";
  const labelCls = "block text-xs font-semibold text-stone-600 mb-1";

  const connect = async () => {
    setLoading(true);
    setError("");
    setSuccess("");
    setWebhookResults([]);
    const fd = new FormData();
    if (refreshToken.trim()) fd.set("refresh_token", refreshToken.trim());
    fd.set("origin_city", originCity);
    fd.set("origin_country", originCountry);
    const res = await connectOtoAction(fd);
    setLoading(false);
    if (res.error) { setError(res.error); return; }
    setInfo(res.info || null);
    setSuccess("تم الربط بنجاح ✓ — حُدّث الرصيد والمعلومات");
    router.refresh();
  };

  const disconnect = async () => {
    if (!confirm("فصل حساب OTO؟ ستبقى الشركات مسجلة لكن دون أسعار حية.")) return;
    setLoading(true);
    setError("");
    await disconnectOtoAction();
    setLoading(false);
    setSuccess("تم الفصل");
    router.refresh();
  };

  const test = async () => {
    setLoading(true);
    setError("");
    setSuccess("");
    const res = await testOtoConnectionAction();
    setLoading(false);
    if (res.error) { setError(res.error); return; }
    setInfo(res.info);
    setSuccess("الاتصال سليم ✓");
  };

  const registerWebhooks = async () => {
    setLoading(true);
    setError("");
    setSuccess("");
    const res = await registerWebhooksAction();
    setLoading(false);
    if (res.error) { setError(res.error); return; }
    setWebhookResults((res.results || []).map((r) => `${r.type}: ${r.success ? "نُشط ✓" : "فشل — " + (r.error || r.message)}`));
    if (res.success) setSuccess("تم تفعيل الـ Webhooks");
  };

  const stat = "rounded-2xl border border-amber-100 bg-white p-4";
  const statLabel = "text-xs font-semibold text-stone-500";
  const statValue = "mt-1 text-xl font-bold text-stone-900";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">إعدادات OTO</h1>
          <p className="mt-1 text-sm text-stone-500">
            نظام الشحن الذكي — أسعار حية من شركات متعددة عبر حساب OTO واحد ({envLabel})
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${connected ? "bg-emerald-50 text-emerald-700" : "bg-stone-100 text-stone-500"}`}>
          {connected ? "متصل" : "غير متصل"}
        </span>
      </div>

      {error && <p className="text-sm font-semibold text-rose-600">{error}</p>}
      {success && <p className="text-sm font-semibold text-emerald-600">{success}</p>}
      {webhookResults.length > 0 && (
        <ul className="rounded-xl border border-amber-100 bg-white p-4 text-sm space-y-1">
          {webhookResults.map((r) => <li key={r}>{r}</li>)}
        </ul>
      )}

      {connected && initialConfig && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className={stat}>
            <p className={statLabel}>الرصيد المتبقي</p>
            <p className={statValue} dir="ltr">{Number(initialConfig.remaining_credit ?? 0).toLocaleString("en-US")} {initialConfig.currency || "SAR"}</p>
          </div>
          <div className={stat}>
            <p className={statLabel}>اسم المتجر</p>
            <p className="mt-1 font-bold text-stone-900 text-sm leading-relaxed">{initialConfig.store_name || "—"}</p>
          </div>
          <div className={stat}>
            <p className={statLabel}>الباقة</p>
            <p className={statValue}>{initialConfig.package_name || "—"}</p>
          </div>
          <div className={stat}>
            <p className={statLabel}>تاريخ الصلاحية</p>
            <p className={statValue}>{initialConfig.validity_date || "—"}</p>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-amber-100 bg-white p-5 space-y-4">
        <div className="flex items-center gap-2">
          <PlugZap className="w-5 h-5 text-gold" />
          <h2 className="font-bold text-stone-900">{connected ? "إعدادات الحساب" : "ربط حساب OTO"}</h2>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label>
            <span className={labelCls}>Refresh Token</span>
            <textarea value={refreshToken} onChange={(e) => setRefreshToken(e.target.value)}
              placeholder="الصق الـ refresh_token من Settings → API Integrations → Connect"
              rows={3} dir="ltr" className={inputCls + " font-mono text-xs"} />
          </label>
          <div className="grid gap-4">
            <label>
              <span className={labelCls}>مدينة الشحن (المصدر)</span>
              <input value={originCity} onChange={(e) => setOriginCity(e.target.value)} className={inputCls} dir="ltr" />
            </label>
            <label>
              <span className={labelCls}>دولة المصدر (ISO2)</span>
              <input value={originCountry} onChange={(e) => setOriginCountry(e.target.value)} className={inputCls} dir="ltr" maxLength={2} />
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-2">
          <button onClick={connect} disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl bg-gold px-4 py-2.5 text-sm font-bold text-white hover:bg-gold-light transition disabled:opacity-50">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlugZap className="w-4 h-4" />}
            {connected ? "تحديث الربط" : "ربط الحساب"}
          </button>
          {connected && (
            <>
              <button onClick={test} disabled={loading}
                className="inline-flex items-center gap-2 rounded-xl border border-stone-200 px-4 py-2.5 text-sm font-bold text-stone-700 hover:bg-stone-50 transition disabled:opacity-50">
                <RefreshCw className="w-4 h-4" /> اختبار الاتصال
              </button>
              <button onClick={registerWebhooks} disabled={loading}
                className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm font-bold text-violet-700 hover:bg-violet-100 transition disabled:opacity-50">
                <Zap className="w-4 h-4" /> تفعيل الـ Webhooks
              </button>
              <button onClick={disconnect} disabled={loading}
                className="inline-flex items-center gap-2 rounded-xl border border-rose-200 px-4 py-2.5 text-sm font-bold text-rose-600 hover:bg-rose-50 transition disabled:opacity-50">
                <Unplug className="w-4 h-4" /> فصل الحساب
              </button>
            </>
          )}
        </div>

        {info && (
          <div className="rounded-xl border border-amber-50 bg-amber-50/50 p-4 text-sm space-y-1">
            <p className="font-bold text-stone-800">معلومات الحساب:</p>
            <p>{info.storeName || "—"} {info.companyId ? `(${info.companyId})` : ""}</p>
            <p className="text-stone-500">{info.packageName || ""} — الرصيد: {info.remainingCredit ?? 0} {info.currency || "SAR"}{info.validityDate ? ` — صالح حتى ${info.validityDate}` : ""}</p>
          </div>
        )}

        <p className="text-xs text-stone-400 leading-relaxed">
          الـ refresh_token يُخزَّن مشفّراً (AES-256-GCM) في قاعدة البيانات ولا يُقرأ من خارج السيرفر.
          للتجربة الآمنة استخدم حساب Sandbox عبر <code dir="ltr">https://staging-api.tryoto.com</code>.
        </p>
      </div>

      <div className="rounded-2xl border border-amber-100 bg-white p-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-stone-600">
          <Wallet className="w-4 h-4 text-gold" />
          إدارة رصيد وشراء رصيد OTO يتم من لوحة OTO مباشرة
        </div>
        <a href="https://app.tryoto.com" target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-lg border border-stone-200 px-3 py-2 text-xs font-bold text-stone-600 hover:bg-stone-50">
          لوحة OTO <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {!connected && (
        <div className="rounded-2xl border border-amber-100 bg-white p-5">
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck className="w-5 h-5 text-gold" />
            <h2 className="font-bold text-stone-900">كيف يعمل النظام</h2>
          </div>
          <ul className="list-disc list-inside text-sm text-stone-600 space-y-1 leading-relaxed">
            <li>اسحب الـ refresh_token من حسابك في OTO والصقه أعلاه ثم اضغط «ربط الحساب».</li>
            <li>بعد الربط، تعرض صفحة «شركات الشحن» كل الشركات المتاحة بأسعارها الحية تلقائياً.</li>
            <li>يُحسب سعر الشحن في السلة حسب مدينة العميل ووزن المنتجات، مع دعم COD وFree shipping.</li>
            <li>تُنشأ الشحنة من صفحة الطلبات، ويظهر رقم التتبع والرابط للعميل.</li>
            <li>الـ Webhooks تُحدّث حالة الشحنة تلقائياً عند كل تغيير.</li>
          </ul>
        </div>
      )}
    </div>
  );
}

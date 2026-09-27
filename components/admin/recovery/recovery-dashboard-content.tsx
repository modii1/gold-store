"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Users, ShoppingCart, Package, Banknote, Receipt, RefreshCcw, AlertTriangle, EyeOff, Settings2, PowerOff, Power } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import type { ContactDecision, DiscountProposal } from "@/lib/recovery/types";
import type { RecoveryMetrics } from "@/lib/recovery/metrics";

type CaseRow = {
  id: string;
  customer: string | null;
  status: string;
  product: string | null;
  cartValue: number | null;
  priority: number;
  lastActivityAt: number;
  decision: ContactDecision | null;
  decisionNote: string | null;
  discountProposal: DiscountProposal | null;
  wouldSend: boolean;
  messageCount: number;
  suppressReason: string | null;
};

type Payload = {
  storageReady: boolean;
  enabled: boolean;
  metrics: RecoveryMetrics | null;
  cases: CaseRow[];
  message?: string;
};

const DECISION_LABEL: Record<ContactDecision, string> = {
  NO_INCENTIVE: "بدون حافز",
  REMINDER_ONLY: "تذكير فقط",
  DISCOUNT_ELIGIBLE: "مؤهل للخصم",
};

const STATUS_LABEL: Record<string, string> = {
  OPEN: "مفتوحة",
  ELIGIBLE: "مؤهلة",
  SCHEDULED: "مجدولة",
  CONTACTED: "تم التواصل",
  PURCHASED: "تم الشراء",
  EXPIRED: "منتهية",
  CANCELLED: "ملغاة",
  SUPPRESSED: "موقوفة",
};

function SystemStatus({ enabled }: { enabled: boolean }) {
  const off = !enabled;
  const view = off
    ? { label: "متوقف", hint: "النظام معطّل — لا متابعة ولا توصيات.", icon: <PowerOff className="h-4 w-4" />, cls: "border-stone-200 bg-stone-50 text-stone-600" }
    : { label: "مفعّل", hint: "النظام يعمل: متابعة الحالات وتحديثها وإغلاقها عند شراء موثّق.", icon: <Power className="h-4 w-4" />, cls: "border-emerald-200 bg-emerald-50 text-emerald-800" };

  return (
    <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${view.cls}`}>
      {view.icon}
      <div>
        <p className="text-sm font-bold">حالة النظام: {view.label}</p>
        <p className="text-[11px] opacity-80">{view.hint}</p>
      </div>
    </div>
  );
}

export function RecoveryDashboardContent() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async (): Promise<Payload | null> => {
    try {
      const res = await fetch("/api/recovery/dashboard", { cache: "no-store" });
      if (!res.ok) throw new Error("failed");
      return (await res.json()) as Payload;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const payload = await fetchData();
      if (cancelled) return;
      setData(payload);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchData]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const payload = await fetchData();
    setData(payload);
    setLoading(false);
  }, [fetchData]);

  const m = data?.metrics;

  const cards: { label: string; value: string; icon: React.ReactNode }[] = m
    ? [
        { label: "العملاء المحتمل استرجاعهم", value: String(m.potentialRecoveryCandidates), icon: <Users className="h-4 w-4" /> },
        { label: "عمليات غير مكتملة", value: String(m.incompleteOperations), icon: <ShoppingCart className="h-4 w-4" /> },
        { label: "دفع غير مكتمل", value: String(m.incompleteCheckouts), icon: <AlertTriangle className="h-4 w-4" /> },
        { label: "مؤهلون للخصم", value: String(m.discountEligible), icon: <Package className="h-4 w-4" /> },
        { label: "تمت استعادتهم", value: String(m.recovered), icon: <Banknote className="h-4 w-4" /> },
        { label: "معدل الاستعادة", value: `${m.recoveryRate}%`, icon: <Receipt className="h-4 w-4" /> },
        { label: "مبيعات مستعادة", value: formatCurrency(m.recoveredRevenue), icon: <Banknote className="h-4 w-4" /> },
        { label: "تكلفة الخصومات", value: formatCurrency(m.discountCost), icon: <Package className="h-4 w-4" /> },
        { label: "صافي المبيعات المستعادة", value: formatCurrency(m.netRecoveredRevenue), icon: <Banknote className="h-4 w-4" /> },
        { label: "رسائل مُنعت (فترة تهدئة)", value: String(m.cooldownBlocked), icon: <EyeOff className="h-4 w-4" /> },
      ]
    : [];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-stone-800">استعادة المبيعات</h1>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-stone-500">
            استعادة المبيعات التي لم تكتمل، من خلال متابعة العملاء الذين بدأوا السلة أو الدفع ولم يتموا الشراء.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/recovery/settings"
            className="inline-flex items-center gap-2 rounded-xl border border-amber-100 bg-white px-3 py-2 text-xs font-semibold text-stone-600 hover:bg-amber-50"
          >
            <Settings2 className="h-4 w-4" /> إعدادات استعادة المبيعات
          </Link>
          <button onClick={() => void refresh()} className="inline-flex items-center gap-2 rounded-xl border border-amber-100 bg-white px-3 py-2 text-xs font-semibold text-stone-600 hover:bg-amber-50" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />} تحديث
          </button>
        </div>
      </header>

      {data ? (
        <SystemStatus enabled={data.enabled} />
      ) : (
        <div className="flex items-center gap-3 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm font-semibold text-stone-600">
          <Loader2 className="h-4 w-4 animate-spin" /> جارٍ تحميل حالة النظام…
        </div>
      )}

      {data && !data.enabled && (
        <div className="flex items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-xs font-semibold text-stone-600">
          <PowerOff className="h-4 w-4" />
          النظام متوقف. لتفعيل المتابعة، راجع إعدادات استعادة المبيعات.
        </div>
      )}

      {data && !data.storageReady && (
        <div className="rounded-xl border border-sand bg-cream/40 px-4 py-3 text-xs text-stone-500">{data.message}</div>
      )}

      {data && data.storageReady && !m && (
        <div className="rounded-xl border border-sand bg-cream/40 px-4 py-3 text-xs text-stone-500">لا توجد بيانات بعد.</div>
      )}

      {m && (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {cards.map((c) => (
              <div key={c.label} className="rounded-2xl border border-amber-100 bg-white p-4">
                <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-stone-400">
                  {c.icon} {c.label}
                </div>
                <div className="text-xl font-bold text-stone-800">{c.value}</div>
              </div>
            ))}
          </section>

          <section className="overflow-x-auto rounded-2xl border border-amber-100 bg-white p-5">
            <h2 className="mb-3 text-sm font-bold text-stone-800">الحالات وقراراتها</h2>
            {data.cases.length === 0 ? (
              <p className="text-xs text-stone-400">لا توجد حالات متابعة مسجّلة بعد.</p>
            ) : (
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="border-b border-amber-50 text-[11px] text-stone-400">
                    <th className="px-2 py-2">العميل</th>
                    <th className="px-2 py-2">الحالة</th>
                    <th className="px-2 py-2">المنتج</th>
                    <th className="px-2 py-2">قيمة السلة</th>
                    <th className="px-2 py-2">الأولوية</th>
                    <th className="px-2 py-2">آخر نشاط</th>
                    <th className="px-2 py-2">القرار</th>
                    <th className="px-2 py-2">الإجراء المقترح</th>
                    <th className="px-2 py-2">الخصم المقترح</th>
                    <th className="px-2 py-2">حالة التواصل</th>
                  </tr>
                </thead>
                <tbody>
                  {data.cases.map((c) => (
                    <tr key={c.id} className="border-b border-amber-50/60 text-stone-600">
                      <td className="px-2 py-2">{c.customer || "زائر مجهول"}</td>
                      <td className="px-2 py-2">{STATUS_LABEL[c.status] || c.status}</td>
                      <td className="px-2 py-2">{c.product || "—"}</td>
                      <td className="px-2 py-2">{c.cartValue !== null ? formatCurrency(c.cartValue) : "—"}</td>
                      <td className="px-2 py-2">{c.priority}</td>
                      <td className="px-2 py-2">{new Date(c.lastActivityAt).toLocaleString("ar-EG")}</td>
                      <td className="px-2 py-2">{c.decision ? DECISION_LABEL[c.decision] : "—"}</td>
                      <td className="max-w-[220px] truncate px-2 py-2" title={c.decisionNote || undefined}>{c.decisionNote || "—"}</td>
                      <td className="px-2 py-2">{c.discountProposal ? `${c.discountProposal.percent}% (سقف ${formatCurrency(c.discountProposal.cap)})` : "—"}</td>
                      <td className="px-2 py-2">{c.wouldSend ? "سيُرسل (تشغيل تجريبي)" : c.suppressReason || "لا يُرسل"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}

import Link from "next/link";
import { CheckCircle2, XCircle, Database, Eye, PowerOff, Shell } from "lucide-react";
import type { DispatchSimulation } from "@/lib/recovery/dispatch-simulation";
import { formatCurrency } from "@/lib/format";

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

const CASE_TYPE_LABEL: Record<string, string> = {
  ADD_TO_CART: "إضافة للسلة",
  CHECKOUT_STARTED: "بدء إتمام الدفع",
  PAYMENT_STARTED: "بدء الدفع",
  PURCHASED: "شراء",
};

function Pill({ allow, label }: { allow: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-bold ${
        allow ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-700"
      }`}
    >
      {allow ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
      {label}
    </span>
  );
}

function TemplateCell({ item }: { item: DispatchSimulation }) {
  if (!item.stage) return <span className="text-stone-400">لا مرحلة محددة</span>;
  if (item.stage.templateId === null) {
    return <span className="text-stone-500">لا قالب مربوط — ستُرسل الرسالة الافتراضية</span>;
  }
  if (!item.template) {
    return <span className="font-semibold text-rose-700">القالب مفقود (id={item.stage.templateId})</span>;
  }
  const hint = item.template.isActive ? null : "غير مفعّل";
  return (
    <span className="font-semibold text-stone-700">
      {item.template.nameAr}
      <span className="text-stone-400"> ({item.template.key})</span>
      {hint ? <span className="mx-1 text-amber-600">· {hint}</span> : null}
    </span>
  );
}

function SimCard({ item, demo }: { item: DispatchSimulation; demo?: boolean }) {
  const stageLabel = item.stage
    ? `${item.stage.nameAr} (${item.stageIndex}/${item.stageTotal})`
    : "—";
  const used = item.render?.used ?? [];

  return (
    <div className={`space-y-3 rounded-2xl border p-4 ${item.allow ? "border-emerald-100" : "border-rose-100"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-stone-800">
          {demo && (
            <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
              بيانات استعراضية
            </span>
          )}
          <span>{item.customerMasked ?? "زائر مجهول"}</span>
          <span className="text-[11px] font-normal text-stone-400">{item.caseId}</span>
          <span className="rounded-md bg-stone-100 px-2 py-0.5 text-[10px] text-stone-500">
            {STATUS_LABEL[item.status] ?? item.status} · {CASE_TYPE_LABEL[item.caseType] ?? item.caseType}
          </span>
          <span className="rounded-md bg-stone-100 px-2 py-0.5 text-[10px] text-stone-500">
            السلة {item.cartValue !== null ? formatCurrency(item.cartValue) : "—"} · رسائل {item.messageCount}
          </span>
        </div>
        <Pill allow={item.allow} label={item.allow ? "سماح — ستُجدَّل" : "منع — بلا إرسال"} />
      </div>

      <p className={`text-xs font-semibold ${item.allow ? "text-emerald-700" : "text-rose-700"}`}>{item.reasonAr}</p>

      <div className="grid gap-2 text-xs sm:grid-cols-3">
        <div className="rounded-xl bg-stone-50 px-3 py-2">
          <div className="text-[10px] font-bold text-stone-400">المرحلة المختارة</div>
          <div className="mt-0.5 font-semibold text-stone-700">{stageLabel}</div>
        </div>
        <div className="rounded-xl bg-stone-50 px-3 py-2">
          <div className="text-[10px] font-bold text-stone-400">القالب المختار</div>
          <div className="mt-0.5">
            <TemplateCell item={item} />
          </div>
        </div>
        <div className="rounded-xl bg-stone-50 px-3 py-2">
          <div className="text-[10px] font-bold text-stone-400">القرار</div>
          <div className="mt-0.5 font-semibold text-stone-700">
            {item.decisionLabelAr || "—"}
            <span className="block text-[10px] font-normal text-stone-500">{item.outcome.recommendedAction}</span>
          </div>
        </div>
      </div>

      {item.allow && (
        <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 px-3 py-2.5">
          <div className="text-[10px] font-bold text-emerald-700">الرسالة النهائية (كما ستُرسَل)</div>
          <div className="mt-1 text-sm font-semibold text-stone-800">{item.finalTitle || "بلا عنوان"}</div>
          <p className="mt-0.5 whitespace-pre-line text-xs leading-6 text-stone-700">{item.finalMessage}</p>
        </div>
      )}

      {used.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-stone-100">
          <div className="border-b border-stone-100 bg-stone-50 px-3 py-1.5 text-[10px] font-bold text-stone-400">
            المتغيرات (من بيانات الحالة الفعلية)
          </div>
          <table className="w-full text-right text-[11px]">
            <tbody>
              {used.map((u) => (
                <tr key={u.name} className="border-b border-stone-50 last:border-0">
                  <td className="px-3 py-1.5 font-mono text-[10px] text-stone-500">{`{{${u.name}}}`}</td>
                  <td className="px-3 py-1.5 text-stone-700">
                    {u.internalOnly ? (
                      <span className="text-amber-600">داخلي — لا يصل للعميل</span>
                    ) : (
                      u.rendered
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-[10px] text-stone-400">
                    {u.internalOnly ? "—" : u.fromData ? "من البيانات" : "بديل آمن"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * محاكاة مسار الإرسال — عرض تقديري قراءة-فقط «القالب → المتغيرات →
 * الرسالة النهائية → سبب السماح/المنع». لا enqueue ولا notification ولا
 * WhatsApp — تعرض ما سيقرره dispatcher فعلًا بنفس القطعة.
 */
export function RecoveryDispatchSimulation({
  storageReady,
  enabled,
  dryRun,
  items,
  demo,
  error,
}: {
  storageReady: boolean;
  enabled: boolean;
  dryRun: boolean;
  items: DispatchSimulation[];
  demo: DispatchSimulation | null;
  error: string | null;
}) {
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div>
            <Link href="/admin/recovery" className="text-xs font-semibold text-stone-400 hover:text-stone-700">
              استعادة المبيعات ›
            </Link>
            <h1 className="mt-1 text-lg font-bold text-stone-800">محاكاة مسار الإرسال</h1>
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-stone-500">
            تُظهر لكل حالة نشطة: القالب المختار للمرحلة الحالية، المتغيرات المبنية من بياناتها، الرسالة النهائية،
            وسَبب السماح أو المنع — عبر نفس القطعة التي يستخدمها الإرسال فعليًا. هذه المحاكاة للعرض فقط: لا تُدرج أي
            إشعار ولا notification ولا WhatsApp.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-bold ${
              storageReady ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-700"
            }`}
          >
            <Database className="h-3.5 w-3.5" />
            {storageReady ? "التخزين جاهز" : "جداول الموافقة غير مُطبَّقة — مراحل افتراضية"}
          </span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-bold ${
              enabled ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-stone-200 bg-stone-50 text-stone-600"
            }`}
          >
            <PowerOff className="h-3.5 w-3.5" />
            {enabled ? "مفعّل" : "متوقف"}
          </span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-bold ${
              dryRun ? "border-amber-200 bg-amber-50 text-amber-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"
            }`}
          >
            <Eye className="h-3.5 w-3.5" />
            {dryRun ? "وضع المعاينة" : "إرسال مباشر"}
          </span>
        </div>
      </header>

      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">{error}</div>
      )}

      {items.length === 0 && !demo && (
        <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-xs font-semibold text-stone-600">
          لا توجد حالات نشطة للعرض.
        </div>
      )}

      {items.length > 0 && (
        <>
          <div className="flex items-center gap-2 text-xs font-semibold text-stone-500">
            <Shell className="h-4 w-4" />
            الحالات النشطة ({items.length})
          </div>
          {items.map((item) => (
            <SimCard key={item.caseId} item={item} />
          ))}
        </>
      )}

      {demo && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-700">
            <Eye className="h-4 w-4" />
            استعراض ببيانات افتراضية — لا توجد حالات نشطة، يُبنى المثال من بيانات وهمية معرّفة في الكود فقط:
          </div>
          <SimCard item={demo} demo />
        </div>
      )}
    </div>
  );
}
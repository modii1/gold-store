import Link from "next/link";
import { ArrowRight, FlaskConical, Power, PowerOff, ShieldCheck, Info } from "lucide-react";

export type RecoveryStatus = "off" | "trial" | "live";

export function recoveryStatusOf(enabled: boolean, dryRun: boolean): RecoveryStatus {
  if (!enabled) return "off";
  return dryRun ? "trial" : "live";
}

const STATUS_VIEW: Record<RecoveryStatus, { label: string; cls: string }> = {
  off: { label: "متوقف", cls: "border-stone-200 bg-stone-50 text-stone-600" },
  trial: { label: "تشغيل تجريبي", cls: "border-amber-200 bg-amber-50 text-amber-800" },
  live: { label: "مفعّل", cls: "border-emerald-200 bg-emerald-50 text-emerald-800" },
};

/**
 * إعدادات استعادة المبيعات — عرض فقط.
 *
 * التشغيل لا يُضبط من هنا: محرّك الاستعادة يقرأ حالة التشغيل من إعدادات النشر
 * (متغيرات بيئة الخادم)، لا من قاعدة البيانات. لذلك هذه الصفحة تعرض الحالة
 * الفعلية فقط، ولا تكتب أي إعداد ولا تلمس أي مفتاح تشفير أو مصادقة.
 */
export function RecoverySettingsContent({ enabled, dryRun }: { enabled: boolean; dryRun: boolean }) {
  const status = recoveryStatusOf(enabled, dryRun);
  const view = STATUS_VIEW[status];

  return (
    <div className="space-y-6">
      <header>
        <Link href="/admin/recovery" className="inline-flex items-center gap-1 text-xs font-semibold text-stone-400 hover:text-stone-700">
          <ArrowRight className="h-3.5 w-3.5" /> العودة إلى استعادة المبيعات
        </Link>
        <h1 className="mt-2 text-lg font-bold text-stone-800">إعدادات استعادة المبيعات</h1>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-stone-500">
          التحكم في حالة النظام وطريقة عمله. الأرقام والتوصيات تُقرأ من نظام استعادة المبيعات.
        </p>
      </header>

      <section className="space-y-3 rounded-2xl border border-amber-100 bg-white p-5">
        <h2 className="text-sm font-bold text-stone-800">حالة النظام</h2>
        <div className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold ${view.cls}`}>
          {status === "off" ? <PowerOff className="h-4 w-4" /> : status === "trial" ? <FlaskConical className="h-4 w-4" /> : <Power className="h-4 w-4" />}
          {view.label}
        </div>
        <p className="text-xs leading-5 text-stone-500">
          {status === "off" && "النظام متوقف: لا تُجمع إشارات متابعة ولا تُحسب توصيات."}
          {status === "trial" && "تشغيل تجريبي: تُقرأ الإشارات وتُحسب التوصيات، دون إرسال أي رسالة أو إنشاء أي كود خصم."}
          {status === "live" && "النظام مفعّل في وضع التشغيل الفعلي."}
        </p>
      </section>

      <section className="space-y-3 rounded-2xl border border-amber-100 bg-white p-5">
        <h2 className="text-sm font-bold text-stone-800">التفعيل</h2>

        <div className="flex items-center justify-between gap-4 rounded-xl border border-stone-200 bg-stone-50/60 p-4">
          <div>
            <p className="text-sm font-semibold text-stone-700">تفعيل استعادة المبيعات</p>
            <p className="mt-0.5 text-[11px] leading-5 text-stone-500">
              الحالة الافتراضية عند النشر: <span className="font-bold">متوقف (OFF)</span>. التشغيل لا يمكن تفعيله من لوحة التحكم.
            </p>
          </div>
          <div
            role="switch"
            aria-checked={enabled}
            aria-disabled="true"
            aria-label="تفعيل استعادة المبيعات"
            title="يتطلب تغيّرًا في إعدادات النشر من طرف إدارة المتجر"
            className={`relative h-7 w-12 shrink-0 rounded-full transition ${enabled ? "bg-emerald-500" : "bg-stone-300"}`}
          >
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${enabled ? "right-1" : "right-6"}`} />
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-xl border border-stone-200 bg-white p-4 text-[11px] leading-5 text-stone-500">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" />
          <p>
            مفتاح التفعيل محفوظ ضمن إعدادات النشر على الخادم، وليس في قاعدة بيانات المتجر، حتى لا يتغيّر سلوك النظام بالخطأ من داخل اللوحة.
            لتفعيله: يحدّثه المسؤول من إعدادات النشر ثم يعيد النشر. ويبقى وضع التشغيل التجريبي هو الخيار الآمن: يعرض التوصيات فقط بلا أي إرسال.
          </p>
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-amber-100 bg-white p-5">
        <h2 className="text-sm font-bold text-stone-800">السلامة والخصوصية</h2>
        <ul className="space-y-2 text-[11px] leading-5 text-stone-500">
          <li className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" />
            لا تعرض هذه الصفحة أي مفاتيح أو أسرار، ولا تتيح تعديل أي منها.
          </li>
          <li className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" />
            أرقام العملاء معروضة بشكل مخفي جزئيًا؛ لا تظهر أرقام هواتف كاملة في هذه الشاشة.
          </li>
          <li className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" />
            لا يوجد في النظام أي مسار إرسال رسائل أو إنشاء أكواد خصم؛ العرض توصيات فقط.
          </li>
        </ul>
      </section>
    </div>
  );
}

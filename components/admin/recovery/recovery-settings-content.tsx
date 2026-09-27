import Link from "next/link";
import { ArrowRight, Power, PowerOff, ShieldCheck, Info } from "lucide-react";
import { setRecoveryEnabled } from "@/app/admin/recovery-actions";

/**
 * إعدادات استعادة المبيعات — مفتاح تشغيل حقيقي.
 *
 * مصدر الحقيقة: settings.recovery_enabled (تعديل جزئي على عمود واحد).
 * OFF (الافتراضي) يمنع الاستيعاب والتقييم والمعالجة بالكامل.
 * ON يسمح بالوظائف الموجودة فعلًا في محرّك الاستعادة فقط: استيعاب
 * الإشارات، تسجيل/تحديث الحالات، التقييم والترتيب، وإغلاق الحالة عند
 * شراء موثّق. لا يوجد ولا يُضاف أي إرسال رسائل أو إنشاء أكواد خصم.
 */
export function RecoverySettingsContent({ enabled }: { enabled: boolean }) {
  return (
    <div className="space-y-6">
      <header>
        <Link href="/admin/recovery" className="inline-flex items-center gap-1 text-xs font-semibold text-stone-400 hover:text-stone-700">
          <ArrowRight className="h-3.5 w-3.5" /> العودة إلى استعادة المبيعات
        </Link>
        <h1 className="mt-2 text-lg font-bold text-stone-800">إعدادات استعادة المبيعات</h1>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-stone-500">
          التحكم في تشغيل النظام. عند التشغيل: متابعة الحالات وتحديثها وترتيب أولوياتها، وإغلاق الحالة عند شراء موثّق.
        </p>
      </header>

      <section className="space-y-3 rounded-2xl border border-amber-100 bg-white p-5">
        <h2 className="text-sm font-bold text-stone-800">حالة النظام</h2>
        <div className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold ${enabled ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-stone-200 bg-stone-50 text-stone-600"}`}>
          {enabled ? <Power className="h-4 w-4" /> : <PowerOff className="h-4 w-4" />}
          {enabled ? "مفعّل" : "متوقف"}
        </div>
        <p className="text-xs leading-5 text-stone-500">
          {enabled
            ? "النظام يعمل: تُتابَع الحالات السلة والدفع غير المكتملة، وتُحدَّث أولوياتها، وتُغلق الحالة عند شراء موثّق."
            : "النظام متوقف: لا تُجمع إشارات متابعة ولا تُحسب توصيات ولا تُجرى أي معالجة."}
        </p>
      </section>

      <section className="space-y-3 rounded-2xl border border-amber-100 bg-white p-5">
        <h2 className="text-sm font-bold text-stone-800">التفعيل</h2>

        <form action={setRecoveryEnabled} className="flex items-center justify-between gap-4 rounded-xl border border-stone-200 bg-stone-50/60 p-4">
          <div>
            <p className="text-sm font-semibold text-stone-700">تفعيل استعادة المبيعات</p>
            <p className="mt-0.5 text-[11px] leading-5 text-stone-500">
              الحالة الافتراضية: <span className="font-bold">متوقف (OFF)</span>. الحفظ يغيّر هذا المفتاح فقط دون المساس بأي إعداد آخر.
            </p>
          </div>
          <button
            type="submit"
            name="recovery_enabled"
            value={enabled ? "off" : "on"}
            role="switch"
            aria-checked={enabled}
            aria-label="تفعيل استعادة المبيعات"
            className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition ${enabled ? "bg-emerald-500 text-white" : "bg-stone-300 text-stone-500"}`}
            title={enabled ? "إيقاف النظام" : "تشغيل النظام"}
          >
            {enabled ? <Power className="h-4 w-4" /> : <PowerOff className="h-4 w-4" />}
          </button>
        </form>

        <div className="flex items-start gap-2 rounded-xl border border-stone-200 bg-white p-4 text-[11px] leading-5 text-stone-500">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" />
          <p>
            مفتاح التشغيل محفوظ في قاعدة بيانات المتجر ضمن إعداداته، ولا يُعدّل أي إعداد آخر. تغييره لا يكشف أي أسرار ولا يتيح تعديلها من هنا.
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
            لا يوجد في النظام أي مسار إرسال رسائل أو إنشاء أكواد خصم أو خصومات؛ роль النظام التتبّع والتسجيل فقط.
          </li>
        </ul>
      </section>
    </div>
  );
}

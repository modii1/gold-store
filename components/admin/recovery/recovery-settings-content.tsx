"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Power,
  PowerOff,
  ShieldCheck,
  Info,
  Database,
  Settings2,
  ListOrdered,
  Eye,
  Save,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { setRecoveryEnabled } from "@/app/admin/recovery-actions";
import { saveRecoverySettingsAction, previewRecoverySettingsAction } from "@/app/admin/recovery-control-actions";
import type { RecoveryPlanPreviewResult } from "@/app/admin/recovery-control-actions";
import { SETTING_FIELDS, SETTING_GROUPS } from "@/lib/recovery/control-schema";
import type { RecoveryConfig } from "@/lib/recovery/config";
import type { RecoveryConfigSource } from "@/lib/recovery/settings-store";

/**
 * إعدادات استعادة المبيعات — مفتاح التشغيل + الإعدادات المتقدمة.
 *
 * الكتابة محمية: الفحص الكامل في الخادم (parseSettingsInput) قبل أي حفظ،
 * وأي قيمة غير صالحة تُرفض مع رسالة عربية. الحفظ يؤثّر على التقييم
 * والجدولة فقط — لا يمسّ مسار الإرسال القائم (notifications → qr-server).
 */

type Props = {
  enabled: boolean;
  dryRun: boolean;
  storageReady: boolean;
  settingsSource: RecoveryConfigSource;
  stagesSource: RecoveryConfigSource;
  readErrors: { settings: string | null; stages: string | null };
  currentConfig: RecoveryConfig;
  templatesCount: number;
  templatesError: string | null;
};

const SOURCE_LABEL: Record<RecoveryConfigSource, string> = {
  db: "قاعدة البيانات",
  env: "البيئة",
  empty: "الافتراضي",
};

function initialDraft(cfg: RecoveryConfig): Record<string, string> {
  const out: Record<string, string> = {};
  const record = cfg as unknown as Record<string, unknown>;
  for (const f of SETTING_FIELDS) {
    if (f.kind === "score") {
      const scoreKey = f.key.replace(/^scores\./, "");
      out[f.key] = String(cfg.scores[scoreKey as keyof RecoveryConfig["scores"]] ?? "");
    } else if (f.kind === "boolean") {
      out[f.key] = record[f.key] === true ? "true" : "false";
    } else {
      out[f.key] = String(record[f.key] ?? "");
    }
  }
  return out;
}

export function RecoverySettingsContent(props: Props) {
  const { enabled, dryRun, storageReady, settingsSource, stagesSource, readErrors, currentConfig, templatesCount, templatesError } = props;
  const router = useRouter();

  const [draft, setDraft] = useState<Record<string, string>>(() => initialDraft(currentConfig));
  const [preview, setPreview] = useState<RecoveryPlanPreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const invalidFieldKeys = useMemo(() => {
    const keys = new Set<string>();
    if (!preview || preview.ok) return keys;
    for (const err of preview.errors) {
      const matched = SETTING_FIELDS.find((f) => err.includes(f.labelAr));
      if (matched) keys.add(matched.key);
    }
    return keys;
  }, [preview]);

  const set = (key: string, value: string) => setDraft((d) => ({ ...d, [key]: value }));

  async function runPreview() {
    setPreviewing(true);
    setMessage(null);
    try {
      const result = await previewRecoverySettingsAction(draft);
      setPreview(result);
    } finally {
      setPreviewing(false);
    }
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const result = await saveRecoverySettingsAction(draft);
      if (result.ok) {
        setMessage({ kind: "ok", text: "حُفظت الإعدادات وأصبحت سارية على التقييم والجدولة فورًا." });
        router.refresh();
      } else {
        setMessage({ kind: "error", text: result.error ?? "تعذّر الحفظ." });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href="/admin/recovery" className="inline-flex items-center gap-1 text-xs font-semibold text-stone-400 hover:text-stone-700">
              <ArrowRight className="h-3.5 w-3.5" /> لوحة استعادة المبيعات
            </Link>
            <h1 className="mt-2 text-lg font-bold text-stone-800">إعدادات استعادة المبيعات</h1>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-stone-500">
              مفتاح التشغيل، ثم الإعدادات المتقدمة التي تتحكم في التقييم والجدولة. كل تغيير يُعاين قبل الحفظ.
            </p>
          </div>
          <Link
            href="/admin/recovery/stages"
            className="inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-bold text-stone-600 hover:border-amber-300 hover:text-gold"
          >
            <ListOrdered className="h-4 w-4" /> إدارة مراحل الاسترجاع
          </Link>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Chip tone={enabled ? "ok" : "warn"} icon={enabled ? <Power className="h-3.5 w-3.5" /> : <PowerOff className="h-3.5 w-3.5" />}>
            {enabled ? "النظام مفعّل" : "النظام متوقف"}
          </Chip>
          <Chip tone={(dryRun ? "warn" : "ok") as "ok" | "warn"} icon={<Eye className="h-3.5 w-3.5" />}>
            {dryRun ? "وضع المعاينة (لا إرسال)" : "إرسال مباشر"}
          </Chip>
          <Chip tone={storageReady ? "ok" : "warn"} icon={<Database className="h-3.5 w-3.5" />}>
            {storageReady ? "التخزين جاهز" : "التخزين غير مُطبَّق"}
          </Chip>
          <Chip tone="info" icon={<Settings2 className="h-3.5 w-3.5" />}>
            مصدر القيم: {SOURCE_LABEL[settingsSource]} · المراحل: {SOURCE_LABEL[stagesSource]}
          </Chip>
          <Chip tone="info" icon={<ListOrdered className="h-3.5 w-3.5" />}>
            القوالب: {templatesCount}
          </Chip>
        </div>
      </header>

      {!storageReady && (
        <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-bold">إعداداتك لن تُحفظ بعد — التخزين غير مُطبَّق.</p>
            <p className="mt-1 opacity-90">
              جداول {readErrors.settings ? "الإعدادات" : ""}
              {readErrors.stages ? (readErrors.settings ? " والمراحل" : "المراحل") : ""} غير موجودة بعد (تُنشأ بتطبيق migration-037/038).
              يمكنك معاينة الأثر وإعداد القيم، لكن الحفظ سيفشل حتى التطبيق.
            </p>
          </div>
        </div>
      )}

      {/* مفتاح التشغيل */}
      <section className="space-y-3 rounded-2xl border border-amber-100 bg-white p-5">
        <h2 className="text-sm font-bold text-stone-800">حالة النظام</h2>
        <div className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold ${enabled ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-stone-200 bg-stone-50 text-stone-600"}`}>
          {enabled ? <Power className="h-4 w-4" /> : <PowerOff className="h-4 w-4" />}
          {enabled ? "مفعّل" : "متوقف"}
        </div>
        <form action={setRecoveryEnabled} className="flex items-center justify-between gap-4 rounded-xl border border-stone-200 bg-stone-50/60 p-4">
          <div>
            <p className="text-sm font-semibold text-stone-700">تفعيل استعادة المبيعات</p>
            <p className="mt-0.5 text-[11px] leading-5 text-stone-500">
              الحالة الافتراضية: <span className="font-bold">متوقف (OFF)</span>. الحفظ يغيّر هذا المفتاح فقط.
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
      </section>

      {/* الإعدادات المتقدمة */}
      <section className="space-y-4 rounded-2xl border border-amber-100 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-stone-800">الإعدادات المتقدمة</h2>
            <p className="mt-0.5 text-[11px] leading-5 text-stone-500">
              القيم المعروضة هي الفعّالة الآن. عند الحفظ تُحفظ كتجاوزات في recovery_settings وتُصبح مصدر الحقيقة.
            </p>
          </div>
          <button
            type="button"
            onClick={runPreview}
            disabled={previewing}
            className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 hover:border-amber-300 disabled:opacity-50"
          >
            {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
            معاينة ما سيحدث
          </button>
        </div>

        {preview && !preview.ok && (
          <div className="space-y-1 rounded-xl border border-rose-200 bg-rose-50 p-4">
            <p className="text-xs font-bold text-rose-700">لا يمكن الحفظ — القيم التالية غير صالحة:</p>
            <ul className="space-y-1">
              {preview.errors.map((e, i) => (
                <li key={i} className="text-[11px] leading-5 text-rose-600">
                  • {e}
                </li>
              ))}
            </ul>
          </div>
        )}

        {preview && preview.ok && (
          <PreviewPanel preview={preview} />
        )}

        <div className="space-y-6">
          {SETTING_GROUPS.map((group) => {
            const fields = SETTING_FIELDS.filter((f) => f.group === group.key);
            return (
              <fieldset key={group.key} className="space-y-3 rounded-xl border border-stone-200 p-4">
                <legend className="px-2 text-xs font-bold text-stone-700">{group.labelAr}</legend>
                <p className="text-[11px] leading-5 text-stone-400">{group.hintAr}</p>
                <div className="grid gap-3 md:grid-cols-2">
                  {fields.map((f) => {
                    const error = invalidFieldKeys.has(f.key);
                    return (
                      <div key={f.key} className={`rounded-xl border p-3 ${error ? "border-rose-300 bg-rose-50/40" : "border-stone-100 bg-stone-50/50"}`}>
                        <label className="block text-xs font-bold text-stone-700">{f.labelAr}</label>
                        <p className="mb-2 mt-0.5 text-[10px] leading-4 text-stone-400">{f.helpAr}</p>
                        {f.kind === "boolean" ? (
                          <div className="flex items-center gap-1">
                            {["n", "y"].map((v) => (
                              <button
                                key={v}
                                type="button"
                                onClick={() => set(f.key, v === "y" ? "true" : "false")}
                                className={`rounded-lg px-3 py-1 text-[11px] font-bold transition ${
                                  draft[f.key] === (v === "y" ? "true" : "false")
                                    ? v === "y"
                                      ? "bg-emerald-500 text-white"
                                      : "bg-stone-400 text-white"
                                    : "bg-white text-stone-500 ring-1 ring-stone-200 hover:ring-stone-300"
                                }`}
                              >
                                {v === "y" ? "نعم" : "لا"}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="relative">
                            <input
                              type="number"
                              inputMode="decimal"
                              value={draft[f.key] ?? ""}
                              onChange={(e) => set(f.key, e.target.value)}
                              className={`w-full rounded-lg border px-3 py-1.5 text-sm tabular-nums outline-none ${error ? "border-rose-400" : "border-stone-200 focus:border-amber-400"}`}
                            />
                            {f.unitAr && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-stone-400">{f.unitAr}</span>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-4">
          <p className="max-w-md text-[11px] leading-5 text-stone-400">
            حفظ الإعدادات يغيّر التقييم والجدولة فقط. لا يُرسل ولا يُنشأ أي خصم: كل قيم الخصم اقتراح داخلي للمراجعة.
          </p>
          <button
            type="button"
            onClick={save}
            disabled={saving || !storageReady || (preview !== null && !preview.ok)}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
            title={!storageReady ? "التخزين غير مُطبَّق — لا يمكن الحفظ" : undefined}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            حفظ التغييرات
          </button>
        </div>

        {message && (
          <div className={`rounded-xl border p-3 text-xs font-semibold ${message.kind === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
            {message.text}
          </div>
        )}
      </section>

      <section className="space-y-2 rounded-2xl border border-stone-200 bg-white p-5">
        <h2 className="text-sm font-bold text-stone-800">ما لا يغيّره هذا الجدول</h2>
        <ul className="space-y-2 text-[11px] leading-5 text-stone-500">
          <li className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" />
            مسار الإرسال القائم (إشعارات → خادم QR → WhatsApp) لا يتغيّر — لا مزوّد جديد، ولا قناة جديدة، ولا كوبونات.
          </li>
          <li className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" />
            لا تعرض هذه الشاشة أي مفاتيح أو أسرار، ولا تتيح تعديل أي منها.
          </li>
          <li className="flex items-start gap-2">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" />
            <span>
              القالب يُدار من صفحة{" "}
              <Link href="/admin/recovery/templates" className="font-bold text-amber-700 underline underline-offset-2 hover:text-amber-800">
                قوالب الرسائل
              </Link>{" "}
              (حاليًا: {templatesCount} {templatesCount === 1 ? "قالب" : "قالب"} {templatesError ? "(تعذّرت قراءتها)" : ""}). ربط المرحلة بالقالب يتمّ من صفحة المراحل.
            </span>
          </li>
        </ul>
      </section>
    </div>
  );
}

function Chip({ tone, icon, children }: { tone: "ok" | "warn" | "info"; icon: React.ReactNode; children: React.ReactNode }) {
  const cls =
    tone === "ok"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-stone-200 bg-stone-50 text-stone-600";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-bold ${cls}`}>
      {icon}
      {children}
    </span>
  );
}

function PreviewPanel({ preview }: { preview: RecoveryPlanPreviewResult }) {
  return (
    <div className="space-y-4 rounded-xl border border-amber-200 bg-amber-50/50 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-stone-700">وضع الإرسال بعد الحفظ:</span>
        <span className="rounded-lg bg-white px-2.5 py-1 text-[11px] font-bold text-stone-500">{preview.dryRun.before ? "معاينة" : "مباشر"}</span>
        <span className="text-stone-400">←</span>
        <span className={`rounded-lg px-2.5 py-1 text-[11px] font-bold ${preview.dryRun.after ? "bg-amber-200 text-amber-800" : "bg-emerald-200 text-emerald-800"}`}>
          {preview.dryRun.after ? "معاينة" : "مباشر"}
        </span>
      </div>

      {preview.changes.length > 0 ? (
        <div>
          <p className="mb-2 text-xs font-bold text-stone-700">القيم التي ستتغيّر أثريًا:</p>
          <div className="space-y-1.5">
            {preview.changes.map((c) => (
              <div key={c.key} className="flex flex-wrap items-center gap-2 rounded-lg bg-white px-3 py-2 text-[11px]">
                <span className="font-bold text-stone-700">{c.labelAr}</span>
                <span className="text-stone-500 line-through">{c.before}</span>
                <span className="text-stone-400">←</span>
                <span className="font-bold text-emerald-700">{c.after}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs font-semibold text-emerald-700">لا تغيير في القيم الفعّالة بعد اتباع المسودة.</p>
      )}

      <div>
        <p className="mb-2 text-xs font-bold text-stone-700">الخطة الزمنية للرسائل (المرحلة الحالية + السقف الحالي):</p>
        {preview.timeline.usedFallback ? (
          <p className="text-[11px] text-amber-700">{preview.timeline.warnings.join(" ")}</p>
        ) : (
          <TimelineSteps steps={preview.timeline.steps} emptyMessage="لا مراحل فعّالة للعرض" />
        )}
      </div>

      {preview.timeline.warnings.filter(() => !preview.timeline.usedFallback).map((w, i) => (
        <p key={i} className="text-[11px] leading-5 text-amber-700">
          • {w}
        </p>
      ))}
    </div>
  );
}

export function TimelineSteps({ steps, emptyMessage }: { steps: { step: number; nameAr: string; elapsedLabel: string; isTerminal: boolean; templateBound: boolean; key: string }[]; emptyMessage: string }) {
  if (!steps || !steps.length) return <p className="text-[11px] text-stone-400">{emptyMessage}</p>;
  return (
    <div className="space-y-1.5">
      {steps.map((s) => (
        <div key={s.step} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-[11px]">
          <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${s.isTerminal ? "bg-stone-800 text-white" : "bg-amber-100 text-amber-800"}`}>
            {s.step}
          </span>
          <span className="flex-1 font-semibold text-stone-700">{s.nameAr}</span>
          {s.templateBound && <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-500">قالب</span>}
          {s.isTerminal && <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-500">تُغلق الحالة بعدها</span>}
          <span className="font-bold tabular-nums text-stone-500">بعد {s.elapsedLabel}</span>
        </div>
      ))}
    </div>
  );
}
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Plus,
  Save,
  Trash2,
  ArrowUp,
  ArrowDown,
  Eye,
  Loader2,
  Power,
  PowerOff,
  CheckCircle2,
  AlertTriangle,
  Database,
  ListOrdered,
  Type,
  Clock,
  Flag,
  MessagesSquare,
} from "lucide-react";
import {
  saveRecoveryStageAction,
  deleteRecoveryStageAction,
  setRecoveryStageActiveAction,
  reorderRecoveryStagesAction,
  previewRecoveryStagesAction,
} from "@/app/admin/recovery-control-actions";
import { formatDurationAr } from "@/lib/recovery/control-schema";
import type { RecoveryStageRowView, RecoveryConfigSource, RecoveryTemplateRowView } from "@/lib/recovery/settings-store";

/**
 * إدارة مراحل الاسترجاع — عرض/إضافة/تعديل/حذف/تفعيل/ترتيب.
 *
 * كل تغيير يُعاين قبل الحفظ (خط زمني)، وكل حفظ يمرّ فحصًا كاملًا في الخادم
 * (parseStageInput) ثم قيود القاعدة. الحذف لا يمسّ الحالات ولا البيانات:
 * المراحل كيان قابل للإدارة من الواجهة بحرية، والخلفية تعود للافتراضي عند
 * خلوّ الجدول.
 */

type StageCard = {
  id: number | null;
  key: string;
  nameAr: string;
  position: number;
  delayMinutes: string;
  isActive: boolean;
  isTerminal: boolean;
  maxTotalMessages: string;
  templateId: string;
  builtin?: boolean;
};

type Props = {
  rows: RecoveryStageRowView[];
  stagesSource: RecoveryConfigSource;
  readError: string | null;
  storageReady: boolean;
  maxMessages: number;
  templates: RecoveryTemplateRowView[];
  templatesError: string | null;
};

function fromRows(rows: RecoveryStageRowView[]): StageCard[] {
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    nameAr: r.nameAr,
    position: r.position,
    delayMinutes: String(r.delayMinutes),
    isActive: r.isActive,
    isTerminal: r.isTerminal,
    maxTotalMessages: r.maxTotalMessages === null ? "" : String(r.maxTotalMessages),
    templateId: r.templateId === null ? "" : String(r.templateId),
    builtin: r.builtin ?? false,
  }));
}

type TimelineStep = { step: number; nameAr: string; elapsedLabel: string; isTerminal: boolean; templateBound: boolean; key: string };

export function RecoveryStagesContent(props: Props) {
  const { rows, stagesSource, readError, storageReady, maxMessages, templates, templatesError } = props;
  const router = useRouter();

  const [cards, setCards] = useState<StageCard[]>(() => fromRows(rows));
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<{ type: string; id?: number | null } | null>(null);
  const [preview, setPreview] = useState<{ timeline: { steps: TimelineStep[]; warnings: string[]; usedFallback: boolean }; errors: string[] } | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const ordered = useMemo(() => [...cards].sort((a, b) => a.position - b.position || String(a.key).localeCompare(String(b.key))), [cards]);

  const nextPosition = useMemo(() => (cards.length ? Math.max(...cards.map((c) => c.position)) + 1 : 1), [cards]);

  const patch = (id: number | null, p: Partial<StageCard>) => setCards((cs) => cs.map((c) => (c.id === id ? { ...c, ...p } : c)));

  async function runPreview() {
    setBusy({ type: "preview" });
    try {
      const drafts = ordered.map((c) => ({
        id: c.id ?? undefined,
        key: c.key,
        nameAr: c.nameAr,
        position: c.position,
        delayMinutes: c.delayMinutes,
        isActive: c.isActive,
        isTerminal: c.isTerminal,
        maxTotalMessages: c.maxTotalMessages,
        templateId: c.templateId,
      }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result: any = await previewRecoveryStagesAction(drafts as never);
      setPreview({
        timeline: result.timeline,
        errors: Array.isArray(result.errors) ? result.errors : [],
      });
    } finally {
      setBusy(null);
    }
  }

  async function saveCard(card: StageCard, isNew: boolean) {
    setBusy({ type: isNew ? "create" : "save", id: card.id });
    setMessage(null);
    const input = {
      ...(isNew ? {} : { id: card.id }),
      key: card.key,
      nameAr: card.nameAr,
      position: isNew ? nextPosition : card.position,
      delayMinutes: card.delayMinutes,
      isTerminal: card.isTerminal,
      isActive: card.isActive,
      maxTotalMessages: card.maxTotalMessages,
      templateId: card.templateId,
    };
    const result = await saveRecoveryStageAction(input);
    if (result.ok) {
      setMessage({ kind: "ok", text: isNew ? "أُضيفت المرحلة." : "حُفظت التغييرات." });
      if (isNew) {
        setAdding(false);
        setCards((cs) => cs.filter((c) => c.id !== null));
      }
      router.refresh();
    } else {
      setMessage({ kind: "error", text: result.error ?? "تعذّر الحفظ." });
    }
    setBusy(null);
  }

  async function remove(id: number | null) {
    if (!window.confirm("حذف هذه المرحلة؟ الحالات والبيانات لا تتأثر.")) return;
    setBusy({ type: "delete", id });
    try {
      if (id === null) {
        const card = cards.find((c) => c.builtin && c.id === null);
        if (!card) return;
        const result = await saveRecoveryStageAction({
          key: card.key,
          nameAr: card.nameAr,
          position: card.position,
          delayMinutes: card.delayMinutes,
          isTerminal: card.isTerminal,
          isActive: false,
          maxTotalMessages: card.maxTotalMessages,
          templateId: card.templateId,
        });
        setMessage(result.ok ? { kind: "ok", text: "أُزيلت المرحلة الافتراضية من الإعدادات." } : { kind: "error", text: result.error ?? "تعذّر الحذف." });
        if (result.ok) router.refresh();
      } else {
        const result = await deleteRecoveryStageAction(id);
        setMessage(result.ok ? { kind: "ok", text: "حُذفت المرحلة." } : { kind: "error", text: result.error ?? "تعذّر الحذف." });
        if (result.ok) setCards((cs) => cs.filter((c) => c.id !== id));
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  async function toggleActive(id: number | null, active: boolean) {
    setBusy({ type: "toggle", id });
    try {
      if (id === null) {
        const card = cards.find((c) => c.builtin && c.id === null);
        if (!card) return;
        const result = await saveRecoveryStageAction({
          key: card.key,
          nameAr: card.nameAr,
          position: card.position,
          delayMinutes: card.delayMinutes,
          isTerminal: card.isTerminal,
          isActive: active,
          maxTotalMessages: card.maxTotalMessages,
          templateId: card.templateId,
        });
        if (result.ok) router.refresh();
        else setMessage({ kind: "error", text: result.error ?? "تعذّر التبديل." });
      } else {
        const result = await setRecoveryStageActiveAction(id, active);
        if (result.ok) patch(id, { isActive: active });
        else setMessage({ kind: "error", text: result.error ?? "تعذّر التبديل." });
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= ordered.length) return;
    const a = ordered[index];
    const b = ordered[target];
    if (a.id === null || b.id === null) return; // لا نسير المرحلة الجديدة غير المحفوظة
    setCards((cs) => cs.map((c) => (c.id === a.id ? { ...c, position: b.position } : c.id === b.id ? { ...c, position: a.position } : c)));
  }

  async function persistOrder() {
    const ids = ordered.map((c) => c.id).filter((n): n is number => n !== null);
    if (ids.length < 2) return;
    setBusy({ type: "reorder" });
    const result = await reorderRecoveryStagesAction(ids);
    setMessage(result.ok ? { kind: "ok", text: "حُفظ ترتيب المراحل." } : { kind: "error", text: result.error ?? "تعذّر حفظ الترتيب." });
    setBusy(null);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <header>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href="/admin/recovery" className="inline-flex items-center gap-1 text-xs font-semibold text-stone-400 hover:text-stone-700">
              <ArrowRight className="h-3.5 w-3.5" /> لوحة استعادة المبيعات
            </Link>
            <h1 className="mt-2 text-lg font-bold text-stone-800">مراحل استعادة المبيعات</h1>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-stone-500">
              خطوات التواصل مع العميل منذ ترك السلة. الترتيب يحدد ترتيب الرسائل، والتأخير هو الوقت منذ أول نشاط. كل تعديل يُعاين قبل الحفظ.
            </p>
          </div>
          <Link
            href="/admin/recovery/settings"
            className="inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-bold text-stone-600 hover:border-amber-300 hover:text-gold"
          >
            <Type className="h-4 w-4" /> إعدادات الاسترجاع
          </Link>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-bold ${storageReady ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
            <Database className="h-3.5 w-3.5" />
            {storageReady ? "التخزين جاهز" : "التخزين غير مُطبَّق"}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1 text-[11px] font-bold text-stone-600">
            <ListOrdered className="h-3.5 w-3.5" /> مراحل محفوظة: {rows.length} · مصدر: {stagesSource === "db" ? "قاعدة البيانات" : stagesSource === "empty" ? "الافتراضي" : "البيئة"}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1 text-[11px] font-bold text-stone-600">
            <MessagesSquare className="h-3.5 w-3.5" /> سقف الرسائل: {maxMessages}
          </span>
        </div>
      </header>

      {!storageReady && (
        <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-bold">المراحل لن تُحفظ بعد — جدول recovery_stages غير موجود.</p>
            <p className="mt-1 opacity-90">{readError ?? "يُطبَّق عند الموافقة على migration-038."} يمكنك بناء المراحل ومعاينتها، والحفظ متاح بعد التطبيق.</p>
          </div>
        </div>
      )}

      {/* معاينة الخطة */}
      <section className="space-y-3 rounded-2xl border border-amber-100 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-stone-800">معاينة الخطة</h2>
            <p className="mt-0.5 text-[11px] leading-5 text-stone-500">ما الذي سيُرسل ومتى، حسب التعديلات الحالية (حتى غير المحفوظة).</p>
          </div>
          <button
            type="button"
            onClick={runPreview}
            disabled={busy?.type === "preview"}
            className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 hover:border-amber-300 disabled:opacity-50"
          >
            {busy?.type === "preview" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
            تحديث المعاينة
          </button>
        </div>

        {preview && preview.errors.length > 0 && (
          <ul className="space-y-1 rounded-xl border border-rose-200 bg-rose-50 p-3">
            {preview.errors.map((e, i) => (
              <li key={i} className="text-[11px] text-rose-600">
                • {e}
              </li>
            ))}
          </ul>
        )}

        {preview ? (
          <div className="space-y-2">
            {preview.timeline.usedFallback ? (
              <p className="text-[11px] leading-5 text-amber-700">{preview.timeline.warnings.join(" ")}</p>
            ) : (
              <div className="space-y-1.5">
                {preview.timeline.steps.map((s) => (
                  <div key={s.step} className="flex items-center gap-2 rounded-lg bg-stone-50 px-3 py-2 text-[11px]">
                    <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${s.isTerminal ? "bg-stone-800 text-white" : "bg-amber-100 text-amber-800"}`}>
                      {s.step}
                    </span>
                    <span className="flex-1 font-semibold text-stone-700">{s.nameAr}</span>
                    {s.templateBound && <span className="rounded bg-white px-1.5 py-0.5 text-[10px] text-stone-500">قالب</span>}
                    {s.isTerminal && <span className="rounded bg-white px-1.5 py-0.5 text-[10px] text-stone-500">تُغلق الحالة بعدها</span>}
                    <span className="font-bold tabular-nums text-stone-500">بعد {s.elapsedLabel}</span>
                  </div>
                ))}
              </div>
            )}
            {preview.timeline.warnings.filter(() => !preview.timeline.usedFallback).map((w, i) => (
              <p key={i} className="text-[11px] leading-5 text-amber-700">
                • {w}
              </p>
            ))}
            <p className="text-[11px] leading-5 text-stone-400">
              حد أقصى مستقبلي: {preview.timeline.steps.length} {preview.timeline.steps.length === 1 ? "رسالة" : "رسائل"} — تخضع لسقف الرسائل ({maxMessages}) في كل حالة.
            </p>
          </div>
        ) : (
          <p className="text-[11px] leading-5 text-stone-400">اضغط «تحديث المعاينة» لإظهار الخطة الزمنية الحالية.</p>
        )}
      </section>

      {/* القائمة */}
      <section className="space-y-3 rounded-2xl border border-amber-100 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-stone-800">المراحل</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={persistOrder}
              disabled={busy?.type === "reorder" || !storageReady}
              className="inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-bold text-stone-600 hover:border-amber-300 disabled:opacity-40"
              title={!storageReady ? "التخزين غير مُطبَّق" : "إعادة حفظ مواضع المراحل بعد ترتيبها بالأسهم"}
            >
              {busy?.type === "reorder" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
              حفظ الترتيب
            </button>
            <button
              type="button"
              onClick={() => setAdding((a) => !a)}
              disabled={!storageReady}
              className="inline-flex items-center gap-2 rounded-xl bg-stone-800 px-3 py-2 text-xs font-bold text-white transition hover:bg-stone-700 disabled:opacity-40"
            >
              <Plus className="h-4 w-4" /> إضافة مرحلة
            </button>
          </div>
        </div>

        {message && (
          <div className={`rounded-xl border p-3 text-xs font-semibold ${message.kind === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
            {message.text}
          </div>
        )}

        {adding && (
          <NewStageCard
            nextPosition={nextPosition}
            templates={templates}
            templatesError={templatesError}
            busy={busy?.type === "create"}
            onCancel={() => setAdding(false)}
            onSave={(card) => saveCard(card, true)}
          />
        )}

        {ordered.length === 0 && !adding ? (
          <div className="rounded-xl border border-dashed border-stone-300 p-6 text-center">
            <p className="text-xs font-bold text-stone-500">لا مراحل محفوظة بعد.</p>
            <p className="mt-1 text-[11px] leading-5 text-stone-400">
              سيستخدم النظام الخطة الافتراضية (30 دقيقة / 6 ساعات / 24 ساعة) حتى تُضاف المراحل.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {ordered.map((card, index) => (
              <StageCardRow
                key={card.id ?? `new-${index}`}
                index={index}
                total={ordered.length}
                card={card}
                busy={busy}
                storageReady={storageReady}
                templates={templates}
                templatesError={templatesError}
                onPatch={patch}
                onMove={(dir) => move(index, dir)}
                onSave={() => saveCard(card, false)}
                onDelete={(id) => remove(id)}
                onToggle={(active) => toggleActive(card.id, active)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function inputCls(error?: boolean, disabled?: boolean) {
  return `w-full rounded-lg border px-3 py-1.5 text-sm tabular-nums outline-none ${error ? "border-rose-400" : "border-stone-200 focus:border-amber-400"} ${disabled ? "bg-stone-100 text-stone-400" : "bg-white"}`;
}

function StageCardRow({
  index,
  total,
  card,
  busy,
  storageReady,
  templates,
  templatesError,
  onPatch,
  onMove,
  onSave,
  onDelete,
  onToggle,
}: {
  index: number;
  total: number;
  card: StageCard;
  busy: { type: string; id?: number | null } | null;
  storageReady: boolean;
  templates: RecoveryTemplateRowView[];
  templatesError: string | null;
  onPatch: (id: number | null, p: Partial<StageCard>) => void;
  onMove: (dir: -1 | 1) => void;
  onSave: () => void;
  onDelete: (id: number | null) => void;
  onToggle: (active: boolean) => void;
}) {
  const { id } = card;
  const saving = busy?.type === "save" && busy.id === id;
  const deleting = busy?.type === "delete" && busy.id === id;
  const toggling = busy?.type === "toggle" && busy.id === id;

  const delayNum = Number(card.delayMinutes);
  const delayOk = card.delayMinutes.trim() !== "" && Number.isFinite(delayNum) && delayNum >= 0;
  const nameOk = card.nameAr.trim().length > 0;

  return (
    <div className={`rounded-2xl border p-4 ${card.isActive ? "border-stone-200 bg-white" : "border-stone-200 bg-stone-50 opacity-75"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${card.isTerminal ? "bg-stone-800 text-white" : "bg-amber-100 text-amber-800"}`}>
          {card.position}
        </span>
        <div className="flex-1">
          <p className="text-sm font-bold text-stone-800">{card.nameAr || "(بلا اسم)"}</p>
          <p className="text-[10px] leading-4 text-stone-400">المفتاح: {card.key || "—"} {card.isTerminal && <span className="mr-1 rounded bg-stone-100 px-1 py-0.5 text-[10px]">نهائية</span>}</p>
        </div>
        <div className="flex items-center gap-1">
          {card.builtin && (
            <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[9px] font-bold text-stone-500">افتراضي</span>
          )}
          <button type="button" onClick={() => onMove(-1)} disabled={index === 0 || !storageReady} className="rounded-lg border border-stone-200 p-1.5 text-stone-500 hover:bg-stone-100 disabled:opacity-30" title="أعلى">
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => onMove(1)} disabled={index === total - 1 || !storageReady} className="rounded-lg border border-stone-200 p-1.5 text-stone-500 hover:bg-stone-100 disabled:opacity-30" title="أسفل">
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onToggle(!card.isActive)}
            disabled={!storageReady || toggling}
            className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border ${card.isActive ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-stone-200 text-stone-400"}`}
            title={card.isActive ? "تعطيل المرحلة" : "تفعيل المرحلة"}
          >
            {toggling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : card.isActive ? <Power className="h-3.5 w-3.5" /> : <PowerOff className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => onDelete(id)}
            disabled={!storageReady || deleting}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 disabled:opacity-40"
            title={card.builtin ? "إزالة من الإعدادات" : "حذف المرحلة"}
          >
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="mb-1 flex items-center gap-1 text-[11px] font-bold text-stone-600">
            <Type className="h-3 w-3" /> الاسم بالعربية
          </span>
          <input value={card.nameAr} onChange={(e) => onPatch(id, { nameAr: e.target.value })} className={inputCls(!nameOk)} placeholder="مثال: تذكير أول" />
        </label>
        <label className="block">
          <span className="mb-1 flex items-center gap-1 text-[11px] font-bold text-stone-600">
            <Clock className="h-3 w-3" /> الانتظار (دقيقة)
          </span>
          <input
            type="number"
            inputMode="numeric"
            value={card.delayMinutes}
            onChange={(e) => onPatch(id, { delayMinutes: e.target.value })}
            className={inputCls(!delayOk)}
            placeholder="30"
          />
          {delayOk && <span className="mt-1 block text-[10px] text-stone-400">{formatDurationAr(delayNum)} بعد أول نشاط</span>}
        </label>
        <label className="block">
          <span className="mb-1 flex items-center gap-1 text-[11px] font-bold text-stone-600">
            <Flag className="h-3 w-3" /> سقف رسائل خاص
          </span>
          <input
            type="number"
            inputMode="numeric"
            value={card.maxTotalMessages}
            onChange={(e) => onPatch(id, { maxTotalMessages: e.target.value })}
            className={inputCls()}
            placeholder="فارغ = يتبع السقف العام"
          />
        </label>
        <label className="block">
          <span className="mb-1 flex items-center gap-1 text-[11px] font-bold text-stone-600">
            <MessagesSquare className="h-3 w-3" /> ربط بالقالب
          </span>
          <select value={card.templateId} onChange={(e) => onPatch(id, { templateId: e.target.value })} className={inputCls()}>
            <option value="">بدون قالب (الافتراضي)</option>
            {templates.map((t) => (
              <option key={t.id} value={String(t.id)}>
                {t.nameAr}
                {!t.isActive ? " (غير فعّال)" : ""}
                {!t.valid ? " (معطوب)" : ""}
              </option>
            ))}
          </select>
          {templatesError && <span className="mt-1 block text-[10px] text-amber-600">تعذّرت قراءة القوالب ({templatesError}).</span>}
        </label>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-[11px] font-semibold text-stone-600">
          <input type="checkbox" checked={card.isTerminal} onChange={(e) => onPatch(id, { isTerminal: e.target.checked })} className="h-4 w-4 accent-stone-800" />
          مرحلة نهائية (تُغلق الحالة بعد الإرسال)
        </label>
        <button
          type="button"
          onClick={onSave}
          disabled={!storageReady || saving || !nameOk || !delayOk}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          حفظ هذه المرحلة
        </button>
      </div>
    </div>
  );
}

function NewStageCard({
  nextPosition,
  templates,
  templatesError,
  busy,
  onCancel,
  onSave,
}: {
  nextPosition: number;
  templates: RecoveryTemplateRowView[];
  templatesError: string | null;
  busy: boolean;
  onCancel: () => void;
  onSave: (card: StageCard) => void;
}) {
  const [card, setCard] = useState<StageCard>({
    id: null,
    key: "",
    nameAr: "",
    position: nextPosition,
    delayMinutes: "",
    isActive: true,
    isTerminal: false,
    maxTotalMessages: "",
    templateId: "",
  });

  const delayNum = Number(card.delayMinutes);
  const delayOk = card.delayMinutes.trim() !== "" && Number.isFinite(delayNum) && delayNum >= 0;

  return (
    <div className="rounded-2xl border-2 border-dashed border-amber-200 bg-amber-50/40 p-4">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-800">{card.position}</span>
        <p className="text-sm font-bold text-stone-700">مرحلة جديدة</p>
        <button type="button" onClick={onCancel} className="mr-auto text-[11px] font-bold text-stone-400 hover:text-stone-600">
          إلغاء
        </button>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold text-stone-600">المفتاح (إنجليزي)</span>
          <input
            value={card.key}
            onChange={(e) => setCard((c) => ({ ...c, key: e.target.value }))}
            className={inputCls(!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(card.key))}
            placeholder="مثال: winback_v1"
            dir="ltr"
          />
          <span className="mt-1 block text-[10px] text-stone-400">حروف/أرقام أو _ / - (حتى 64)، مستقل عن الترتيب.</span>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold text-stone-600">الاسم بالعربية</span>
          <input value={card.nameAr} onChange={(e) => setCard((c) => ({ ...c, nameAr: e.target.value }))} className={inputCls(!card.nameAr.trim())} placeholder="مثال: رسالة استعادة" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold text-stone-600">الانتظار (دقيقة)</span>
          <input
            type="number"
            inputMode="numeric"
            value={card.delayMinutes}
            onChange={(e) => setCard((c) => ({ ...c, delayMinutes: e.target.value }))}
            className={inputCls(!delayOk)}
            placeholder="360"
          />
          {delayOk && <span className="mt-1 block text-[10px] text-stone-400">{formatDurationAr(delayNum)} بعد أول نشاط</span>}
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold text-stone-600">ربط بالقالب</span>
          <select value={card.templateId} onChange={(e) => setCard((c) => ({ ...c, templateId: e.target.value }))} className={inputCls()}>
            <option value="">بدون قالب (الافتراضي)</option>
            {templates.map((t) => (
              <option key={t.id} value={String(t.id)}>
                {t.nameAr}
                {!t.isActive ? " (غير فعّال)" : ""}
                {!t.valid ? " (معطوب)" : ""}
              </option>
            ))}
          </select>
          {templatesError && <span className="mt-1 block text-[10px] text-amber-600">تعذّرت قراءة القوالب.</span>}
        </label>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-[11px] font-semibold text-stone-600">
          <input type="checkbox" checked={card.isTerminal} onChange={(e) => setCard((c) => ({ ...c, isTerminal: e.target.checked }))} className="h-4 w-4 accent-stone-800" />
          مرحلة نهائية (تُغلق الحالة بعد الإرسال)
        </label>
        <button
          type="button"
          onClick={() => onSave(card)}
          disabled={busy || !card.nameAr.trim() || !delayOk || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(card.key)}
          className="inline-flex items-center gap-2 rounded-xl bg-stone-800 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          إضافة المرحلة
        </button>
      </div>
    </div>
  );
}
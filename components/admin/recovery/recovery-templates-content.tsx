"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Database,
  Eye,
  FileText,
  Loader2,
  Plus,
  Power,
  PowerOff,
  Save,
  Trash2,
} from "lucide-react";
import {
  deleteRecoveryTemplateAction,
  previewTemplateAction,
  saveRecoveryTemplateAction,
  setRecoveryTemplateActiveAction,
} from "@/app/admin/recovery-template-actions";
import { findVariable, listTemplateTokens, variablesByGroup } from "@/lib/recovery/variables";
import { isTemplateKeyValid } from "@/lib/recovery/template-control";
import type { RecoveryTemplateRowView, TemplateBinding } from "@/lib/recovery/settings-store";
import type { TemplatePreviewResult } from "@/lib/recovery/template-control";

/**
 * إدارة قوالب الاسترجاع — محرر رسائل عربي واضح.
 *
 * - قاموس المتغيرات المركزي (variables.ts) مبنيّ في الواجهة: إدراج
 *   مباشر عند المؤشر، مع الشرح والقيمة التجريبية لكل متغير.
 * - معاينة فورية بالقيم التجريبية: نص العميل النهائي (والمتغيرات
 *   الداخلية discount.* تُعرض داخليًا فقط، لا تصل للعميل).
 * - أي متغير غير معروف = علامة حمراء في المحرر + رفض من الخادم قبل الحفظ.
 * - كل حفظ/حذف/تفعيل يمرّ فحصًا كاملًا في الخادم ثم قيود القاعدة.
 */

type TemplateCard = {
  id: number | null;
  key: string;
  nameAr: string;
  title: string;
  body: string;
  isActive: boolean;
  valid: boolean;
  hint: string | null;
};

const NEW_KEY = "new";

type Props = {
  templates: RecoveryTemplateRowView[];
  templatesError: string | null;
  bindings: Record<number, TemplateBinding[]>;
  storageReady: boolean;
};

function fromRows(templates: RecoveryTemplateRowView[]): TemplateCard[] {
  return templates.map((t) => ({
    id: t.id,
    key: t.key,
    nameAr: t.nameAr,
    title: "",
    body: t.body,
    isActive: t.isActive,
    valid: t.valid,
    hint: t.hint,
  }));
}

function notUsedTokensInfo(body: string): { unknown: string[] } {
  const unknown = listTemplateTokens(body).filter((name) => findVariable(name) === null);
  return { unknown };
}

export function RecoveryTemplatesContent(props: Props) {
  const router = useRouter();
  const { templatesError, storageReady, bindings } = props;
  const [cards, setCards] = useState<TemplateCard[]>(() => fromRows(props.templates));
  const [showNew, setShowNew] = useState(false);
  const [newCard, setNewCard] = useState<TemplateCard>({
    id: null,
    key: "",
    nameAr: "",
    title: "",
    body: "",
    isActive: true,
    valid: true,
    hint: null,
  });
  const [busy, setBusy] = useState<{ type: string; id?: number | null } | null>(null);
  const [previews, setPreviews] = useState<Record<string, TemplatePreviewResult | null>>({});
  // المعاينة الافتراضية = مسار العميل: discount.* لا تظهر أبدًا للعميل.
  const customerView = true;
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const bodyRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  const allInvalid = cards.filter((c) => c.valid === false).length;
  const boundTemplateCount = Object.keys(bindings).length;

  const patchCard = (id: number | null, p: Partial<TemplateCard>) =>
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, ...p } : c)));

  function spliceText(body: string, target: HTMLTextAreaElement | null | undefined, token: string): string {
    if (target && typeof target.selectionStart === "number") {
      const s = target.selectionStart;
      const e = target.selectionEnd;
      return body.slice(0, s) + token + body.slice(e);
    }
    return body + token;
  }

  const applyToken = (targetKey: string, token: string) => {
    const target = bodyRefs.current[targetKey];
    if (targetKey === NEW_KEY) {
      setNewCard((c) => ({ ...c, body: spliceText(c.body, target, token) }));
    } else {
      const id = Number(targetKey);
      setCards((cs) => cs.map((c) => (c.id === id ? { ...c, body: spliceText(c.body, target, token) } : c)));
    }
    // إعادة التركيز بعد الإدراج ليستمر الكتابة بسلاسة.
    setTimeout(() => {
      const ta = bodyRefs.current[targetKey];
      if (ta && typeof ta.selectionStart === "number") {
        const pos = ta.selectionStart + token.length;
        ta.focus();
        ta.setSelectionRange(pos, pos);
      }
    }, 0);
  };

  async function runPreview(targetKey: string, body: string, asCustomerView: boolean) {
    setBusy({ type: "preview", id: targetKey === NEW_KEY ? null : Number(targetKey) });
    try {
      const res = await previewTemplateAction(body, asCustomerView);
      setPreviews((p) => ({ ...p, [targetKey]: res }));
    } finally {
      setBusy(null);
    }
  }

  async function saveCard(id: number | null, isNew: boolean) {
    const card = isNew ? newCard : cards.find((c) => c.id === id);
    if (!card) return;
    setBusy({ type: "save", id });
    try {
      const input = {
        id: card.id === null ? undefined : card.id,
        key: card.key,
        nameAr: card.nameAr,
        title: card.title,
        body: card.body,
        isActive: card.isActive,
      };
      const res = await saveRecoveryTemplateAction(input);
      setFeedback({ ok: res.ok, text: res.error ?? "حُفظ القالب." });
      if (res.ok) {
        if (isNew) {
          setNewCard({ id: null, key: "", nameAr: "", title: "", body: "", isActive: true, valid: true, hint: null });
          setShowNew(false);
        }
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  async function deleteCard(id: number) {
    setBusy({ type: "delete", id });
    try {
      const res = await deleteRecoveryTemplateAction(id);
      setFeedback({ ok: res.ok, text: res.error ?? "حُذف القالب وفُكّ رباطه بالمراحل." });
      if (res.ok) router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function toggleCard(id: number, active: boolean) {
    setBusy({ type: "toggle", id });
    try {
      const res = await setRecoveryTemplateActiveAction(id, active);
      setFeedback({ ok: res.ok, text: res.error ?? (active ? "فُعّل القالب." : "عُطّل القالب.") });
      if (res.ok) router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-100 bg-white p-5">
        <div>
          <Link href="/admin/recovery" className="inline-flex items-center gap-1 text-xs font-semibold text-stone-400 hover:text-stone-700">
            لوحة استعادة المبيعات
          </Link>
          <h1 className="mt-2 text-lg font-bold text-stone-800">قوالب رسائل الاسترجاع</h1>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-stone-500">
            كل مرحلة يمكن ربطها بقالب مختلف. النص يدعم المتغيرات من القاموس المركزي، وتُعاين الرسالة بالقيم التجريبية قبل الحفظ. لا شيء يُرسل من هنا في هذه المرحلة.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/recovery/stages"
            className="inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-bold text-stone-600 hover:border-amber-300 hover:text-gold"
          >
            <ClipboardList className="h-4 w-4" /> المراحل
          </Link>
          <button
            type="button"
            onClick={() => {
              setShowNew(true);
              setActiveKey(NEW_KEY);
            }}
            disabled={showNew}
            className="inline-flex items-center gap-2 rounded-xl bg-stone-800 px-3 py-2 text-xs font-bold text-white hover:bg-stone-900 disabled:opacity-40"
          >
            <Plus className="h-4 w-4" /> قالب جديد
          </button>
        </div>
      </header>

      <div className="mt-4 flex flex-wrap gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-bold ${storageReady ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
          <Database className="h-3.5 w-3.5" />
          {storageReady ? "التخزين جاهز" : "التخزين غير مُطبَّق"}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1 text-[11px] font-bold text-stone-600">
          <FileText className="h-3.5 w-3.5" /> قوالب: {cards.length}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1 text-[11px] font-bold text-stone-600">
          <ClipboardList className="h-3.5 w-3.5" /> مراحل بربطة قالب: {boundTemplateCount}
        </span>
        {allInvalid > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5" /> {allInvalid} {allInvalid === 1 ? "قالب يحتاج" : "قوالب تحتاج"} مراجعة
          </span>
        )}
      </div>

      {!storageReady && (
        <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-bold">القوالب لن تُحفظ بعد — جدول recovery_templates غير موجود.</p>
            <p className="mt-1 opacity-90">{templatesError ?? "يُطبَّق عند الموافقة على migration-039."} يمكنك تحرير النصوص ومعاينتها، والحفظ متاح بعد التطبيق.</p>
          </div>
        </div>
      )}

      {feedback && (
        <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold ${feedback.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
          {feedback.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          {feedback.text}
        </div>
      )}

      {showNew && (
        <TemplateCardEditor
          card={newCard}
          isActive
          busy={busy}
          storageReady={storageReady}
          onPatch={(p) => setNewCard((c) => ({ ...c, ...p }))}
          onFocusBody={() => setActiveKey(NEW_KEY)}
          onRunPreview={() => runPreview(NEW_KEY, newCard.body, customerView)}
          onPreview={previews[NEW_KEY]}
          onSave={() => saveCard(null, true)}
          onCancel={() => setShowNew(false)}
          registerRef={(el) => {
            bodyRefs.current[NEW_KEY] = el;
          }}
        />
      )}

      <VariableDictionary activeKey={activeKey} onInsert={(token) => applyToken(activeKey ?? NEW_KEY, token)} />

      {cards.length === 0 && !showNew && (
        <div className="rounded-2xl border border-dashed border-stone-200 bg-white p-8 text-center">
          <p className="text-sm font-bold text-stone-600">لا قوالب بعد.</p>
          <p className="mt-1 text-xs text-stone-400">ابدأ بإنشاء قالب رسالة، ثم اربطه بمرحلة من صفحة المراحل.</p>
        </div>
      )}

      <div className="space-y-4">
        {cards.map((card) => (
          <TemplateCardEditor
            key={card.id}
            card={card}
            isActive={card.isActive}
            busy={busy}
            storageReady={storageReady}
            valid={card.valid}
            hint={card.hint}
            boundTo={bindings[card.id ?? 0]}
            onPatch={(p) => patchCard(card.id, p)}
            onFocusBody={() => setActiveKey(String(card.id))}
            onRunPreview={() => runPreview(String(card.id), card.body, customerView)}
            onPreview={previews[String(card.id)]}
            onDelete={() => card.id !== null && deleteCard(card.id)}
            onToggle={(active) => card.id !== null && toggleCard(card.id, active)}
            onSave={() => saveCard(card.id, false)}
            registerRef={(el) => {
              bodyRefs.current[String(card.id)] = el;
            }}
          />
        ))}
      </div>

      <div className="flex items-center gap-2 rounded-2xl border border-stone-200 bg-white p-3 text-[11px] text-stone-500">
        <ChevronDown className="h-3.5 w-3.5" />
        <span>
          المعاينة الافتراضية هي «عرض العميل»: المتغيرات الداخلية (discount.*) لا تظهر فيها أبدًا ولو وُجدت في النص. لحذف قالب مرتبط بمرحلة، يُفكّ الربط تلقائيًا (on delete set null).
        </span>
      </div>
    </div>
  );
}

function VariableDictionary({
  activeKey,
  onInsert,
}: {
  activeKey: string | null;
  onInsert: (token: string) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const g of variablesByGroup()) init[g.group] = g.group === "customer";
    return init;
  });
  const canInsert = activeKey !== null;

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-stone-800">
            <ClipboardList className="h-4 w-4" /> قاموس المتغيرات
          </h2>
          <p className="mt-0.5 text-[11px] leading-5 text-stone-500">
            {canInsert
              ? "المتغير يُدرج في موضع المؤشر داخل النص النشط."
              : "ركّز في حقل نص أي رسالة أولًا، ثم انقر «إدراج» ليُضاف المتغير في موضع المؤشر."}
            المرجع واحد: lib/recovery/variables.ts.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2">
        {variablesByGroup().map((g) => (
          <div key={g.group} className="rounded-xl border border-stone-100 bg-stone-50/60 p-3">
            <button type="button" onClick={() => setOpen((o) => ({ ...o, [g.group]: !o[g.group] }))} className="flex w-full items-center justify-between text-xs font-bold text-stone-700">
              <span>{GROUP_LABELS[g.group] ?? g.group}</span>
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open[g.group] ? "rotate-180" : ""}`} />
            </button>
            {open[g.group] && (
              <div className="mt-2 space-y-1">
                {g.items.map((v) => (
                  <div key={v.name} className="flex items-center justify-between gap-2 rounded-lg bg-white px-2 py-1.5">
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-bold text-stone-700" dir="ltr">
                        {v.name}
                        {v.internalOnly && (
                          <span className="mr-1 rounded bg-stone-800 px-1 py-0.5 text-[9px] text-white">داخلي</span>
                        )}
                      </p>
                      <p className="truncate text-[10px] text-stone-400">{v.descriptionAr}</p>
                      <p className="truncate text-[10px] text-stone-400">
                        قيمة تجريبية: {v.example || "—"} · بديل عند الغياب: {v.fallback || "يُحذف"}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={!canInsert}
                      onClick={() => onInsert(`{{${v.name}}}`)}
                      className="shrink-0 rounded-md border border-stone-200 bg-white px-2 py-1 text-[10px] font-bold text-stone-600 hover:border-amber-300 hover:text-gold disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      إدراج
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

const GROUP_LABELS: Record<string, string> = {
  customer: "العميل",
  cart: "السلة",
  product: "المنتج",
  order: "الطلب",
  recovery: "حالة الاسترجاع",
  message: "الرسائل",
  store: "المتجر",
  links: "الروابط",
  dates: "التواريخ",
  discount: "الخصم (داخلي)",
};

function TemplateCardEditor(props: {
  card: TemplateCard;
  isActive: boolean;
  busy: { type: string; id?: number | null } | null;
  storageReady: boolean;
  valid?: boolean;
  hint?: string | null;
  boundTo?: TemplateBinding[];
  onPatch: (p: Partial<TemplateCard>) => void;
  onFocusBody: () => void;
  onRunPreview: () => void;
  onPreview: TemplatePreviewResult | null | undefined;
  onSave: () => void;
  onDelete?: () => void;
  onToggle?: (active: boolean) => void;
  onCancel?: () => void;
  registerRef: (el: HTMLTextAreaElement | null) => void;
}) {
  const {
    card,
    isActive,
    busy,
    storageReady,
    valid = true,
    hint = null,
    boundTo = [],
    onPatch,
    onFocusBody,
    onRunPreview,
    onPreview,
    onSave,
    onDelete,
    onToggle,
    onCancel,
    registerRef,
  } = props;
  const isNew = card.id === null;
  const saving = busy?.type === "save" && busy.id === (isNew ? null : card.id);
  const previewing = busy?.type === "preview" && busy.id === (isNew ? null : card.id);
  const deleting = busy?.type === "delete" && busy.id === card.id;
  const toggling = busy?.type === "toggle" && busy.id === card.id;

  const { unknown } = notUsedTokensInfo(card.body);
  const nameOk = card.nameAr.trim().length > 0;
  const bodyOk = card.body.trim().length > 0;
  const keyOk = isTemplateKeyValid(card.key);

  return (
    <div className={`rounded-2xl border p-5 ${isActive ? "border-stone-200 bg-white" : "border-stone-200 bg-stone-50 opacity-80"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1">
          <p className="text-sm font-bold text-stone-800">{card.nameAr || "(بلا اسم)"}</p>
          <p className="text-[10px] leading-4 text-stone-400" dir="ltr">
            {card.key || "—"} {card.id !== null && <span className="mr-1 text-stone-300">· id {card.id}</span>}
          </p>
        </div>
        {card.id !== null && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onToggle?.(!isActive)}
              disabled={!storageReady || toggling}
              className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border ${isActive ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-stone-200 text-stone-400"}`}
              title={isActive ? "تعطيل القالب" : "تفعيل القالب"}
            >
              {toggling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isActive ? <Power className="h-3.5 w-3.5" /> : <PowerOff className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={!storageReady || deleting}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 disabled:opacity-40"
              title="حذف القالب"
            >
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            </button>
          </div>
        )}
        {onCancel && (
          <button type="button" onClick={onCancel} className="text-[11px] font-bold text-stone-400 hover:text-stone-600">
            إلغاء
          </button>
        )}
      </div>

      {!valid && hint && (
        <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-bold text-amber-800">
          <AlertTriangle className="h-3.5 w-3.5" /> {hint}
        </div>
      )}

      {boundTo.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1.5 text-[11px] text-stone-600">
          <ClipboardList className="h-3.5 w-3.5" />
          مستخدم في مراحل: {boundTo.map((b) => b.nameAr).join("، ")}
        </div>
      )}

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold text-stone-600">المفتاح (إنجليزي)</span>
          <input
            value={card.key}
            onChange={(e) => onPatch({ key: e.target.value })}
            className={`w-full rounded-lg border px-3 py-1.5 text-sm tabular-nums outline-none ${!keyOk ? "border-rose-400" : "border-stone-200 focus:border-amber-400"}`}
            placeholder="مثال: winback_first"
            dir="ltr"
          />
          <span className="mt-1 block text-[10px] text-stone-400">فريد بين القوالب، مستقل عن الاسم.</span>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold text-stone-600">الاسم بالعربية</span>
          <input
            value={card.nameAr}
            onChange={(e) => onPatch({ nameAr: e.target.value })}
            className={`w-full rounded-lg border px-3 py-1.5 text-sm outline-none ${!nameOk ? "border-rose-400" : "border-stone-200 focus:border-amber-400"}`}
            placeholder="مثال: رسالة استعادة أولى"
          />
        </label>
      </div>

      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-[11px] font-bold text-stone-600">نص الرسالة</span>
          <span className="text-[10px] text-stone-400">{card.body.length.toLocaleString("en-US")} / 2000 حرف</span>
        </div>
        <textarea
          ref={registerRef}
          value={card.body}
          onChange={(e) => onPatch({ body: e.target.value })}
          onFocus={onFocusBody}
          onDragStart={(e) => e.preventDefault()}
          dir="rtl"
          rows={7}
          placeholder={"مرحبًا {{customer.name}}، نلاحظ أن سلتك بقيمة {{cart.value_formatted}} ما زالت موجودة. اضغط هنا لإتمام طلبك: {{links.checkout}}"}
          className={`w-full resize-y rounded-xl border p-3 text-sm leading-6 outline-none ${!bodyOk ? "border-rose-400" : "border-stone-200 focus:border-amber-400"}`}
        />
        {unknown.length > 0 && (
          <p className="mt-1 flex items-center gap-1.5 text-[11px] font-bold text-rose-600">
            <AlertTriangle className="h-3.5 w-3.5" /> متغيرات غير معروفة في القاموس (لن تُرسل للعميل وتمنع الحفظ): {unknown.join("، ")}
          </p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRunPreview}
            disabled={previewing}
            className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800 hover:border-amber-300 disabled:opacity-50"
          >
            {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
            معاينة الرسالة
          </button>
          <span className="text-[11px] font-bold text-stone-500">{isActive ? "فعال" : "معطّل"}</span>
        </div>
        {onSave && (
          <div className="flex items-center gap-2">
            {boundTo.length > 0 && (
              <span className="text-[10px] text-stone-400">تعديله يؤثر على المراحل المرتبطة فور الحفظ.</span>
            )}
            <button
              type="button"
              onClick={onSave}
              disabled={!storageReady || saving || !nameOk || !bodyOk || unknown.length > 0 || !keyOk}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {isNew ? "إنشاء القالب" : "حفظ القالب"}
            </button>
          </div>
        )}
      </div>

      {onPreview && (
        <div className="mt-4 rounded-xl border border-stone-200 bg-stone-50/60 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[11px] font-bold text-stone-700">
              <Eye className="h-3.5 w-3.5" /> المعاينة بالقيم التجريبية
            </p>
            {onPreview.ok ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" /> لا متغيرات غير معروفة
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-600">
                <AlertTriangle className="h-3.5 w-3.5" /> {onPreview.unknown.length} {onPreview.unknown.length === 1 ? "متغير غير معروف" : "متغيرات غير معروفة"}
              </span>
            )}
          </div>

          <div dir="rtl" className="mt-2 whitespace-pre-wrap rounded-lg border border-stone-200 bg-white p-3 text-sm leading-6 text-stone-800">
            {onPreview.text || "—"}
          </div>

          {onPreview.warnings.length > 0 && (
            <ul className="mt-2 space-y-1">
              {onPreview.warnings.map((w, i) => (
                <li key={i} className="text-[11px] leading-5 text-amber-700">
                  • {w}
                </li>
              ))}
            </ul>
          )}

          {onPreview.tokens.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[480px] text-right text-[11px]">
                <thead className="rounded-lg text-stone-500">
                  <tr className="border-b border-stone-200">
                    <th className="py-1.5 pr-2 font-bold">المتغير</th>
                    <th className="py-1.5 pr-2 font-bold">القيمة في الرسالة</th>
                    <th className="py-1.5 pr-2 font-bold">المصدر</th>
                    <th className="py-1.5 pr-2 font-bold">البديل الآمن</th>
                  </tr>
                </thead>
                <tbody>
                  {onPreview.tokens.map((t, i) => (
                    <tr key={`${t.name}-${i}`} className="border-b border-stone-100 last:border-0">
                      <td className="py-1.5 pr-2">
                        <span className="font-bold text-stone-700" dir="ltr">
                          {t.name}
                        </span>
                        <span className="mr-1 text-stone-400">{t.labelAr}</span>
                        {t.internalOnly && <span className="mr-1 rounded bg-stone-800 px-1 py-0.5 text-[9px] text-white">داخلي</span>}
                      </td>
                      <td className="py-1.5 pr-2 text-stone-700">
                        {t.internalOnly ? <span className="text-stone-400">لا تُرسل للعميل</span> : t.rendered}
                      </td>
                      <td className="py-1.5 pr-2">
                        {t.internalOnly ? (
                          <span className="text-[10px] text-stone-400">معاينة داخلية فقط</span>
                        ) : t.fromData ? (
                          <span className="text-[10px] font-bold text-emerald-700">قيمة تجريبية</span>
                        ) : (
                          <span className="text-[10px] font-bold text-amber-700">بديل تلقائي</span>
                        )}
                      </td>
                      <td className="py-1.5 pr-2 text-stone-400">{t.fallback || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {onPreview.blockedInternal.length > 0 && (
            <p className="mt-2 text-[11px] leading-5 text-stone-500">
              متغيرات خصم في النص ستُحذف من رسالة العميل (تبقى للمراجعة الداخلية): {onPreview.blockedInternal.join("، ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
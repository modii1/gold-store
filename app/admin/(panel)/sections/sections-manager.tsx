"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  GripVertical, ChevronUp, ChevronDown, Eye, EyeOff, Plus, Pencil, Trash2, Save, X, Check, Loader2, Sparkles,
} from "lucide-react";
import type { HomeSection } from "@/types";
import { saveSectionsOrderAction, upsertSectionAction, deleteSectionAction } from "@/app/actions/home-sections";
import { BUILTIN_SECTION_LABELS } from "@/lib/services/home-section-labels";

export function SectionsManager({ sections }: { sections: HomeSection[] }) {
  const router = useRouter();
  const [items, setItems] = useState<HomeSection[]>(() => [...sections].sort((a, b) => a.sort_order - b.sort_order));
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [editing, setEditing] = useState<HomeSection | "new" | null>(null);

  // ---- منطق السحب/الإفلات (يعمل على الجوال والكمبيوتر) ----
  // أحداث الـ move/up تُوضع على الصف المسحوب نفسه لأن setPointerCapture
  // يوجّه كل أحداث المؤشر إليه. إعادة الترتيب تتم فورياً عبر المصفوفة.
  const listRef = useRef<HTMLDivElement>(null);
  const dragId = useRef<string | null>(null);
  const [liftedId, setLiftedId] = useState<string | null>(null);

  const getRows = () => listRef.current?.querySelectorAll<HTMLElement>("[data-row]") ?? [];

  const reorder = (from: number, to: number) => {
    setItems((prev) => {
      if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) return prev;
      const next = prev.slice();
      const [m] = next.splice(from, 1);
      next.splice(to, 0, m);
      return next;
    });
  };

  const startDrag = (e: React.PointerEvent, id: string) => {
    if (!listRef.current) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture?.(e.pointerId);
    dragId.current = id;
    setLiftedId(id);
    document.body.style.userSelect = "none";
  };

  const dragMove = (e: React.PointerEvent) => {
    if (!dragId.current || !listRef.current) return;
    const rows = Array.from(getRows());
    const draggingEl = rows.find((r) => r.getAttribute("data-id") === dragId.current);
    if (!draggingEl) return;
    const from = rows.indexOf(draggingEl);
    if (from === -1) return;

    // الهدف: الصف الذي تجاوزت pointerY منتصفه (مُساراً من أعلى لوأسفل)
    let to = rows.length - 1;
    for (let k = 0; k < rows.length; k++) {
      if (k === from) continue;
      const r = rows[k].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { to = k; break; }
    }
    if (to !== from) {
      reorder(from, to);
      // بعد إعادة الترتيب يبقى المسحوب معرفاً عبر data-dragging
    }
  };

  const endDrag = () => {
    dragId.current = null;
    setLiftedId(null);
    document.body.style.userSelect = "";
  };

  // ---- أزرار تحريك لأعلى/أسفل ----
  const moveBy = (idx: number, dir: -1 | 1) => {
    setItems((prev) => {
      const next = prev.slice();
      const to = idx + dir;
      if (to < 0 || to >= next.length) return prev;
      const [m] = next.splice(idx, 1);
      next.splice(to, 0, m);
      return next;
    });
  };

  const toggleActive = (idx: number) =>
    setItems((prev) => prev.map((s, i) => (i === idx ? { ...s, is_active: !s.is_active } : s)));

  const handleSave = async () => {
    setSaving(true);
    setMsg(null);
    const res = await saveSectionsOrderAction(items.map((s, i) => ({ id: s.id, sort_order: i, is_active: s.is_active })));
    setMsg(res.success ? { type: "ok", text: "تم حفظ الترتيب بنجاح" } : { type: "err", text: res.error || "تعذّر الحفظ" });
    setSaving(false);
    if (res.success) router.refresh();
  };

  const handleDelete = async (id: string) => {
    setBusy(true);
    setMsg(null);
    const fd = new FormData();
    fd.set("id", id);
    const res = await deleteSectionAction(fd);
    if (res.success) { setItems((prev) => prev.filter((s) => s.id !== id)); setMsg({ type: "ok", text: "تم حذف القسم" }); router.refresh(); }
    else setMsg({ type: "err", text: res.error || "تعذّر الحذف" });
    setBusy(false);
  };

  const labels = BUILTIN_SECTION_LABELS;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">أقسام الصفحة الرئيسية</h1>
          <p className="mt-1 text-sm text-stone-500">اسحب الأقسام لإعادة ترتيبها أو استخدم الأسهم. فعّل/عطّل ظهور أي قسم، وأضف أقساماً مخصصة.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setEditing("new")}
            className="flex items-center gap-2 rounded-xl bg-amber-100 px-4 py-2.5 text-sm font-bold text-gold hover:bg-amber-200 transition">
            <Plus className="w-4 h-4" /> إضافة قسم
          </button>
          <button onClick={handleSave} disabled={saving || busy}
            className="flex items-center gap-2 rounded-xl bg-gold px-5 py-2.5 text-sm font-bold text-ivory hover:bg-gold-light transition disabled:opacity-60">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} حفظ الترتيب
          </button>
        </div>
      </div>

      {msg && (
        <div className={`rounded-xl border p-3 text-sm ${msg.type === "ok" ? "border-green-200 bg-green-50 text-green-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
          {msg.text}
        </div>
      )}

      {/* المعاينة السريعة */}
      <div className="rounded-2xl border border-amber-100 bg-white p-5">
        <p className="mb-3 text-sm font-bold text-stone-700 flex items-center gap-2"><Eye className="w-4 h-4 text-gold" /> معاينة الترتيب الحالي</p>
        <div className="flex flex-wrap gap-2">
          {items.filter((s) => s.is_active).map((s, i) => (
            <span key={s.id} className="rounded-full bg-cream border border-sand px-3 py-1 text-xs font-semibold text-stone-600">
              {i + 1}. {labelOf(s, labels)}
            </span>
          ))}
        </div>
      </div>

      {/* قائمة الأقسام */}
      <div ref={listRef} className="space-y-2">
        {items.map((s, i) => (
          <Row
            key={s.id}
            section={s}
            index={i}
            total={items.length}
            dragged={liftedId === s.id}
            onDragStart={startDrag}
            onDragMove={dragMove}
            onDragEnd={endDrag}
            onMoveUp={() => moveBy(i, -1)}
            onMoveDown={() => moveBy(i, 1)}
            onToggle={() => toggleActive(i)}
            onEdit={s.type === "custom" ? () => setEditing(s) : undefined}
            onDelete={s.type === "custom" ? () => handleDelete(s.id) : undefined}
            labels={labels}
          />
        ))}
      </div>

      {editing && (
        <SectionEditor
          section={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); router.refresh(); }}
        />
      )}
    </div>
  );
}

function labelOf(s: HomeSection, labels: Record<string, { name: string }>): string {
  if (s.type !== "custom") return labels[s.type]?.name || s.code;
  return s.title || "قسم مخصص";
}

/* ===== صف واحد ===== */
function Row({ section, index, total, dragged, onDragStart, onDragMove, onDragEnd, onMoveUp, onMoveDown, onToggle, onEdit, onDelete, labels }: {
  section: HomeSection; index: number; total: number; dragged: boolean;
  onDragStart: (e: React.PointerEvent, id: string) => void;
  onDragMove: (e: React.PointerEvent) => void;
  onDragEnd: () => void;
  onMoveUp: () => void; onMoveDown: () => void; onToggle: () => void; onEdit?: () => void; onDelete?: () => void;
  labels: Record<string, { name: string }>;
}) {
  const isCustom = section.type === "custom";
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div
      data-row="true"
      data-id={section.id}
      data-dragging={dragged ? "true" : undefined}
      onPointerDown={(e) => onDragStart(e, section.id)}
      onPointerMove={dragged ? onDragMove : undefined}
      onPointerUp={dragged ? onDragEnd : undefined}
      onPointerCancel={dragged ? onDragEnd : undefined}
      className={`relative flex items-center gap-2 rounded-2xl border bg-white p-3 shadow-sm select-none touch-none cursor-grab active:cursor-grabbing ${dragged ? "opacity-80 ring-2 ring-gold/50 shadow-xl" : ""} ${section.is_active ? "border-amber-100" : "border-stone-200 opacity-60"}`}
    >
      <button type="button" className="shrink-0 rounded-lg p-1.5 text-stone-400" title="اسحب لإعادة الترتيب" aria-label="سحب">
        <GripVertical className="h-5 w-5" />
      </button>

      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cream text-gold-dark">
        <Sparkles className="h-5 w-5" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-stone-800">{labelOf(section, labels)}</p>
        <p className="truncate text-xs text-stone-400" dir="ltr">{section.type}</p>
      </div>

      <div className="flex shrink-0 items-center gap-1" onPointerDown={stop}>
        <div className="flex flex-col items-center gap-0.5">
          <button type="button" onClick={onMoveUp} disabled={index === 0} className="rounded p-0.5 text-stone-400 hover:text-gold disabled:opacity-30"><ChevronUp className="h-4 w-4" /></button>
          <span className="text-[10px] font-bold text-stone-400">{index + 1}</span>
          <button type="button" onClick={onMoveDown} disabled={index === total - 1} className="rounded p-0.5 text-stone-400 hover:text-gold disabled:opacity-30"><ChevronDown className="h-4 w-4" /></button>
        </div>

        <button type="button" onClick={onToggle} title={section.is_active ? "إخفاء القسم" : "إظهار القسم"}
          className={`rounded-lg p-2 transition ${section.is_active ? "text-green-600 hover:bg-green-50" : "text-stone-400 hover:bg-stone-100"}`}>
          {section.is_active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        </button>

        {isCustom ? (
          <>
            <button type="button" onClick={onEdit} title="تعديل" className="rounded-lg p-2 text-stone-500 hover:bg-amber-50 hover:text-gold transition"><Pencil className="h-4 w-4" /></button>
            <button type="button" onClick={onDelete} title="حذف" className="rounded-lg p-2 text-stone-400 hover:bg-rose-50 hover:text-rose-600 transition"><Trash2 className="h-4 w-4" /></button>
          </>
        ) : null}
      </div>
    </div>
  );
}

/* ===== محرر قسم (إنشاء/تعديل قسم مخصص) ===== */
const ICON_OPTIONS = ["Sparkles", "Truck", "ShieldCheck", "Gem", "MessagesSquare", "Star", "Package", "Percent", "BadgeCheck"];

function SectionEditor({ section, onClose, onSaved }: { section: HomeSection | null; onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (formData: FormData) => {
    setSaving(true);
    setErr("");
    if (section) formData.set("id", section.id);
    const res = await upsertSectionAction(formData);
    setSaving(false);
    if (res.success) onSaved();
    else setErr(res.error || "تعذّر الحفظ");
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/60 backdrop-blur-sm p-4 overflow-y-auto">
      <form action={submit} className="w-full max-w-xl rounded-2xl bg-white shadow-2xl overflow-hidden my-auto">
        <div className="flex items-center justify-between border-b border-sand px-5 py-3">
          <h3 className="text-lg font-bold text-stone-900">{section ? "تعديل القسم" : "قسم جديد"}</h3>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="rounded-full p-2 text-stone-400 hover:bg-stone-100"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-4 p-5">
          <input type="hidden" name="type" value="custom" />
          {err && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{err}</div>}

          <div>
            <label className="block text-sm font-semibold text-stone-700 mb-1">عنوان القسم</label>
            <input name="title" defaultValue={section?.title || ""} placeholder="مثال: لماذا تختاريننا؟"
              className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-stone-700 mb-1">وصف القسم</label>
            <input name="subtitle" defaultValue={section?.subtitle || ""} placeholder="جملة قصيرة توضح القسم"
              className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-stone-700 mb-1">رابط الصورة</label>
            <input name="image_url" defaultValue={section?.image_url || ""} placeholder="https://..." dir="ltr"
              className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-stone-700 mb-1">الأيقونة</label>
            <select name="icon" defaultValue={section?.icon || "Sparkles"} className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none">
              {ICON_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-stone-700 mb-1">محتوى القسم (سطر في كل مرة)</label>
            <textarea name="content" rows={4} defaultValue={section?.content || ""} placeholder={"السطر الأول من النص\nالسطر الثاني..."}
              className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:border-gold focus:outline-none resize-y" />
          </div>
          <label className="flex items-center gap-3 rounded-xl border border-stone-200 p-3 text-sm font-semibold text-stone-700">
            <input name="dark" type="checkbox" defaultChecked={section?.config?.dark === true} className="h-5 w-5 accent-[#B08D57]" />
            خلفية داكنة
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-sand px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-xl px-5 py-2.5 text-sm font-bold text-stone-600 hover:bg-stone-100 transition">إلغاء</button>
          <button type="submit" disabled={saving} className="flex items-center gap-2 rounded-xl bg-gold px-6 py-2.5 text-sm font-bold text-ivory hover:bg-gold-light transition disabled:opacity-60">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} حفظ القسم
          </button>
        </div>
      </form>
    </div>
  );
}

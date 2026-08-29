"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, Check, Loader2, Eye, FileText } from "lucide-react";
import { savePageAction, deletePageAction } from "@/app/actions/pages-admin";
import { Modal } from "@/app/admin/(panel)/orders/order-modal";
import type { Page } from "@/types";

const inputCls = "w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:border-gold focus:outline-none";
const labelCls = "block text-xs font-semibold text-stone-600 mb-1";

export function PagesManager({ pages }: { pages: Page[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Page | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [content, setContent] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const openCreate = () => {
    setEditing(null);
    setTitle("");
    setSlug("");
    setContent("");
    setIsActive(true);
    setError("");
    setCreating(true);
  };

  const openEdit = (p: Page) => {
    setEditing(p);
    setTitle(p.title);
    setSlug(p.slug);
    setContent(p.content || "");
    setIsActive(p.is_active);
    setError("");
    setCreating(true);
  };

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    const fd = new FormData();
    if (editing?.id) fd.set("id", editing.id);
    fd.set("title", title);
    fd.set("slug", slug);
    fd.set("content", content);
    fd.set("is_active", isActive ? "on" : "");
    const res = await savePageAction(fd);
    setSaving(false);
    if (res.error) { setError(res.error); return; }
    setCreating(false);
    router.refresh();
  };

  const del = async (p: Page) => {
    if (!confirm(`حذف صفحة «${p.title}»؟`)) return;
    const fd = new FormData();
    fd.set("id", p.id);
    const res = await deletePageAction(fd);
    if (res.error) { setError(res.error); return; }
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">صفحات الموقع</h1>
          <p className="mt-1 text-sm text-stone-500">أنشئ وعدّل الصفحات الثابتة مثل «الشروط والأحكام» و«الخصوصية» وتظهر للعملاء على /pages/...</p>
        </div>
        <button onClick={openCreate} className="flex items-center gap-2 rounded-xl bg-gold px-4 py-2.5 text-sm font-bold text-white hover:bg-gold-light transition">
          <Plus className="w-4 h-4" /> إضافة صفحة
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {pages.length === 0 ? (
        <div className="rounded-2xl border border-amber-100 bg-white p-10 text-center text-stone-400">
          لا توجد صفحات — اضغط «إضافة صفحة»
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-amber-100 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-amber-100 text-xs text-stone-400">
                <th className="px-4 py-3 text-end font-semibold">العنوان</th>
                <th className="px-4 py-3 text-end font-semibold">الرابط</th>
                <th className="px-4 py-3 text-end font-semibold">الحالة</th>
                <th className="px-4 py-3 text-end font-semibold">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {pages.map((p) => (
                <tr key={p.id} className="border-b border-amber-50 last:border-0">
                  <td className="px-4 py-3 font-bold text-stone-800">{p.title}</td>
                  <td className="px-4 py-3">
                    <a href={`/pages/${p.slug}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 font-mono text-xs text-gold hover:underline" dir="ltr">
                      <Eye className="h-3.5 w-3.5" /> /pages/{p.slug}
                    </a>
                  </td>
                  <td className="px-4 py-3">
                    <span className={p.is_active ? "rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700" : "rounded-full bg-stone-100 px-2.5 py-1 text-xs font-bold text-stone-400"}>
                      {p.is_active ? "نشطة" : "مخفية"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEdit(p)} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold text-stone-600 hover:bg-stone-100 transition">
                        <Pencil className="w-3.5 h-3.5" /> تعديل
                      </button>
                      <button onClick={() => del(p)} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold text-stone-500 hover:bg-rose-50 hover:text-rose-600 transition">
                        <Trash2 className="w-3.5 h-3.5" /> حذف
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={creating}
        title={editing ? "تعديل الصفحة" : "صفحة جديدة"}
        onClose={() => setCreating(false)}
        width="max-w-2xl"
        footer={
          <>
            <button onClick={() => setCreating(false)} className="rounded-xl px-4 py-2 text-sm font-bold text-stone-500 hover:bg-stone-100 transition">
              إلغاء
            </button>
            <button form="page-form" type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-gold px-4 py-2 text-sm font-bold text-white hover:bg-gold-light transition disabled:opacity-60">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} حفظ
            </button>
          </>
        }
      >
        <form id="page-form" onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label>
              <span className={labelCls}>عنوان الصفحة</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثال: الشروط والأحكام" className={inputCls} required />
            </label>
            <label>
              <span className={labelCls}>المعرّف (slug) — أحرف إنجليزية</span>
              <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="terms" dir="ltr" className={inputCls} required />
            </label>
          </div>
          <label>
            <span className={labelCls}>المحتوى</span>
            <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={12} placeholder="اكتب محتوى الصفحة... (كل سطر جديد يُعرض بفاصل)" className={`${inputCls} leading-relaxed`} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="accent-gold" />
            <span className="font-semibold text-stone-600">الصفحة نشطة (ظاهرة للعملاء)</span>
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
      </Modal>
    </div>
  );
}

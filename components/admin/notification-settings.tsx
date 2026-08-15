"use client";

import { useActionState, useEffect, useState } from "react";
import { Loader2, Save, Power, RefreshCcw, CheckCircle2, XCircle } from "lucide-react";
import { updateTemplateAction, updateRuleAction, toggleTemplateAction, toggleRuleAction, NOTIFICATION_SUPPORTED_VARIABLES } from "@/app/actions/notifications-admin";

type Template = {
  event_type: string;
  name: string;
  title: string;
  body: string;
  severity: string;
  category: string;
  channels: string[];
  is_active: boolean;
};

type Rule = {
  event_type: string;
  name: string;
  condition: Record<string, unknown>;
  channels: string[];
  recipients: string[];
  is_active: boolean;
};

type Channel = {
  code: string;
  name: string;
  description: string | null;
  enabled: boolean;
};

const CATEGORY_LABELS: Record<string, string> = {
  orders: "الطلبات",
  shipping: "الشحن",
  payment: "الدفع",
  returns: "المرتجعات",
  system: "النظام",
  security: "الأمان",
  webhook: "Webhook",
  marketing: "تسويق",
};

const CHANNEL_LABELS: Record<string, string> = {
  in_app: "داخل التطبيق",
  email: "بريد إلكتروني",
  sms: "SMS",
  push: "Push",
  whatsapp: "واتساب",
};

const ROLES = [
  { value: "admin", label: "مدير" },
  { value: "shipping_manager", label: "مسؤول شحن" },
  { value: "finance", label: "مالية" },
  { value: "customer_support", label: "دعم عملاء" },
];

const ALL_CHANNELS = ["in_app", "email", "sms", "push", "whatsapp"];

function ActionState({ state }: { state: unknown }) {
  const s = state as { success?: boolean; error?: string } | null;
  if (!s) return null;
  if (s.success)
    return (
      <p className="mt-2 flex items-center gap-1.5 text-xs font-bold text-emerald-600">
        <CheckCircle2 className="h-3.5 w-3.5" /> تم الحفظ
      </p>
    );
  return (
    <p className="mt-2 flex items-center gap-1.5 text-xs font-bold text-rose-600">
      <XCircle className="h-3.5 w-3.5" /> {s.error}
    </p>
  );
}

function TemplateEditor({ template }: { template: Template }) {
  const [state, formAction, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => updateTemplateAction(formData),
    null
  );
  const [previewTitle, setPreviewTitle] = useState(template.title);
  const [previewBody, setPreviewBody] = useState(template.body);

  return (
    <form action={formAction} className="rounded-2xl border border-sand bg-cream/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold text-ink">{template.name}</p>
        <button
          type="button"
          onClick={async () => {
            await toggleTemplateAction(template.event_type, !template.is_active);
            window.location.reload();
          }}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold transition ${template.is_active ? "bg-emerald-50 text-emerald-700" : "bg-stone-100 text-stone-500"}`}
        >
          <Power className="h-3 w-3" /> {template.is_active ? "مفعّل" : "معطّل"}
        </button>
      </div>
      <p className="mt-0.5 font-mono text-[11px] text-stone-400" dir="ltr">{template.event_type}</p>

      <input type="hidden" name="event_type" value={template.event_type} />
      <input type="hidden" name="name" value={template.name} />
      <input type="hidden" name="severity" value={template.severity} />
      <input type="hidden" name="category" value={template.category} />
      <input type="hidden" name="is_active" value={template.is_active ? "on" : "off"} />
      {ALL_CHANNELS.map((c) => (
        <input key={c} type="hidden" name="channels" value={c} />
      ))}

      <div className="mt-3 grid gap-3">
        <div>
          <label className="block text-[11px] font-bold text-stone-500">عنوان</label>
          <input
            name="title"
            value={previewTitle}
            onChange={(e) => setPreviewTitle(e.target.value)}
            className="mt-1 w-full rounded-xl border border-sand bg-white px-3 py-2 text-sm outline-none focus:border-gold"
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-stone-500">النص</label>
          <textarea
            name="body"
            value={previewBody}
            onChange={(e) => setPreviewBody(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-xl border border-sand bg-white px-3 py-2 text-sm outline-none focus:border-gold"
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-stone-500">معاينة</label>
          <div className="mt-1 rounded-xl border border-dashed border-amber-200 bg-white px-3 py-2 text-sm text-stone-700">
            <p className="font-bold">{previewTitle.replace(/\{\{\s*[\w]+\s*\}\}/g, "{{متغير}}")}</p>
            <p className="mt-0.5 text-xs text-stone-500">{previewBody.replace(/\{\{\s*[\w]+\s*\}\}/g, "{{متغير}}")}</p>
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-bold text-stone-500">المتغيرات المتاحة</label>
          <p className="mt-1 flex flex-wrap gap-1">
            {NOTIFICATION_SUPPORTED_VARIABLES.map((v) => (
              <span key={v} className="rounded bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] text-amber-700" dir="ltr">{"{{" + v + "}}"}</span>
            ))}
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button type="submit" disabled={pending} className="flex items-center gap-1.5 rounded-full bg-gold px-4 py-2 text-xs font-bold text-white transition hover:bg-gold-dark disabled:opacity-50">
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} حفظ
        </button>
        <ActionState state={state} />
      </div>
    </form>
  );
}

function RuleEditor({ rule }: { rule: Rule }) {
  const [state, formAction, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => updateRuleAction(formData),
    null
  );

  return (
    <form action={formAction} className="rounded-2xl border border-sand bg-cream/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-ink">{rule.name}</p>
          <p className="mt-0.5 font-mono text-[11px] text-stone-400" dir="ltr">{rule.event_type}</p>
        </div>
        <button
          type="button"
          onClick={async () => {
            await toggleRuleAction(rule.event_type, !rule.is_active);
            window.location.reload();
          }}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold transition ${rule.is_active ? "bg-emerald-50 text-emerald-700" : "bg-stone-100 text-stone-500"}`}
        >
          <Power className="h-3 w-3" /> {rule.is_active ? "مفعّل" : "معطّل"}
        </button>
      </div>

      <input type="hidden" name="event_type" value={rule.event_type} />
      <input type="hidden" name="name" value={rule.name} />
      <input type="hidden" name="is_active" value={rule.is_active ? "on" : "off"} />

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <label className="block text-[11px] font-bold text-stone-500">القنوات</label>
          <div className="mt-1 flex flex-wrap gap-2">
            {ALL_CHANNELS.map((c) => (
              <label key={c} className="flex items-center gap-1.5 rounded-lg border border-sand bg-white px-2.5 py-1.5 text-[11px] font-bold text-stone-600">
                <input type="checkbox" name="channels" value={c} defaultChecked={rule.channels.includes(c)} className="h-3.5 w-3.5 accent-gold" />
                {CHANNEL_LABELS[c] || c}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-bold text-stone-500">المستلمون</label>
          <div className="mt-1 flex flex-wrap gap-2">
            {ROLES.map((r) => (
              <label key={r.value} className="flex items-center gap-1.5 rounded-lg border border-sand bg-white px-2.5 py-1.5 text-[11px] font-bold text-stone-600">
                <input type="checkbox" name="recipients" value={r.value} defaultChecked={rule.recipients.includes(r.value)} className="h-3.5 w-3.5 accent-gold" />
                {r.label}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button type="submit" disabled={pending} className="flex items-center gap-1.5 rounded-full bg-gold px-4 py-2 text-xs font-bold text-white transition hover:bg-gold-dark disabled:opacity-50">
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} حفظ
        </button>
        <ActionState state={state} />
      </div>
    </form>
  );
}

export function NotificationSettings({ templates, rules, channels }: { templates: Template[]; rules: Rule[]; channels: Channel[] }) {
  const [tab, setTab] = useState<"templates" | "rules" | "channels">("templates");

  const byCategory: Record<string, Template[]> = {};
  for (const t of templates) {
    (byCategory[t.category] ||= []).push(t);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">إعدادات الإشعارات</h1>
          <p className="mt-1 text-sm text-stone-500">إدارة القوالب والقواعد والقنوات</p>
        </div>
        <div className="flex gap-1 rounded-full border border-sand bg-white p-1">
          {[
            { key: "templates", label: `القوالب (${templates.length})` },
            { key: "rules", label: `القواعد (${rules.length})` },
            { key: "channels", label: "القنوات" },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key as typeof tab)}
              className={`whitespace-nowrap rounded-full px-4 py-2 text-xs font-bold transition ${tab === t.key ? "bg-ink text-ivory" : "text-stone-600 hover:bg-cream"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "templates" && (
        <div className="space-y-4">
          {templates.length === 0 && <p className="rounded-2xl border border-sand bg-white p-8 text-center text-sm text-stone-400">لا توجد قوالب</p>}
          {Object.entries(byCategory).map(([cat, list]) => (
            <section key={cat}>
              <h2 className="mb-2 text-sm font-bold text-stone-500">{CATEGORY_LABELS[cat] || cat}</h2>
              <div className="grid gap-4 xl:grid-cols-2">
                {list.map((t) => (
                  <TemplateEditor key={t.event_type} template={t} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {tab === "rules" && (
        <div className="grid gap-4 xl:grid-cols-2">
          {rules.map((r) => (
            <RuleEditor key={r.event_type} rule={r} />
          ))}
        </div>
      )}

      {tab === "channels" && (
        <div className="rounded-3xl border border-sand bg-white p-4 md:p-6">
          <p className="text-xs text-stone-500">القنوات الخارجية تتطلب مفاتيح API من مزوّد الخدمة. القناة غير المفعّلة تخطى تسليمها تلقائيًا.</p>
          <div className="mt-4 space-y-3">
            {channels.map((ch) => (
              <div key={ch.code} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-cream/60 p-4">
                <div>
                  <p className="text-sm font-bold text-ink">{ch.name}</p>
                  <p className="mt-0.5 text-xs text-stone-500">{ch.description || "—"}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-[11px] font-bold ${ch.enabled ? "bg-emerald-50 text-emerald-700" : "bg-stone-100 text-stone-400"}`}>
                  {ch.enabled ? "مفعّلة" : "معطّلة"}
                </span>
              </div>
            ))}
            {channels.length === 0 && <p className="py-8 text-center text-sm text-stone-400">جدول القنوات غير متاح — شغّل SQL للترحيل أولاً</p>}
          </div>
          <p className="mt-4 flex items-center gap-1.5 text-[11px] text-stone-400">
            <RefreshCcw className="h-3 w-3" /> تحديث القنوات يتم يدويًا في قاعدة البيانات أو عبر SQL.
          </p>
        </div>
      )}
    </div>
  );
}

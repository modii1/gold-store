"use client";

import { useActionState, useCallback, useEffect, useState } from "react";
import { Loader2, Save, Power, RefreshCcw, CheckCircle2, XCircle, Pause, Play, Wifi, WifiOff, ScanLine, ExternalLink } from "lucide-react";
import { updateTemplateAction, updateRuleAction, toggleTemplateAction, toggleRuleAction, updateChannelAction, setNotificationsPausedAction } from "@/app/actions/notifications-admin";
import { SUPPORTED_VARIABLES } from "@/lib/notifications/templates";
import { CHANNEL_CONFIG_FIELDS } from "@/lib/notifications/channel-config";

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
  config?: Record<string, string> | null;
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
            {SUPPORTED_VARIABLES.map((v) => (
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

function WhatsAppBridgePanel({ config }: { config?: Record<string, string> | null }) {
  const [status, setStatus] = useState<{
    connected: boolean;
    qr_state: string;
    phone: string | null;
    last_seen: string | null;
    bridge_url: string;
    enabled: boolean;
  } | null>(null);
  const [busy, setBusy] = useState<"ping" | "qr" | null>(null);
  const [ping, setPing] = useState<string | null>(null);
  const [qrImg, setQrImg] = useState<string | null>(null);
  const [qrMsg, setQrMsg] = useState<string | null>(null);

  const url = ((status?.bridge_url || config?.bridge_url) || "").replace(/\/+$/, "");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/notifications/whatsapp-status", { cache: "no-store" });
      if (res.ok) setStatus(await res.json());
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  const pingBridge = async () => {
    if (!url) return setPing("أدخل رابط سيرفر الواتساب (QR) واحفظ أولاً.");
    setBusy("ping");
    setPing(null);
    try {
      const res = await fetch("/api/admin/notifications/whatsapp-bridge?path=health", { cache: "no-store" });
      if (!res.ok) {
        let proxyMsg: string | null = null;
        try {
          proxyMsg = (await res.json())?.error || null;
        } catch {
          // ignore body parse errors
        }
        setPing(proxyMsg || `السيرفر أجاب برمز ${res.status} — تأكد من صحة المفتاح (إن ضُبط).`);
      } else {
        const j = await res.json();
        setPing(j.connected ? "متصل بالواتساب — جاهز لإرسال الإشعارات." : "السيرفر يعمل لكن غير متصل بواتساب — لا يزال ينتظر مسح QR.");
      }
    } catch {
      setPing("لا يمكن الوصول إلى السيرفر — تأكد أنه يعمل وأن الرابط (مع البورت) صحيح.");
    } finally {
      setBusy(null);
    }
  };

  const showQr = async () => {
    if (!url) return setQrMsg("أدخل رابط سيرفر الواتساب (QR) واحفظ أولاً.");
    setBusy("qr");
    setQrMsg(null);
    setQrImg(null);
    try {
      const res = await fetch("/api/admin/notifications/whatsapp-bridge?path=qr", { cache: "no-store" });
      if (!res.ok) {
        let proxyMsg: string | null = null;
        try {
          proxyMsg = (await res.json())?.error || null;
        } catch {
          // ignore body parse errors
        }
        setQrMsg(proxyMsg || (res.status === 401 ? "المفتاح مرفوض — تأكد من «مفتاح سيرفر الواتساب»." : `السيرفر أجاب برمز ${res.status}.`));
      } else {
        const j = await res.json();
        if (j.connected) setQrMsg("السيرفر متصل بالفعل بالواتساب، لا حاجة لرمز QR.");
        else if (j.qr_png) setQrImg(j.qr_png);
        else if (j.qr) setQrMsg("الرمز متاح في الطرفية أو عبر فتح صفحة السيرفر وتحميل الرمز.");
        else setQrMsg("لا يوجد رمز QR حالياً — أعد تشغيل السيرفر أو احذف مجلد auth-info.");
      }
    } catch {
      setQrMsg("لا يمكن الوصول إلى السيرفر لعرض الرمز.");
    } finally {
      setBusy(null);
    }
  };

  const connected = status?.connected || false;
  const qrState = status?.qr_state || "idle";

  return (
    <div className="mt-4 rounded-2xl border border-sand bg-white p-4">
      <p className="flex items-center gap-1.5 text-xs font-bold text-ink">
        <Wifi className="h-3.5 w-3.5 text-gold" /> حالة سيرفر الواتساب (QR)
      </p>

      <div className="mt-2 flex items-center gap-2 text-xs">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-bold ${connected ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-600"}`}>
          {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
          {connected ? "متصل بالواتساب" : "غير متصل"}
        </span>
        {!connected && qrState === "waiting_qr" && status?.enabled && (
          <span className="rounded-full bg-amber-50 px-2.5 py-1 font-bold text-amber-700">بانتظار مسح رمز QR</span>
        )}
        {status?.phone && (
          <span className="rounded-full bg-cream px-2.5 py-1 font-semibold text-stone-600" dir="ltr">+{status.phone}</span>
        )}
      </div>

      {status?.last_seen && (
        <p className="mt-1.5 text-[11px] text-stone-400">
          آخر اتصال: <span dir="ltr">{status.last_seen.replace("T", " ").slice(0, 19)}</span>
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={pingBridge} disabled={busy !== null} className="flex items-center gap-1.5 rounded-full border border-sand px-3 py-1.5 text-[11px] font-bold text-stone-700 transition hover:bg-cream disabled:opacity-50">
          {busy === "ping" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCcw className="h-3 w-3" />} فحص الاتصال
        </button>
        <button type="button" onClick={showQr} disabled={busy !== null} className="flex items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-[11px] font-bold text-ivory transition hover:opacity-90 disabled:opacity-50">
          {busy === "qr" ? <Loader2 className="h-3 w-3 animate-spin" /> : <ScanLine className="h-3 w-3" />} عرض رمز QR
        </button>
        {url && (
          <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-full border border-sand px-3 py-1.5 text-[11px] font-bold text-stone-700 transition hover:bg-cream">
            <ExternalLink className="h-3 w-3" /> صفحة السيرفر
          </a>
        )}
      </div>

      {ping && <p className="mt-2 text-[11px] font-semibold text-stone-600">{ping}</p>}
      {qrMsg && <p className="mt-2 text-[11px] font-semibold text-amber-700">{qrMsg}</p>}
      {qrImg && (
        <img
          src={qrImg}
          alt="رمز QR"
          className="mt-3 h-44 w-44 rounded-xl border border-sand bg-white p-2"
          style={{ imageRendering: "pixelated" }}
        />
      )}
      {ping && ping.startsWith("متصل بالواتساب") && <p className="mt-1.5 text-[10px] text-stone-400">الرقم الذي يظهر أعلاه يستقبل إشعارات الإدارة.</p>}
    </div>
  );
}

function ChannelEditor({ channel }: { channel: Channel }) {
  const [state, formAction, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => updateChannelAction(formData),
    null
  );
  const fields = CHANNEL_CONFIG_FIELDS[channel.code] || [];
  const [enabled, setEnabled] = useState(channel.enabled);
  const isInApp = channel.code === "in_app";

  return (
    <form action={formAction} className="rounded-2xl border border-sand bg-cream/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className={`h-2.5 w-2.5 rounded-full ${channel.enabled ? "bg-emerald-500" : "bg-stone-300"}`} />
          <div>
            <p className="text-sm font-bold text-ink">{channel.name}</p>
            {channel.description && <p className="mt-0.5 text-[11px] text-stone-400">{channel.description}</p>}
          </div>
        </div>
        {!isInApp && (
          <label className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold transition ${enabled ? "bg-emerald-50 text-emerald-700" : "bg-stone-100 text-stone-500"}`}>
            <input
              type="checkbox"
              name="enabled"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-3.5 w-3.5 accent-gold"
            />
            {enabled ? "مفعّلة" : "معطّلة"}
          </label>
        )}
      </div>

      <input type="hidden" name="code" value={channel.code} />
      {isInApp && <input type="hidden" name="enabled" value="on" />}

      {!isInApp && (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {fields.map((f) => (
            <div key={f.key}>
              <label className="block text-[11px] font-bold text-stone-500">{f.label}</label>
              <input
                name={f.key}
                type={f.type === "password" ? "password" : "text"}
                defaultValue={channel.config?.[f.key] || ""}
                placeholder={f.placeholder}
                autoComplete="off"
                className="mt-1 w-full rounded-xl border border-sand bg-white px-3 py-2 text-sm outline-none focus:border-gold"
              />
              {f.hint && <p className="mt-0.5 text-[10px] text-stone-400">{f.hint}</p>}
            </div>
          ))}
        </div>
      )}

      {channel.code === "whatsapp" && <WhatsAppBridgePanel config={channel.config} />}

      {!isInApp && (
        <div className="mt-3 flex items-center gap-2">
          <button type="submit" disabled={pending} className="flex items-center gap-1.5 rounded-full bg-gold px-4 py-2 text-xs font-bold text-white transition hover:bg-gold-dark disabled:opacity-50">
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} حفظ الإعدادات
          </button>
          <ActionState state={state} />
        </div>
      )}
    </form>
  );
}

function PauseToggle({ paused }: { paused: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const toggle = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await setNotificationsPausedAction(!paused);
      if (r?.success) window.location.reload();
      else setMsg((r as { error?: string } | null)?.error || "تعذر الحفظ");
    } catch {
      setMsg("تعذر الحفظ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        onClick={toggle}
        disabled={busy}
        className={`flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold transition disabled:opacity-50 ${
          paused ? "bg-amber-100 text-amber-800 hover:bg-amber-200" : "bg-ink text-ivory hover:opacity-90"
        }`}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : paused ? (
          <Play className="h-3.5 w-3.5" />
        ) : (
          <Pause className="h-3.5 w-3.5" />
        )}
        {paused ? "استئناف القنوات" : "إيقاف مؤقت"}
      </button>
      {msg && <p className="text-[11px] font-bold text-rose-600">{msg}</p>}
    </div>
  );
}

export function NotificationSettings({ templates, rules, channels, paused }: { templates: Template[]; rules: Rule[]; channels: Channel[]; paused: boolean }) {
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
        <div className="flex items-center gap-3">
          <PauseToggle paused={paused} />
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
      </div>

      {paused && (
        <div className="rounded-3xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-800">
          <span className="font-bold">الإيقاف المؤقت مفعّل —</span> جميع القنوات (بريد، SMS، واتساب، Push، داخل التطبيق) لا تُرسل أي إشعار حالياً. فعّل «استئناف القنوات» لاستعادة العمل.
        </div>
      )}

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
        <div className="space-y-4">
          <div className="rounded-3xl border border-amber-100 bg-amber-50/50 px-4 py-3 text-xs text-amber-800">
            القنوات الخارجية (SMS، واتساب، بريد، Push) تتطلب مفاتيح API من مزوّد الخدمة.
            املأ الحقول ثم اضغط "حفظ الإعدادات". القناة غير المفعّلة تخطى تسليمها تلقائيًا.
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            {channels.map((ch) => (
              <ChannelEditor key={ch.code} channel={ch} />
            ))}
            {channels.length === 0 && <p className="rounded-2xl border border-sand bg-white p-8 text-center text-sm text-stone-400">جدول القنوات غير متاح — شغّل SQL للترحيل أولاً</p>}
          </div>
          <p className="flex items-center gap-1.5 text-[11px] text-stone-400">
            <RefreshCcw className="h-3 w-3" /> تُحفظ الإعدادات في قاعدة البيانات وتطبَّق فورًا على محرك الإشعارات.
          </p>
        </div>
      )}
    </div>
  );
}

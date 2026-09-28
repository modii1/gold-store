-- ============================================================
-- gold-store migration 037: recovery control plane (settings + case events)
--
-- ⚠ DRAFT — لم تُطبّق بعد. لا تُشغّل إلا بعد موافقة صريحة.
-- ============================================================
--
-- الترتيب الإلزامي: 034 → 035 → 036 → 037 → 038
--   (037 يشير بـFK إلى recovery_cases من 034، فلا ينفع قبله)
--
-- الغرض: طبقتان أساس مركز تحكم الاسترجاع، ولا شيء غير ذلك.
--   1) recovery_settings   : صف إعدادات واحد (jsonb) يتجاوز بيئة النشر.
--   2) recovery_case_events: سجل أحداث الحالة (append-only) لسجل تفصيلي.
--
-- ما لا يفعله هذا الملف (مهم):
--  - لا يغيّر recovery_cases ولا recovery_contact_attempts ولا settings.
--  - لا يضيف أعمدة إلى orders / customers / products / notifications.
--  - لا ينشئ أي جدول خصومات ولا أكواد.
--  - لا يغيّر RLS لأي جدول قائم، ولا يضيف وصولًا لـanon / authenticated.
--  - لا يحتوي بيانات تجريبية ولا seed (الصف الواحد لـrecovery_settings
--    استثناء ضروري: بدونه تفشل القراءة بـmaybeSingle، فكذلك fallback).
--
-- RLS: service_role فقط على الجدولين. المتصفح لا يقرأ ولا يكتب إطلاقًا؛
-- كل القراءة والكتابة server-side من لوحة الإدارة ودورة الاسترجاع.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- RECOVERY SETTINGS (صف واحد) ----------
create table if not exists recovery_settings (
  id         int primary key default 1,
  -- تجاوزات اختيارية فقط. أي حقل غائب = تُبقى قيمة البيئة (RECOVERY_*).
  config     jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text,

  -- جدول صف واحد: لا صفّ ثانٍ ولا id مختلف.
  constraint recovery_settings_singleton check (id = 1),
  -- updated_at يُدار من التطبيق فقط.
  constraint recovery_settings_has_config check (jsonb_typeof(config) = 'object')
);

-- الصف الوحيد. لا seed لبيانات إعدادات: الافتراضي = '{}' = سلوك البيئة.
insert into recovery_settings (id) values (1) on conflict (id) do nothing;

-- ---------- RECOVERY CASE EVENTS (append-only) ----------
create table if not exists recovery_case_events (
  id         bigint generated always as identity primary key,
  -- on delete cascade: حذف الحالة يحذف سجلها، ولا يترك أحداثًا يتيمة.
  case_id    uuid not null references recovery_cases(id) on delete cascade,
  event_type text not null,
  stage_key  text,
  -- بلا FK هنا: recovery_templates يُنشأ في 038، والـFK يُضاف هناك.
  template_id bigint,
  -- سطر واحد بالعربية للعرض في اللوحة، بلا تفسير تقني.
  summary_ar text not null default '',
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  -- مفردات مغلقة: لا tipos مفتوحة. إضافة نوع = migration جديدة.
  constraint recovery_case_events_type_check check (event_type in (
    'signal','case_created','stage_entered','evaluated','decision',
    'message_queued','delivery_status','message_sent','settled',
    'suppressed','closed','closed_purchase'
  )),
  constraint recovery_case_events_summary_len check (length(summary_ar) <= 500),
  constraint recovery_case_events_payload_object check (jsonb_typeof(payload) = 'object')
);

-- ---------- الفهارس ----------
-- الخط الزمني لحالة واحدة (الأحدث أولًا في الواجهة)
create index if not exists idx_recovery_case_events_case
  on recovery_case_events (case_id, created_at desc);

-- تصفية السجل بالنوع (مثال: كل message_sent لقياس الإرسال)
create index if not exists idx_recovery_case_events_type
  on recovery_case_events (event_type, created_at desc);

-- آخر حدث لحالة (الوضع السريع في قائمة الحالات)
create index if not exists idx_recovery_case_events_recent
  on recovery_case_events (created_at desc);

-- ---------- RLS: service_role فقط ----------
alter table recovery_settings enable row level security;
alter table recovery_case_events enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'service read recovery_settings') then
    create policy "service read recovery_settings" on recovery_settings for select to service_role using (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'service update recovery_settings') then
    create policy "service update recovery_settings" on recovery_settings for update to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'service insert recovery_settings') then
    create policy "service insert recovery_settings" on recovery_settings for insert to service_role with check (true);
  end if;
  -- لا سياسة delete: لا صف ثانٍ ولا حذف مطلوب.

  if not exists (select 1 from pg_policies where policyname = 'service read recovery_case_events') then
    create policy "service read recovery_case_events" on recovery_case_events for select to service_role using (true);
  end if;
  -- insert فقط: السجل append-only. لا update ولا delete عبر service_role أيضًا،
  -- فالتعديل/الحذف عبر cascade من recovery_cases فقط.
  if not exists (select 1 from pg_policies where policyname = 'service insert recovery_case_events') then
    create policy "service insert recovery_case_events" on recovery_case_events for insert to service_role with check (true);
  end if;
end $$;

-- لا توجد سياسة لـ anon / authenticated: المتصفح لا يقرأ ولا يكتب هذين
-- الجدولين إطلاقًا. القراءة server-side فقط (لوحة الإدارة + دورة الاسترجاع).

notify pgrst, 'reload schema';

-- ============================================================
-- لم يُطبّق. يتطلب موافقة صريحة على:
--   1) إنشاء جدولين + 3 فهارس على سجل الأحداث.
--   2) RLS service_role فقط (بلا وصول public) + insert بلا update/delete
--      على سجل الأحداث (append-only).
--   3) صف settings واحد (id=1) — INSERT وحيد لا seed بيانات.
--   4) مفردات event_type مغلقة بـcheck: أي نوع جديد = migration جديدة.
--   5) الربط بـrecovery_cases (cascade): حذف حالة يحذف سجلها.
-- ============================================================

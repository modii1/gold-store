-- ============================================================
-- gold-store migration 039: recovery_templates (standalone, Phase 3)
--
-- ⚠ DRAFT — لم تُطبّق بعد. لا تُشغّل إلا بعد موافقة صريحة.
-- ============================================================
--
-- الترتيب: 037 ثم 039 (مع 038 قبل أو بعد — كل الحالات آمنة):
--   - 039 يشير إلى recovery_case_events من 037 (FK اختياري على
--     recovery_case_events.template_id).
--   - FK من recovery_stages.template_id يضاف هنا فقط إن لم يكن موجودًا
--     (أي إن لم يُطبَّق 038 قبل 039). إن طُبّق 038 أولًا يصبح الـFK
--     المضمّن في create table recovery_stages موجودًا، وكتلة 039 تكتشفه
--     فلا تكرّره. وإن لم يُطبَّق 038 أصلًا فلا يوجد جدول recovery_stages
--     فيُتخطّى الربط — يأتي مع 038 لاحقًا.
--   صيغ الـFK تحتاج وجود جدول recovery_templates، وهذا الملف ينشئه
--   create table if not exists فلا يتعارض مع 038 (idempotent).
--
-- الغرض (مرحلة 3 «القوالب المستقلة»): كائن recovery_templates وحده،
--   كيانًا مستقلاً بذاته مع CRUD كامل من لوحة الإدارة. المراحل تربطها
--   عبر template_id (FK هنا وفوق 038 إن وُجد). لا شيء آخر في هذا الملف.
--
-- ما لا يفعله هذا الملف (مهم):
--  - لا يغيّر recovery_cases ولا recovery_settings ولا recovery_stages
--    إلا إضافةFK اختيارية واحدة على recovery_stages.template_id
--    (nullable، on delete set null — حذف قالب لا يمسح ربطًا ولا تاريخًا).
--  - لا يغيّر جداول Notification Center (notification_templates ومحرّكها).
--  - لا ينشئ جدول خصومات ولا أكواد ولا يعدّل settings العامة.
--  - لا seed: القوالب تُنشأ من الواجهة (بلا نص قديم في القاعدة).
--  - لا يغيّر RLS لأي جدول قائم، ولا يضيف وصولًا لـanon / authenticated.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- RECOVERY TEMPLATES (جدول مستقل) ----------
create table if not exists recovery_templates (
  id         bigint generated always as identity primary key,
  -- مفتاح مستقر: يُستخدم في السجل والربط، لا يتغيّر بتغيّر الاسم.
  key        text not null,
  -- اسم عربي للواجهة وحسب؛ ليس نص الرسالة.
  name_ar    text not null,
  -- قناة واحدة مدعومة اليوم: واتساب عبر المسار القائم. لا قناة جديدة هنا.
  channel    text not null default 'whatsapp',
  -- عنوان اختياري غير مُستخدَم في الإرسال بعد (تحضيري داخلي).
  title      text not null default '',
  -- نص الرسالة بصيغة المتغيرات {{variable}}.
  body       text not null default '',
  is_active  boolean not null default true,
  version    integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint recovery_templates_key_unique unique (key),
  constraint recovery_templates_key_format check (key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint recovery_templates_channel_check check (channel in ('whatsapp')),
  constraint recovery_templates_title_len check (length(title) <= 200),
  constraint recovery_templates_body_len check (length(body) <= 2000),
  constraint recovery_templates_name_len check (length(name_ar) between 1 and 120),
  constraint recovery_templates_version_positive check (version >= 1)
);

create index if not exists idx_recovery_templates_active
  on recovery_templates (is_active, key);

-- ---------- الربط بمراحل الاسترجاع ----------
-- on delete set null: حذف القالب يُفكّ الربط ولا يحذف مرحلة ولا يمسح تاريخًا.
-- الحراسة ليست باسم القيد بل بالعمود: سواء وُجد FK مضمّن من 038
-- (auto-named recovery_stages_template_id_fkey) أو قيد سابق باسم آخر،
-- لا يُضاف قيد ثانٍ على template_id أبدًا. وإن لم يوجد جدول recovery_stages
-- (038 غير مُطبَّق) فتُتخطّى هذه الكتلة بأمان.
do $$ begin
  if exists (
    select 1
    from information_schema.tables t
    where t.table_schema = 'public' and t.table_name = 'recovery_stages'
  ) and not exists (
    select 1
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.contype = 'f'
      and c.conrelid = 'recovery_stages'::regclass
      and a.attname = 'template_id'
  ) then
    alter table recovery_stages
      add constraint recovery_stages_template_fk
      foreign key (template_id) references recovery_templates(id) on delete set null;
  end if;
end $$;

-- ---------- الربط بسجل أحداث الحالة (اختياري، غير مستخدم بعد) ----------
-- نفس الحراسة بالعمود: جدول من 037 يجب أن يكون موجودًا، وبشرط غياب أي
-- FK سابق على template_id (أيًا كان اسمه).
do $$ begin
  if exists (
    select 1
    from information_schema.tables t
    where t.table_schema = 'public' and t.table_name = 'recovery_case_events'
  ) and not exists (
    select 1
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.contype = 'f'
      and c.conrelid = 'recovery_case_events'::regclass
      and a.attname = 'template_id'
  ) then
    alter table recovery_case_events
      add constraint recovery_case_events_template_fk
      foreign key (template_id) references recovery_templates(id) on delete set null;
  end if;
end $$;

-- ---------- RLS: service_role فقط ----------
alter table recovery_templates enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'service read recovery_templates') then
    create policy "service read recovery_templates" on recovery_templates for select to service_role using (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'service insert recovery_templates') then
    create policy "service insert recovery_templates" on recovery_templates for insert to service_role with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'service update recovery_templates') then
    create policy "service update recovery_templates" on recovery_templates for update to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'service delete recovery_templates') then
    create policy "service delete recovery_templates" on recovery_templates for delete to service_role using (true);
  end if;
end $$;

-- لا توجد سياسة لـ anon / authenticated: المتصفح لا يقرأ ولا يكتب
-- جدول القوالب إطلاقًا. القراءة والكتابة server-side فقط (لوحة الإدارة).

notify pgrst, 'reload schema';

-- ============================================================
-- لم يُطبّق. يتطلب موافقة صريحة على:
--   1) إنشاء recovery_templates (idempotent مع 038 إن طُبّق قبله).
--   2) RLS service_role فقط (بلا وصول public).
--   3) FK من recovery_stages.template_id (on delete set null) — الربط
--      بمراحل الاسترجاع؛ لا تغيير لا في المراحل ولا في السجل.
--   4) بلا seed — القوالب تُنشأ من واجهة الإدارة.
-- ============================================================
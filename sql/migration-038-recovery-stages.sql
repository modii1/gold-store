-- ============================================================
-- gold-store migration 038: recovery stages
--
-- ⚠ DRAFT — لم تُطبّق بعد. لا تُشغّل إلا بعد موافقة صريحة.
-- ============================================================
--
-- ملكية recovery_templates في migration-039 وحدها (الجدول + الفهرس +
-- السياسات). هذا الملف لا يعيد إنشاء القوالب إطلاقًا — يمسك ما يخص
-- recovery_stages فقط:
--   1) recovery_stages            : جدول المراحل (الملكية هنا).
--   2) FK stages.template_id → templates  (null = الرسالة الافتراضية).
--   3) FK events.template_id → templates  (اختياري، من 037).
--
-- الترتيب:
--   هذا الملف يعتمد على 037 (recovery_case_events) لكتلة الربط بسجل
--   الأحداث — وهي كتلة اختيارية تُتخطّى بأمان إن غاب الجدول. أما الترتيب
--   مع 039 فمفتوح: كل من 038 و039 يعمل قبل أو بعد الآخر، لأن ربط كل FK
--   مشروط بوجود recovery_templates وبغياب أي FK سابق على العمود —
--   بلا DDL مكرر، وبلا فشل على أي ترتيب.
--
-- ما لا يفعله هذا الملف (مهم):
--  - لا ينشئ recovery_templates ولا فهارسها ولا سياساتها (039 تملكها).
--  - لا يغيّر recovery_cases ولا recovery_settings ولا recovery_case_events
--    إلا إضافة FK اختيارية واحدة على template_id (nullable، بلا مسح تاريخ).
--  - لا يضيف أعمدة إلى orders / customers / products / notifications.
--  - لا ينشئ جدول خصومات ولا أكواد.
--  - لا يغيّر RLS لأي جدول قائم، ولا يضيف وصولًا لـanon / authenticated.
--  - لا seed: القوالب والمراحل تُنشأ من واجهة الإدارة لاحقًا.
-- ============================================================

-- ---------- RECOVERY STAGES ----------
create table if not exists recovery_stages (
  id                 bigint generated always as identity primary key,
  key                text not null,
  name_ar            text not null,
  -- 1 = أول خطوة. غير فريد عمدًا: تبديل موضعين لا يكسر أي قيد أثناء
  -- إعادة الترتيب من الواجهة، والفرز عند القراءة (position, key) حتمي.
  position           integer not null,
  -- التأخير بالدقائق منذ first_detected_at.
  delay_minutes      integer not null,
  -- قالب اختياري: null = تُستخدم الرسالة الافتراضية القائمة في الكود.
  -- بلا FK مضمّن هنا رغم أنه العمود المعني: يُربط بكتلة الحراسة بالأسفل،
  -- فلا يشترط 038 ترتيبًا معيّنًا مع 039 (يُكمّل 039 الربط إن سبق).
  template_id        bigint,
  is_active          boolean not null default true,
  -- نهائية: بلا مرحلة تالية — تُغلق الحالة بعدها بدل المتابعة.
  is_terminal        boolean not null default false,
  -- سقف رسائل اختياطي لهذه المرحلة (null = يتبع maxMessages العام).
  max_total_messages integer,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint recovery_stages_key_unique unique (key),
  constraint recovery_stages_key_format check (key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint recovery_stages_name_len check (length(name_ar) between 1 and 120),
  constraint recovery_stages_position_positive check (position >= 1),
  constraint recovery_stages_delay_nonneg check (delay_minutes >= 0),
  constraint recovery_stages_max_messages_positive check (
    max_total_messages is null or max_total_messages >= 1
  )
);

create index if not exists idx_recovery_stages_order
  on recovery_stages (position, key);

create index if not exists idx_recovery_stages_active
  on recovery_stages (is_active, position);

-- ---------- الربط الاختياري بالقالب (القالب نفسه من 039) ----------
-- الحراسة على كل كتلة: وجود جدول recovery_templates + غياب أي FK سابق
-- على العمود أيًا كان اسمه. هكذا يعمل 038 قبل 039 (يُكمله 039 لاحقًا)
-- وبعد 039 (يتخطّى بأمان)، ويعاد تشغيله بلا أثر.

-- مرحلة → قالب: on delete set null — حذف قالب يُفكّ الربط ولا يحذف مرحلة
-- ولا يمسح تاريخًا.
do $$ begin
  if exists (
    select 1
    from information_schema.tables t
    where t.table_schema = 'public' and t.table_name = 'recovery_templates'
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

-- سجل الأحداث → قالب (اختياري، غير مستخدم بعد): نفس الحراسة بالعمود +
-- شرط وجود الجدولين.
do $$ begin
  if exists (
    select 1
    from information_schema.tables t
    where t.table_schema = 'public' and t.table_name = 'recovery_case_events'
  ) and exists (
    select 1
    from information_schema.tables t
    where t.table_schema = 'public' and t.table_name = 'recovery_templates'
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

-- ---------- RLS: service_role فقط على المراحل ----------
alter table recovery_stages enable row level security;

do $$ begin
  -- المراحل: قراءة/كتابة كاملة. الإعادة الترتيب = تحديث position فقط.
  if not exists (select 1 from pg_policies where policyname = 'service read recovery_stages') then
    create policy "service read recovery_stages" on recovery_stages for select to service_role using (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'service insert recovery_stages') then
    create policy "service insert recovery_stages" on recovery_stages for insert to service_role with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'service update recovery_stages') then
    create policy "service update recovery_stages" on recovery_stages for update to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'service delete recovery_stages') then
    create policy "service delete recovery_stages" on recovery_stages for delete to service_role using (true);
  end if;
end $$;

-- لا توجد سياسة لـ anon / authenticated على المراحل: القراءة والكتابة
-- server-side فقط (لوحة الإدارة + دورة الاسترجاع).

notify pgrst, 'reload schema';

-- ============================================================
-- لم يُطبّق. يتطلب موافقة صريحة على:
--   1) إنشاء recovery_stages + فهرسين.
--   2) RLS service_role فقط على المراحل.
--   3) FK من recovery_stages إلى recovery_templates (on delete set null)
--      وFK من recovery_case_events إلى recovery_templates — كلاهما مشروط
--      بوجود recovery_templates (039) وبغياب FK سابق على العمود، فترتيب
--      038 مع 039 مفتوح (أي من الاتجاهين) والجدولان يبدآن بلا DDL مكرر.
--   4) position غير فريد عمدًا (إعادة ترتيب بلا كسر قيد).
--   5) بلا seed — القوالب والمراحل تُنشأ من واجهة الإدارة.
--
-- أثر التطبيق على السلوك: لا شيء تلقائيًا. جدول
--   recovery_stages فارغ = يبقى المحرك على remindersMinutes كما هو
--   (fallback في lib/recovery/stages.ts).
-- ============================================================
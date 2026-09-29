-- =====================================================================
-- G6-D — أساس قسيمة الاسترجاع (Production-ready foundation)
-- =====================================================================
-- ⚠️ مسودة للمراجعة — لم تُنفَّذ. راجعها قبل أي تطبيق على الإنتاج.
--
-- الهدف: تمكين Recovery من ربط عميل بحالة استرجاع وربط قسيمة بكل منهما،
-- مع ضمان server-side لثلاثة أشياء لا يصح أن تعتمد على الكود ولا الواجهة:
--   1) سقف الخصم (max_discount) محفوظ في الصف، لا محسوب في المتصفح.
--   2) ربط العميل (customer_identifier) محفوظ في الصف، ويرفضه الخادم.
--   3) قسيمة واحدة لكل حالة استرجاع — قيد فريد، لا فحص ثم إدراج.
--
-- ---------------------------------------------------------------------
-- الحالة قبل هذا الملف (migration-002.sql:60-72)
-- ---------------------------------------------------------------------
--   `coupons`: code فريد، type، value، min_order، starts_at، ends_at،
--   usage_limit، used_count، is_active. لا `scope` ولا `source` ولا ربط
--   ولا سقف مبلغ:
--     - بلا customer_identifier ⇒ قسيمة استرجاع تصلكل أي عميل يدخلها.
--     - بلا max_discount ⇒ سياسة "حتى 50 ر.س" غير قابلة للتمثيل: قسيمة
--       10% على سلة 1000 = 100 ر.س، وcheckout يحسب من صف coupons لا من
--       إعدادات Recovery.
--     - الاستهلاك كان compare-and-set في التطبيق (lib/coupons/usage.ts):
--       يمنع lost update لكنه ليس ذرّيًا مع إدراج الطلب.
--
-- ---------------------------------------------------------------------
-- ما يضيفه هذا الملف
-- ---------------------------------------------------------------------
--   1) خمسة أعمدة: scope، source، customer_identifier، recovery_case_id،
--      max_discount — كلها idempotent.
--   2) مفتاح أجنبي recovery_case_id → recovery_cases(id) ON DELETE SET NULL.
--   3) قيود الشكل: scope ∈ {public, customer}، source ∈ {manual, recovery}،
--      وقسيمة recovery لا بد أن تكون: scope='customer' + usage_limit=1 +
--      customer_identifier غير فارغ + recovery_case_id غير فارغ + سقف مبلغ
--      صالح (غير سالب).
--   4) قيد سقف النسبة لقسائم recovery فقط (value ضمن السياسة).
--   5) فهرس فريد جزئي على recovery_case_id ⇒ قسيمة واحدة لكل حالة.
--   6) فهرس جزئي على customer_identifier.
--   7) redeem_coupon ذرّية (SECURITY DEFINER + FOR UPDATE + search_path مثبّت)
--      مع إذن service_role وحده.
--
-- ---------------------------------------------------------------------
-- ⚠️ صراحةً: ما لا يفعله هذا الملف
-- ---------------------------------------------------------------------
--   لا triggers. لا cron. لا trigger استهلاك قسيمة. لا trigger طلبات.
--   لا دالة create_order_with_coupon. مصدر الاستهلاك الوحيد هو checkout
--   (app/actions/orders.ts عبر lib/coupons/redeem.ts). أي سلوك قاعدة
--   إضافي يضاف في migration منفصلة بعد مراجعة مستقلة.
--
-- ---------------------------------------------------------------------
-- سلامة الصفحات الموجودة (legacy safety) — اقرأ قبل التطبيق
-- ---------------------------------------------------------------------
--   · الأعمدة الجديدة nullable أو لها default، فكل صف قديم يُملأ:
--     source='manual'، scope='public'، customer_identifier=null،
--     recovery_case_id=null، max_discount=null. لا صف قديم يُرفض.
--   · ترتيب مهم: يُضبط default ويجري backfill على NULL ثم set not null،
--     وقبل ذلك فقط يُضاف قيد scope. لو أُضيف القيد قبل الـbackfill
--     لفشل التطبيق على الجدول كاملًا (NULL ∉ ('public','customer')).
--   · كل قيد شكل أو نسبة مُحصَر بـsource='recovery' وsource القديم لا يساوي
--     recovery أبدًا على صف قديم، فمثال "قسيمة 25% يدوية" لا يخالف
--     قيد نسبة 10% الخاص بالاسترجاع.
--   · الفهارس الجزئية على أعمدة NULL تمامًا في الجداول القديمة ⇒ تُبنى
--     فورًا وبلا مسح فعلي، ولا يمكن أن تتعارض.
--   · المفتاح الأجنبي: كل الصفوف القديمة recovery_case_id = NULL ⇒ لا
--     تحقق ولا فشل تحقق.
--   · إن كان مسودة سابقة من هذا الملف طُبِّقت على بيئة، فإن القيد
--     `coupons_recovery_binding_check` القديم بنطاق 'recovery' يُسقط هنا
--     صراحةً حتى لا تتعارض النمطان.
--
-- ملاحظتان للمراجع (قرارات مقصودة، لا إهمال):
--   أ) قفل: كل DDL هنا يأخذ ACCESS EXCLUSIVE على coupons لحظيًا، و
--      backfill يكتب الصفوف. نفِّذ في نافذة صيانة كما كل migration.
--   ب) ON DELETE SET NULL يتعارض ظاهريًا مع قيد الشكل: حذف حالة
--      استرجاع ما زالت تحمل قسيمة ⇒ يفشل الحذف بخطأ CHECK. هذا الاتجاه
--      الآمن (لا تُمحى القسيمة ولا يفقد العميل سجلّه). البديل لو أردت
--      cascade هو ON DELETE CASCADE — قرار مالك، لا افتراض.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) الأعمدة
-- ---------------------------------------------------------------------
-- `if not exists` يجعل الملف قابلًا لإعادة التطبيق على بيئة جزئياً مُطبَّق.
alter table public.coupons add column if not exists max_discount numeric;
alter table public.coupons add column if not exists scope text;
alter table public.coupons add column if not exists customer_identifier text;
alter table public.coupons add column if not exists recovery_case_id uuid;
alter table public.coupons add column if not exists source text;

-- القيم الافتراضية أولًا (تعبئة الصفوف الموجودة بلا إعادة كتابة جدول
-- في PG 11+، وبلا حصر على NOT NULL في خطوة واحدة).
alter table public.coupons alter column scope set default 'public';
alter table public.coupons alter column source set default 'manual';

-- Backfill صريح لأي عمود أُضيف في نسخة سابقة بلا default (شرط NOT NULL
-- غير قابل للتحقق إن بقيت NULL، ولا يجوز تجاوزه).
update public.coupons set scope = 'public' where scope is null;
update public.coupons set source = 'manual' where source is null;

-- الفهرس الجزئي يسبق NOT NULL على العمودين: لا معنى ل NOT NULL على جدول
-- يحمل قيمة منطقية معروفة، والقيود أدناه تحتاج NOT NULL لتكون مُلزمة.
-- ترتيب الدليل أدناه يتحقق من NOT NULL أولاً، فلا مسار ثانٍ بعده.
alter table public.coupons alter column scope set not null;
alter table public.coupons alter column source set not null;

comment on column public.coupons.scope is
  'نطاق الاستخدام: public = قسيمة عامة، customer = مرتبطة بعميل واحد.';
comment on column public.coupons.source is
  'مصدر الإنشاء: manual = إدخال بشري/legacy، recovery = بوابة الاسترجاع.';
comment on column public.coupons.customer_identifier is
  'معرّف المالك (جوال مُطبَّع). null = قسيمة عامة. يملؤه الخادم فقط.';
comment on column public.coupons.recovery_case_id is
  'حالة الاسترجاع صاحبة القسيمة. الفهرس الفريد أدناه = قسيمة واحدة لكل حالة.';
comment on column public.coupons.max_discount is
  'سقف مبلغ الخصم (ر.س). null = بلا سقف. يمثّل maxRecoveryDiscountAmount. ' ||
  'مطلوب non-negative لقسيمة recovery.';

-- ---------------------------------------------------------------------
-- 2) مفتاح أجنبي + فهارس
-- ---------------------------------------------------------------------
-- قسائم استرجاع تشير لحالة موجودة. ON DELETE SET NULL موثّق أعلاه.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'coupons_recovery_case_fk'
  ) then
    alter table public.coupons add constraint coupons_recovery_case_fk
      foreign key (recovery_case_id) references public.recovery_cases(id)
      on delete set null;
  end if;
end $$;

-- قسيمة واحدة لكل حالة استرجاع، للأبد. هذا هو حاجز قاعدة البيانات الذي
-- يجعل سباق دورتين ينتج قسيمة واحدة: الإدراج الثاني يفشل بـ23505، والبوابة
-- تقرأ الفائزة. الفهرس جزئي لأن الصفوف العامة recovery_case_id = NULL،
-- وPostgres لا يسمح بـNULL في قيد فريد غير جزئي.
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'coupons_recovery_case_unique'
  ) then
    create unique index coupons_recovery_case_unique
      on public.coupons (recovery_case_id)
      where recovery_case_id is not null;
  end if;
end $$;

-- بحث بالمالك: مسار checkout وربط الحالة. جزئي لأن أغلب القسائم عامة.
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'coupons_customer_identifier_idx'
  ) then
    create index coupons_customer_identifier_idx
      on public.coupons (customer_identifier)
      where customer_identifier is not null;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3) القيود
-- ---------------------------------------------------------------------
-- المسودة السابقة استخدمت scope='recovery' (نطاق) وscope قابلًا لـNULL.
-- إن طُبِّقت على بيئة، تُسقط الآن صراحةً حتى لا تتعارض النمطان.
alter table public.coupons drop constraint if exists coupons_recovery_binding_check;

-- النطاق ومصدر الإنشاء: قائمتان مغلقتان. كل صف قديم يمرّ هنا:
-- scope='public' وsource='manual' من الـbackfill أعلاه.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'coupons_scope_check') then
    alter table public.coupons add constraint coupons_scope_check
      check (scope in ('public', 'customer'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'coupons_source_check') then
    alter table public.coupons add constraint coupons_source_check
      check (source in ('manual', 'recovery'));
  end if;
end $$;

-- السقف: NULL مسموح (قسائم legacy/يدوية بلا سقف)، والسالب مرفوض دائمًا
-- لأن معناه "خصم سالب" = ردّ مبلغ للعميل، وهو خطأ منطق مالي لا خيار.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'coupons_max_discount_check') then
    alter table public.coupons add constraint coupons_max_discount_check
      check (max_discount is null or max_discount >= 0);
  end if;
end $$;

-- قسيمة الاسترجاع: شكلها إلزامي بالكامل. أي صف source='recovery' يجب أن
-- يكون مالكًا واحدًا لحالة واحدة، بمرّة واحدة، بسقف مبلغ. الشروط كلها
-- في قيد واحد لأن التحقق الجزئي يسمح بصف ينقصه شرط واحد — وهذا بالضبط
-- ما لا نريده لقسيمة استرجاع.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'coupons_recovery_shape_check') then
    alter table public.coupons add constraint coupons_recovery_shape_check
      check (
        source <> 'recovery'
        or (
          scope = 'customer'
          and usage_limit = 1
          and customer_identifier is not null
          and btrim(customer_identifier) <> ''
          and recovery_case_id is not null
          and max_discount is not null
          and max_discount >= 0
        )
      );
  end if;
end $$;

-- سقف النسبة: نسخة القاعدة من سياسة الاسترجاع. القيمة 10 مطابقة
-- maxRecoveryDiscountPercent في lib/recovery/config.ts وقت كتابة هذا الملف.
-- ملاحظة للمراجع: هذا الرقم لقطة (snapshot) لا قراءة حيّة للإعدادات؛ إن
-- تغيّرت السياسة، يتغيّر القيد في migration تالية. مقصود: القاعدة أرخص
-- وأوثق من الاعتماد على إعداد، والبوابة تفرض السقف أيضًا.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'coupons_recovery_percent_check') then
    alter table public.coupons add constraint coupons_recovery_percent_check
      check (
        source <> 'recovery'
        or type <> 'percent'
        or (value > 0 and value <= 10)
      );
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4) redeem_coupon — الاستبدال الذرّي (مصدر الاستهلاك الوحيد: checkout)
-- ---------------------------------------------------------------------
-- تعيد صف القسيمة بعد الزيادة، أو ترفع P0001 مع رمز سبب.
-- كل الفحوص من الصف تحت قفل الصف: لا قيمة يمرّرها العميل تتجاوزها.
create or replace function public.redeem_coupon(
  p_code                text,
  p_subtotal            numeric,
  p_customer_identifier text,
  p_now                 timestamptz default now()
)
returns setof public.coupons
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row    public.coupons;
  v_reason text;
begin
  -- قفل الصف أولًا: بعد هذا السطر لا يغيّر أحد القسيمة قبل أن ننتهي.
  select * into v_row
    from public.coupons
   where code = upper(btrim(p_code))
   for update;

  if not found then
    raise exception 'missing' using errcode = 'P0001';
  end if;

  if not v_row.is_active then
    v_reason := 'unavailable';
  -- subtotal فارغ أو غير موجب: في PL/pgSQL الشرط `NULL < x` يُقيَّم NULL
  -- فيُعتبر false، فبلا هذا السطر كان `p_subtotal = null` يصل إلى `else`
  -- فيستهلك الاستخدام الوحيد لقسيمة بلا خصم محتسب. الرفض هنا صريح.
  elsif p_subtotal is null or p_subtotal <= 0 then
    v_reason := 'unavailable';
  elsif v_row.starts_at is not null and p_now < v_row.starts_at then
    v_reason := 'unavailable';
  elsif v_row.ends_at is not null and p_now >= v_row.ends_at then
    v_reason := 'unavailable';
  elsif v_row.usage_limit is not null and v_row.used_count >= v_row.usage_limit then
    v_reason := 'exhausted';
  elsif p_subtotal < v_row.min_order then
    v_reason := 'unavailable';
  -- الربط: المالك المطبَّع فقط. p_customer_identifier يأتي من الخادم
  -- (جلسة أو جوال مُطبَّع في createOrderAction) ولا يُقبل فارغًا.
  -- الترتيب مقصود: فحص "غير المالك" يسبق فحص "فارغ" حتى لا يتحوّل
  -- عميل آخر إلى مقبول عبر NULL comparison.
  elsif v_row.customer_identifier is not null
    and coalesce(btrim(p_customer_identifier), '') = '' then
    v_reason := 'wrong_customer';
  elsif v_row.customer_identifier is not null
    and v_row.customer_identifier <> p_customer_identifier then
    v_reason := 'wrong_customer';
  else
    v_reason := null;
  end if;

  if v_reason is not null then
    raise exception '%', v_reason using errcode = 'P0001';
  end if;

  update public.coupons
     set used_count = used_count + 1
   where id = v_row.id
  returning * into v_row;

  -- ملاحظة مقصودة: الدالة لا تُعيد مبلغ الخصم. تُعيد الصف بعد الزيادة،
  -- والتطبيق يحسب المبلغ بـdiscountForCoupon (نفس قاعدة policy.ts المغطّاة
  -- بالاختبارات) من max_discount وmin(p_subtotal, value). حسابه هنا مرّة
  -- أخرى بلا-return كان سيخلق مصدرين للحقيقة.
  return next v_row;
end;
$$;

-- ---------------------------------------------------------------------
-- 5) الصلاحيات: service_role فقط
-- ---------------------------------------------------------------------
-- grants العامة في migration-002.sql:266-269 تمنح execute لـanon و
-- authenticated لكل الدوال، فالـrevoke إلزامي وليس تحسينًا: بدونه
-- يستطيع متصفح بلا جلسة قسيمة استرجاع أي عميل.
revoke all on function public.redeem_coupon(text, numeric, text, timestamptz) from public;
revoke all on function public.redeem_coupon(text, numeric, text, timestamptz) from anon;
revoke all on function public.redeem_coupon(text, numeric, text, timestamptz) from authenticated;
grant execute on function public.redeem_coupon(text, numeric, text, timestamptz) to service_role;

commit;

notify pgrst, 'reload schema';

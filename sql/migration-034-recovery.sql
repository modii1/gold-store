-- ============================================================
-- gold-store migration 034: recovery cases (Stage 1 / DRY_RUN)
--
-- ⚠ DRAFT — لم تُطبّق بعد. لا تُشغّل إلا بعد موافقة صريحة.
-- ============================================================
--
-- الغرض: تخزين حالات الاسترجاع وقرارات Decision Engine فقط.
--
-- ما لا يفعله هذا الملف (مهم):
--  - لا يضيف أعمدة إلى orders / customers / products / coupons / notifications.
--  - لا ينشئ أي جدول خصومات جديد (recovery_discounts غير موجود — نستخدم
--    جدول coupons القائم في المرحلة الثانية إن أمكن، وبحدود 10% وسقف 50).
--  - لا يضيف أي كتابة عامة: لا سياسة insert عامة، ولا insert لـ anon.
--  - لا يغيّر RLS لأي جدول قائم.
--  - لا يحتوي بيانات تجريبية ولا seed.
--
-- الهوية والسريّة:
--  - customer_phone يُخزَّن بطبيعته (لأن أرشفة الـcases تعتمد عليه)، لكن
--    الجدول service_role فقط: لا anon/authenticated	select ولا insert ولا update.
--  - إن أردتِ إخفاء الرقم مستقبلًا، deodorize أو استعملي hash + رابط لاحقًا
--    (خارج نطاق هذه المرحلة).
--
-- التشغيل: مرة واحدة في Supabase SQL Editor بعد migration-033.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- RECOVERY CASES ----------
create table if not exists recovery_cases (
  id                     uuid primary key default gen_random_uuid(),

  -- هوية الزائر (من localStorage/sessionStorage — بلا PII)
  visitor_id             text not null,
  session_id             text not null,

  -- هوية العميل: null للزائر المجهول (لا نطلب منه تحديد هويته)
  customer_id            uuid references customers(id) on delete set null,
  customer_phone         text,

  -- نوع الحالة
  case_type              text not null default 'ADD_TO_CART'
                         check (case_type in ('ADD_TO_CART','CHECKOUT_STARTED','PAYMENT_STARTED','PURCHASED')),
  status                 text not null default 'OPEN'
                         check (status in ('OPEN','ELIGIBLE','SCHEDULED','CONTACTED','PURCHASED','EXPIRED','CANCELLED','SUPPRESSED')),

  -- ترتيب الأولويات (intentionally، وليس money) — Decision Engine فقط
  score                  integer not null default 0,

  -- لقطة السلة وقت الكشف (MAD؛ لا تُستخدم كسعر نهائي)
  cart_value             numeric,
  product_ids            uuid[] not null default '{}',
  preferred_product_id   uuid,
  preferred_product_slug text,

  first_detected_at      timestamptz not null default now(),
  last_activity_at       timestamptz not null default now(),

  -- حالة التواصل/الخصم (المرحلة الأولى: تبقى 0/ null)
  last_message_at        timestamptz,
  message_count          integer not null default 0,
  last_reminder_step     integer not null default 0,
  discount_count         integer not null default 0,
  last_discount_at       timestamptz,
  next_action_at         timestamptz,

  -- الإغلاق بِطلب حقيقي (مصدر موثوق: notification_events order.created)
  completed_at           timestamptz,
  purchase_ref           uuid,   -- orders.id عند الربط؛ بدون FK متعمّد (ضعف RLS على orders)

  -- الخصم (null في المرحلة الأولى)
  discount_ref           text,
  suppress_reason        text,
  decision               text
                         check (decision in ('NO_INCENTIVE','REMINDER_ONLY','DISCOUNT_ELIGIBLE') or decision is null),
  decided_at             timestamptz,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  -- قيود سلامة على العدادات
  constraint recovery_cases_message_count_nonneg check (message_count >= 0),
  constraint recovery_cases_discount_count_nonneg check (discount_count >= 0),
  -- discount_ref موجود فقط إذا تم تقديم خصم فعلاً
  constraint recovery_cases_discount_ref_implies_count check (discount_ref is null or discount_count > 0)
);

-- ---------- الفهارس (استعلامات لوحة الإدارة والدورة) ----------
create index if not exists idx_recovery_cases_visitor     on recovery_cases(visitor_id);
create index if not exists idx_recovery_cases_status      on recovery_cases(status);
create index if not exists idx_recovery_cases_last_active on recovery_cases(last_activity_at desc);
-- استعلام الإغلاق برقم العميل
create index if not exists idx_recovery_cases_customer    on recovery_cases(customer_phone)
  where status in ('OPEN','ELIGIBLE','SCHEDULED','CONTACTED');
-- فك ازدواج purchase_ref (منع عدّ نفس الطلب مرتين في المقاييس)
create unique index if not exists uq_recovery_cases_purchase_ref on recovery_cases(purchase_ref)
  where purchase_ref is not null;
-- حالة نشطة واحدة لكل زائر (يمنع تكرار الحالات المفتوحة)
create unique index if not exists uq_recovery_cases_active_visitor on recovery_cases(visitor_id)
  where status in ('OPEN','ELIGIBLE','SCHEDULED','CONTACTED');

-- ---------- RLS: service_role فقط ----------
alter table recovery_cases enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'service read recovery_cases') then
    create policy "service read recovery_cases" on recovery_cases for select to service_role using (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'service insert recovery_cases') then
    create policy "service insert recovery_cases" on recovery_cases for insert to service_role with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'service update recovery_cases') then
    create policy "service update recovery_cases" on recovery_cases for update to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'service delete recovery_cases') then
    create policy "service delete recovery_cases" on recovery_cases for delete to service_role using (true);
  end if;
end $$;

-- لا توجد سياسة لـ anon / authenticated: المتصفح لا يقرأ ولا يكتب هذا الجدول إطلاقًا.
-- الاستيعاب يتم server-side فقط (route /api/analytics/track → maybeIngestRecoverySignal).

notify pgrst, 'reload schema';

-- ============================================================
-- لم يُطبّق. يتطلب موافقة صريحة على:
--   1) إنشاء جدول جديد + 5 فهارس (منها 2 جزئية + 2 فريدة).
--   2) RLS service_role فقط (بلا وصول public).
--   3) تخزين customer_phone (رقم عميل) داخل الجدول.
--   4) أيقونة uq_recovery_cases_active_visitor: تفرض حالة نشطة واحدة/زائر؛
--      engine ينشئ حالة جديدة بعد إغلاق السابقة (سلوك مقصود ومغطى باختبار 19b).
--   5) uq_recovery_cases_purchase_ref: يمنع ازدواج احتساب نفس الطلب.
-- ============================================================

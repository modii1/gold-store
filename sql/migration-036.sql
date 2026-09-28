-- ============================================================
-- migration-036 — إثبات تدخل استرجاع فعلي (سجل دائم append-only)
--
-- المشكلة التي تحلّها هذه الـmigration:
--   حتى الآن كان يُحسب أي case بحالة PURCHASED ذات purchase_ref كـ
--   "تمت استعادته". وpurchase_ref وحده لا يثبت تدخلًا: يكفي أن يشتري
--   العميل طبيعيًا بعد ترك سلة. فظهر رقم "مبيعات مستعادة" بلا أي
--   تدخل حقيقي من نظام الاسترجاع.
--
-- المبدأ:
--   RECOVERED لا يُثبت إلا بسجل تدخل دائم سابق للشراء:
--       intervention.sent_at < order.created_at
--   أي صف في هذا الجدول يجب أن يُنشأ بعد نجاح إرسال فعلي فقط —
--   لا عند التقييم ولا عند التوصية ولا عند الجدولة.
--
-- ملاحظة مهمة:
--   إنشاء الجدول لا يعني أن الرسالة أُرسلت. لا يوجد حاليًا أي
--   dispatcher يرسل رسائل أو كوبونات، لذلك سيبقى هذا الجدول فارغًا
--   حتى يُضاف مُرسِل فعلي — وهذا هو السلوك الصحيح: صفر استعادة
--   حقيقي بدل ادعاء نجاح غير موجود.
-- ============================================================

create table if not exists recovery_contact_attempts (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid not null references recovery_cases(id) on delete cascade,
  channel     text not null,
  sent_at     timestamptz not null default now(),
  coupon_ref  text,
  created_at  timestamptz not null default now(),

  -- قناة intervene معرَّفة: مغلقة على القيم المعروفة (append-only، بلا توسع عشوائي)
  constraint recovery_contact_attempts_channel_check
    check (channel in ('whatsapp','sms','email','coupon','in_app')),

  -- لا خصم بلا مرجع: يعكس قيد recovery_cases.discount_ref_implies_count
  constraint recovery_contact_attempts_coupon_nonempty
    check (coupon_ref is null or length(btrim(coupon_ref)) > 0)
);

-- ---------- الفهارس ----------
-- مسار الإسناد: interventions لحالة واحدة مرتبة زمنيًا (الأحدث أولًا)
create index if not exists idx_recovery_contact_attempts_case
  on recovery_contact_attempts(case_id, sent_at desc);

-- البحث عن "هل سبق تدخّل قبل تاريخ معيّن" (شرط الاستعادة)
create index if not exists idx_recovery_contact_attempts_sent
  on recovery_contact_attempts(sent_at desc);

-- فهرس جزئي: quickest lookup لآخر تدخّل فعلي
create index if not exists idx_recovery_contact_attempts_latest
  on recovery_contact_attempts(case_id)
  where sent_at is not null;

-- ---------- RLS: service_role فقط (نفس نموذج recovery_cases) ----------
alter table recovery_contact_attempts enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'service read recovery_contact_attempts') then
    create policy "service read recovery_contact_attempts" on recovery_contact_attempts for select to service_role using (true);
  end if;
  -- insert فقط: السجل append-only. لا update ولا delete عبر service_role أيضًا،
  -- فالتعديل/الحذف يتم عبر cascade من recovery_cases فقط.
  if not exists (select 1 from pg_policies where policyname = 'service insert recovery_contact_attempts') then
    create policy "service insert recovery_contact_attempts" on recovery_contact_attempts for insert to service_role with check (true);
  end if;
end $$;

-- لا توجد سياسة لـ anon / authenticated: المتصفح لا يقرأ ولا يكتب هذا السجل إطلاقًا.
-- القراءة server-side فقط (لوحة الإدارة + دورة الإسناد).

notify pgrst, 'reload schema';

-- ============================================================
-- لم يُطبّق. يتطلب موافقة صريحة على:
--   1) إنشاء جدول جديد + 3 فهارس.
--   2) RLS service_role فقط (بلا وصول public) + insert بلا update/delete.
--   3) تخزين channel/coupon_ref (مرجع كوبون إن وُجد لاحقًا).
--   4) هذا الجدول هو مصدر الحقيقة الوحيد لاثبات "تمت الاستعادة".
--      تطبيقه يغيّر قراءة المقاييس: recovered ينخفض إلى ما-documented فعلاً.
-- ============================================================

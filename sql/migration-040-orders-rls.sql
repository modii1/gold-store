-- =====================================================================
-- G6-C / migration-040 — إغلاق قراءة/كتابة الطلبات من anon وauthenticated
-- =====================================================================
-- ⚠️ مسودة للمراجعة — لم تُنفَّذ. راجعها قبل أي تطبيق على الإنتاج.
--
-- السبب (تدقيق G6-C / A.1):
--   `sql/schema.sql:77-82` فتحت سياستين للجميع:
--     "public select orders"  using (true)
--     "public insert orders"  with check (true)
--   ومع `grant all privileges ... to anon, authenticated` في
--   `sql/migration-002.sql:263-269`، كان أي زائر يستطيع قراءة **كل**
--   الطلبات (اسم، جوال، عنوان، بريد، تفاصيل شحن) وكتابة صفوف طلبات جديدة.
--
-- الدليل أن هذا آمن للإغلاق: كل قراءات الطلبات في gold-store تمرّ
--   بـcreateAdminClient() (service role، وهو يتجاوز RLS):
--     - app/actions/customer-data.ts   (طلبات العميل نفسه)
--     - app/actions/orders-admin.ts    (لوحة الإدارة)
--     - app/api/recovery/run/route.ts  (إغلاق الحالات بالشراء)
--   ولا يوجد أي استدعاء order-related RPC، ولا وصول للمتصفح للجدول.
--   المتصفح يستخدم localStorage فقط للسلة.
--
-- ما لا يفعله هذا الملف: لا يمسّ الطلبات نفسها، لا يحذف صفًا، ولا يغيّر
-- أي منطق. هو إغلاق باب كان مفتوحًا.
-- =====================================================================

-- 1) إزالة السياستين المفتوحتين (إن وُجدتا). idempotent.
drop policy if exists "public select orders" on public.orders;
drop policy if exists "public insert orders" on public.orders;

-- 2) لا بديل لهما: القراءة والكتابة كلتاهما بـservice role.
--    أي استعلام anon/authenticated على orders يعطي 0 صفوف (RLS بلا سياستة
--    = لا صفّ) بدل خطأ — fail-closed.

-- 3) شبكة أمان: لو أضاف أحدهم يومًا سياسة بـ`true`، تبقى هذه ليست
--    الطريقة الوحيدة للحماية — الـservice role يتجاوز RLS أصلًا، فلا
--    نحتاج سياسة تحمي service role. نترك الجدول بلا سياسات عمدًا.
--
-- 4) يبقى GRANT كما هو (service_role يحتاج all): لا نلمس الصلاحيات هنا حتى
--    لا نكسر لوحة الإدارة أو مسار التسوية.

notify pgrst, 'reload schema';

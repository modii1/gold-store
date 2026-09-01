-- ============================================================
-- gold-store migration 026: home page section builder
-- (orderable/hideable homepage sections + custom sections.
--  Run in Supabase SQL Editor. Idempotent — safe to re-run.)
-- ============================================================
-- Purpose:
--   * Lets the admin reorder, show/hide and add custom sections of the
--     storefront homepage without touching code.
--   * Built-in sections keep their existing components/design and are seeded
--     in their current order (hero, categories, features, then the four
--     product rails). Custom sections are content blocks (title/desc/image/
--     icon/body HTML).
--   * Additive only — does not modify existing tables.

create table if not exists home_sections (
  id uuid primary key default gen_random_uuid(),
  -- built-in: hero, categories, features, products_latest, products_best,
  --           products_featured, products_sale  |  custom: custom
  type text not null default 'custom',
  -- stable key: 'hero','categories','features','products_latest',
  -- 'products_best','products_featured','products_sale' or 'custom_<ts>'
  code text not null unique,
  title text,
  subtitle text,
  image_url text,
  -- only for custom sections (lucide icon name)
  icon text,
  -- body content (custom sections) — plain text; rendered in <p> tags per line
  content text,
  -- jsonb for per-section extras (e.g. {"dark":bool,"viewAll":"/shop","prodKey":"..."})
  -- kept generic so future built-in tweaks need no new columns
  config jsonb,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists home_sections_order_idx on home_sections (sort_order);

-- ---------- RLS ----------
-- The storefront must be able to read active sections anonymously (same as
-- products/settings/categories). Writes are admin/service-role only (no anon
-- policy below), so visitors can never alter the layout.
alter table home_sections enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'public select home_sections') then
    create policy "public select home_sections" on home_sections for select using (true);
  end if;
end $$;

-- ---------- Seed the 7 built-in sections in their current order ----------
insert into home_sections (type, code, title, subtitle, config, sort_order, is_active)
values
  ('hero',              'hero',              null,                 null,    '{}'::jsonb,                                                              1, true),
  ('categories',        'categories',        null,                 null,    '{}'::jsonb,                                                              2, true),
  ('features',          'features',          null,                 null,    '{}'::jsonb,                                                              3, true),
  ('products_latest',   'products_latest',   'أحدث المنتجات',       'وصل حديثاً من تشكيلتنا',        '{"viewAll":"/shop"}'::jsonb,                            4, true),
  ('products_best',     'products_best',     'الأكثر مبيعاً',       'القطع التي أحبتها عميلاتنا',   '{"viewAll":"/shop?sort=best","dark":true}'::jsonb,       5, true),
  ('products_featured', 'products_featured', 'قطع مميزة',           'اختياراتنا المفضلة من التشكيلة','{"viewAll":"/shop?featured=1"}'::jsonb,                6, true),
  ('products_sale',     'products_sale',     'العروض',             'خصومات حصرية لفترة محدودة',   '{"viewAll":"/shop?sale=1"}'::jsonb,                      7, true)
on conflict (code) do nothing;

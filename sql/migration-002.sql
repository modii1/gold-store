-- ============================================================
-- gold-store migration 002: luxury store expansion
-- Run ONCE in Supabase SQL Editor
-- ============================================================
create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- Fix missing schema privileges (fixes 42501 permission denied)
grant usage on schema public to anon, authenticated, service_role;
grant all privileges on all tables in schema public to anon, authenticated, service_role;
grant all privileges on all sequences in schema public to anon, authenticated, service_role;
grant all privileges on all functions in schema public to anon, authenticated, service_role;

-- ---------- PRODUCTS: new columns ----------
alter table products add column if not exists sale_price numeric;
alter table products add column if not exists sku text;
alter table products add column if not exists barcode text;
alter table products add column if not exists weight text;
alter table products add column if not exists karat text;
alter table products add column if not exists material text;
alter table products add column if not exists color text;
alter table products add column if not exists brand text;
alter table products add column if not exists stock int not null default 0;
alter table products add column if not exists is_best_seller boolean not null default false;
alter table products add column if not exists seo_title text;
alter table products add column if not exists seo_description text;
alter table products add column if not exists keywords text;

create index if not exists products_category_idx on products (category);
create index if not exists products_price_idx on products (price);
create index if not exists products_created_idx on products (created_at desc);
create index if not exists products_sku_idx on products (sku);
create index if not exists products_name_trgm on products using gin (name gin_trgm_ops);
create index if not exists products_brand_trgm on products using gin (coalesce(brand, '') gin_trgm_ops);

-- ---------- CATEGORIES ----------
create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  image text,
  description text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- BRANDS ----------
create table if not exists brands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  logo text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- COUPONS ----------
create table if not exists coupons (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  type text not null default 'percent' check (type in ('percent', 'fixed')),
  value numeric not null default 0,
  min_order numeric not null default 0,
  starts_at timestamptz,
  ends_at timestamptz,
  usage_limit int default null,
  used_count int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- FAVORITES ----------
create table if not exists favorites (
  id uuid primary key default gen_random_uuid(),
  customer_identifier text not null,
  product_id uuid not null references products (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (customer_identifier, product_id)
);

-- ---------- ADDRESSES ----------
create table if not exists addresses (
  id uuid primary key default gen_random_uuid(),
  customer_identifier text not null,
  full_name text,
  phone text,
  city text,
  region text,
  address text,
  national_address text,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- BANNERS ----------
create table if not exists banners (
  id uuid primary key default gen_random_uuid(),
  title text,
  subtitle text,
  image text,
  mobile_image text,
  cta_text text,
  cta_link text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- PAGES ----------
create table if not exists pages (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  content text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- SHIPPING METHODS ----------
create table if not exists shipping_methods (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  cost numeric not null default 0,
  free_above numeric,
  estimated_days text,
  is_active boolean not null default true,
  sort_order int not null default 0
);

-- ---------- PAYMENT METHODS ----------
create table if not exists payment_methods (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  instructions text,
  is_active boolean not null default true,
  sort_order int not null default 0
);

-- ---------- REVIEWS ----------
create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id) on delete cascade,
  customer_identifier text,
  rating int not null default 5 check (rating between 1 and 5),
  comment text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- ORDERS: new columns + extended statuses ----------
alter table orders add column if not exists email text;
alter table orders add column if not exists region text;
alter table orders add column if not exists address text;
alter table orders add column if not exists national_address text;
alter table orders add column if not exists shipping_method text;
alter table orders add column if not exists shipping_cost numeric not null default 0;
alter table orders add column if not exists payment_method text;
alter table orders add column if not exists coupon_code text;
alter table orders add column if not exists discount numeric not null default 0;
alter table orders add column if not exists customer_identifier text;
alter table orders add column if not exists delivery_status text;

alter table orders drop constraint if exists orders_status_check;
alter table orders add constraint orders_status_check
  check (status in ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'paid', 'cancelled'));

-- ---------- SETTINGS: new columns ----------
alter table settings add column if not exists hero_image_mobile text;
alter table settings add column if not exists hero_cta_text text default 'تسوقي الآن';
alter table settings add column if not exists hero_cta_link text default '/shop';
alter table settings add column if not exists shipping_fee numeric not null default 0;
alter table settings add column if not exists free_shipping_threshold numeric not null default 0;
alter table settings add column if not exists commercial_register text;
alter table settings add column if not exists tax_number text;
alter table settings add column if not exists footer_text text;

-- ---------- RLS ----------
alter table categories enable row level security;
alter table brands enable row level security;
alter table coupons enable row level security;
alter table favorites enable row level security;
alter table addresses enable row level security;
alter table banners enable row level security;
alter table pages enable row level security;
alter table shipping_methods enable row level security;
alter table payment_methods enable row level security;
alter table reviews enable row level security;

do $$ 
declare
  tbl text;
begin
  -- public read for catalog tables
  foreach tbl in array array['categories', 'brands', 'banners', 'pages', 'shipping_methods', 'payment_methods'] loop
    if not exists (select 1 from pg_policies where tablename = tbl and policyname = 'public read ' || tbl) then
      execute format('create policy %I on %I for select using (true)', 'public read ' || tbl, tbl);
    end if;
  end loop;

  if not exists (select 1 from pg_policies where policyname = 'public insert favorites') then
    create policy "public insert favorites" on favorites for insert with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'public delete favorites') then
    create policy "public delete favorites" on favorites for delete using (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'public select favorites') then
    create policy "public select favorites" on favorites for select using (true);
  end if;

  if not exists (select 1 from pg_policies where policyname = 'public insert addresses') then
    create policy "public insert addresses" on addresses for insert with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'public select addresses') then
    create policy "public select addresses" on addresses for select using (true);
  end if;

  if not exists (select 1 from pg_policies where policyname = 'public insert reviews') then
    create policy "public insert reviews" on reviews for insert with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'public select reviews') then
    create policy "public select reviews" on reviews for select using (true);
  end if;
end $$;

-- ---------- SEED: default categories ----------
insert into categories (name, slug, sort_order) values
  ('أطقم', 'sets', 1),
  ('خواتم', 'rings', 2),
  ('أساور', 'bracelets', 3),
  ('سلاسل', 'chains', 4),
  ('حلق', 'earrings', 5),
  ('شوكرات', 'chokers', 6),
  ('تعليقات', 'pendants', 7),
  ('إكسسوارات', 'accessories', 8),
  ('عروض', 'offers', 9)
on conflict (slug) do nothing;

-- ---------- SEED: default shipping & payment ----------
insert into shipping_methods (name, cost, free_above, estimated_days, sort_order) values
  ('توصيل سريع', 25, 300, '1-3 أيام', 1),
  ('شحن لجميع المدن', 15, 300, '3-7 أيام', 2)
on conflict do nothing;

insert into payment_methods (name, description, instructions, sort_order) values
  ('تحويل بنكي', 'الدفع عبر التحويل إلى الحساب البنكي', null, 1),
  ('الدفع عند الاستلام', 'ادفعي عند استلام طلبك', null, 2)
on conflict do nothing;

-- ---------- SEED: static pages ----------
insert into pages (slug, title, content) values
  ('about', 'من نحن', 'متجر متخصص في المجوهرات والإكسسوارات النسائية الفاخرة.'),
  ('shipping', 'الشحن والتوصيل', 'نوفر الشحن لجميع مدن المملكة مع تغليف فاخر وآمن.'),
  ('returns', 'الاستبدال والاسترجاع', 'يمكن استبدال المنتج خلال 7 أيام من تاريخ الاستلام.'),
  ('terms', 'الشروط والأحكام', 'جميع المنتجات أصلية ومضمونة.'),
  ('privacy', 'الخصوصية', 'نحترم خصوصيتك ولا نشارك بياناتك مع أي طرف ثالث.'),
  ('faq', 'الأسئلة الشائعة', 'تصفحي الأسئلة الأكثر شيوعاً حول الشحن والدفع والاسترجاع.')
on conflict (slug) do nothing;

-- Re-grant after creating tables (new tables do not inherit earlier grants)
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
grant all privileges on all tables in schema public to anon, authenticated, service_role;
grant all privileges on all sequences in schema public to anon, authenticated, service_role;
grant all privileges on all functions in schema public to anon, authenticated, service_role;

notify pgrst, 'reload schema';

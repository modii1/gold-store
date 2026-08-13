-- gold-store migration 008: shipping carriers + product weight + tracking
-- Run once in Supabase SQL Editor

-- ---------- CARRIERS (شركات الشحن) ----------
create table if not exists carriers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique not null,
  logo_url text,
  mode text not null default 'flat' check (mode in ('flat', 'api')),
  cost numeric not null default 0,
  free_above numeric,
  estimated_days text,
  config jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table carriers enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'public select carriers') then
    create policy "public select carriers" on carriers for select using (true);
  end if;
end $$;

insert into carriers (name, code, mode, cost, free_above, estimated_days, sort_order) values
  ('توصيل سريع', 'express', 'flat', 25, 300, '1-3 أيام', 1),
  ('شحن لجميع المدن', 'standard', 'flat', 15, 300, '3-7 أيام', 2),
  ('أرامكس Aramex', 'aramex', 'flat', 0, null, 'حسب الشركة', 3),
  ('سمسا SMSA', 'smsa', 'flat', 0, null, 'حسب الشركة', 4),
  ('زاجل Zajil', 'zajil', 'flat', 0, null, 'حسب الشركة', 5)
on conflict (code) do nothing;

-- ---------- PRODUCT WEIGHT (جرام) ----------
alter table products add column if not exists weight_grams numeric;

-- ---------- ORDER TRACKING ----------
alter table orders add column if not exists carrier_code text;
alter table orders add column if not exists tracking_number text;
alter table orders add column if not exists tracking_url text;

notify pgrst, 'reload schema';

create extension if not exists "pgcrypto";

-- ============================================================
-- PRODUCTS
-- ============================================================
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  description text,
  price numeric not null default 0,
  category text,
  images jsonb not null default '[]'::jsonb,
  videos jsonb not null default '[]'::jsonb,
  is_available boolean not null default true,
  featured boolean not null default false,
  created_at timestamptz not null default now()
);

-- ============================================================
-- ORDERS
-- ============================================================
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigserial,
  customer_name text not null,
  customer_phone text not null,
  customer_city text,
  items jsonb not null default '[]'::jsonb,
  total numeric not null default 0,
  status text not null default 'pending' check (status in ('pending', 'paid', 'delivered', 'cancelled')),
  transfer_receipt_url text,
  notes text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- SETTINGS
-- ============================================================
create table if not exists settings (
  id int primary key default 1,
  site_name text default 'لمعة للاكسسوارات المطلية',
  store_logo text,
  hero_image text,
  hero_title text default 'أكسسوارات ذهب فاخرة',
  hero_subtitle text default 'تشكيلة مختارة بعناية من الذهب والاكسسوارات الفاخرة',
  announcement text,
  whatsapp text,
  phone text,
  email text,
  address text,
  instagram text,
  tiktok text,
  snapchat text,
  twitter text,
  payment_instructions text default 'يرجى تحويل المبلغ إلى الحساب البنكي ثم إرسال إثبات التحويل عبر واتساب أو رفعه في الطلب.',
  bank_name text,
  iban text,
  account_name text,
  updated_at timestamptz not null default now()
);

insert into settings (id) values (1) on conflict (id) do nothing;

-- ============================================================
-- RLS
-- ============================================================
alter table products enable row level security;
alter table orders enable row level security;
alter table settings enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'public select products') then
    create policy "public select products" on products for select using (true);
  end if;

  if not exists (select 1 from pg_policies where policyname = 'public select orders') then
    create policy "public select orders" on orders for select using (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'public insert orders') then
    create policy "public insert orders" on orders for insert with check (true);
  end if;

  if not exists (select 1 from pg_policies where policyname = 'public select settings') then
    create policy "public select settings" on settings for select using (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'public update settings') then
    create policy "public update settings" on settings for update using (true) with check (true);
  end if;
end $$;

-- ============================================================
-- STORAGE
-- ============================================================
insert into storage.buckets (id, name, public) values ('products', 'products', true)
on conflict (id) do nothing;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'Public Read Products') then
    create policy "Public Read Products" on storage.objects for select using ( bucket_id = 'products' );
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Anyone Can Upload Products') then
    create policy "Anyone Can Upload Products" on storage.objects for insert with check ( bucket_id = 'products' );
  end if;
end $$;

notify pgrst, 'reload schema';

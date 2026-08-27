-- gold-store migration 014: Smart Variants (Amazon/Noon style) — color + size
-- Run once in Supabase SQL Editor. Idempotent — safe to re-run.

create table if not exists product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  color text,
  color_hex text,
  size text,
  sku text,
  price numeric,
  sale_price numeric,
  stock integer not null default 0,
  image_url text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
-- add color_hex if table existed before this patch
alter table product_variants add column if not exists color_hex text;
create index if not exists product_variants_product_idx on product_variants (product_id, is_active);
create index if not exists product_variants_color_idx on product_variants (color);
create index if not exists product_variants_size_idx on product_variants (size);

alter table product_variants enable row level security;

-- No anon policies: service_role only (accessed via createAdminClient / server)
-- Keep products.color column for backwards compat — variants are source of truth when rows exist
-- Enrich products.color facet via trigger is not needed; getFacetValues splits variants at app layer

notify pgrst, 'reload schema';

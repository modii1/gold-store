-- gold-store migration 009: OTO shipping engine
-- Run once in Supabase SQL Editor
-- Notes:
--  - Internal tables (oto_config, shipments, shipping_rules, shipping_zones,
--    shipping_logs, shipping_credentials) are RLS-enabled with NO public policy,
--    so only the service role (server actions) can access them.
--  - Secrets are encrypted in the application layer (AES-256-GCM) using the
--    SHIPPING_ENC_KEY env var; the DB only ever stores ciphertext.

-- ---------- OTO CONFIG (single row: account + token management) ----------
create table if not exists oto_config (
  id int primary key default 1,
  refresh_token_enc text,
  access_token text,
  access_token_expires_at timestamptz,
  company_id text,
  store_name text,
  package_name text,
  remaining_credit numeric not null default 0,
  currency text not null default 'SAR',
  validity_date text,
  origin_city text not null default 'Riyadh',
  origin_country text not null default 'SA',
  origin_lat numeric,
  origin_lon numeric,
  is_connected boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into oto_config (id) values (1) on conflict (id) do nothing;

-- ---------- SHIPMENTS (شحنات) ----------
create table if not exists shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  oto_order_id bigint,
  delivery_option_id int,
  delivery_company text,
  delivery_option_name text,
  tracking_number text,
  dc_tracking_number text,
  tracking_url text,
  branded_tracking_url text,
  print_awb_url text,
  status text not null default 'pending',
  dc_status text,
  price numeric,
  cod_amount numeric,
  picking_type text,
  who_pays text,
  driver_name text,
  driver_phone text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- SHIPPING RULES (محرك اختيار الشركات) ----------
create table if not exists shipping_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  priority int not null default 0,
  is_active boolean not null default true,
  conditions jsonb not null default '{}'::jsonb,
  carrier_code text,
  delivery_option_id int,
  price_override numeric,
  created_at timestamptz not null default now()
);

-- ---------- SHIPPING ZONES (مناطق/مدن/دول) ----------
create table if not exists shipping_zones (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null default 'city' check (type in ('city', 'region', 'country', 'international')),
  value text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- SHIPPING LOGS (سجل العمليات) ----------
create table if not exists shipping_logs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete set null,
  event text not null,
  level text not null default 'info',
  message text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------- SHIPPING CREDENTIALS (اعتمادات العقود الخاصة - مشفرة) ----------
create table if not exists shipping_credentials (
  carrier_id uuid primary key references carriers(id) on delete cascade,
  credentials_enc text not null,
  updated_at timestamptz not null default now()
);

-- ---------- CARRIERS: OTO provider fields ----------
alter table carriers add column if not exists provider text not null default 'manual'
  check (provider in ('manual', 'oto', 'own_contract'));
alter table carriers add column if not exists delivery_option_id int;
alter table carriers add column if not exists service_type text;

-- ---------- ORDERS: OTO delivery option ----------
alter table orders add column if not exists delivery_option_id int;

-- ---------- INDEXES ----------
create index if not exists idx_shipments_order on shipments(order_id);
create index if not exists idx_shipments_status on shipments(status);
create index if not exists idx_shipping_logs_order on shipping_logs(order_id);
create index if not exists idx_shipping_logs_created on shipping_logs(created_at);
create index if not exists idx_shipping_rules_active on shipping_rules(is_active);
create index if not exists idx_shipping_zones_value on shipping_zones(value);

-- ---------- RLS: internal tables are admin-only (no public policy = deny anon) ----------
alter table oto_config enable row level security;
alter table shipments enable row level security;
alter table shipping_rules enable row level security;
alter table shipping_zones enable row level security;
alter table shipping_logs enable row level security;
alter table shipping_credentials enable row level security;

notify pgrst, 'reload schema';

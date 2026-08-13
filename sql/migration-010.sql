-- gold-store migration 010: saved addresses and returns
-- Run once in Supabase SQL Editor

alter table addresses add column if not exists label text default 'عنواني';
alter table addresses add column if not exists latitude numeric;
alter table addresses add column if not exists longitude numeric;
alter table addresses add column if not exists maps_url text;
alter table orders add column if not exists latitude numeric;
alter table orders add column if not exists longitude numeric;
alter table orders add column if not exists maps_url text;

create table if not exists return_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  customer_identifier text not null,
  reason text not null,
  details text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','received','refunded')),
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_return_requests_customer on return_requests(customer_identifier);
create index if not exists idx_return_requests_status on return_requests(status);
alter table return_requests enable row level security;

notify pgrst, 'reload schema';

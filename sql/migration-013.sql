-- gold-store migration 013: Notification Center (engine, templates, rules, preferences, deliveries, events)
-- Run once in Supabase SQL Editor. Idempotent — safe to re-run.

-- ============ Channels (provider adapters registry) ============
create table if not exists notification_channels (
  id bigint generated always as identity primary key,
  code text not null unique,
  name text not null,
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============ Ingested events (idempotency) ============
create table if not exists notification_events (
  id bigint generated always as identity primary key,
  source text not null,
  external_event_id text not null,
  event_type text not null,
  order_id text,
  order_number bigint,
  shipment_id text,
  customer_identifier text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (source, external_event_id)
);
create index if not exists notification_events_order_idx on notification_events (order_id);
create index if not exists notification_events_status_idx on notification_events (status, created_at);

-- ============ Templates ============
create table if not exists notification_templates (
  id bigint generated always as identity primary key,
  event_type text not null unique,
  name text not null,
  title text not null,
  body text not null default '',
  severity text not null default 'info',
  category text not null default 'system',
  channels jsonb not null default '["in_app"]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============ Rules (event -> channels + recipients) ============
create table if not exists notification_rules (
  id bigint generated always as identity primary key,
  event_type text not null,
  name text not null default '',
  condition jsonb not null default '{}'::jsonb,
  channels jsonb not null default '["in_app"]'::jsonb,
  recipients jsonb not null default '["admin"]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists notification_rules_event_idx on notification_rules (event_type);

-- ============ Customer preferences ============
create table if not exists notification_preferences (
  id bigint generated always as identity primary key,
  customer_identifier text not null,
  category text not null,
  in_app_enabled boolean not null default true,
  email_enabled boolean not null default false,
  sms_enabled boolean not null default true,
  push_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (customer_identifier, category)
);

-- ============ Notifications (Notification Center) ============
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_type text not null,
  user_id text not null,
  customer_id text,
  order_id text,
  order_number bigint,
  shipment_id text,
  type text not null,
  category text not null default 'system',
  severity text not null default 'info',
  title text not null,
  message text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  action_url text,
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on notifications (user_type, user_id, created_at desc);
create index if not exists notifications_unread_idx on notifications (user_type, user_id) where is_read = false;
create index if not exists notifications_order_idx on notifications (order_id);
create index if not exists notifications_severity_idx on notifications (severity, created_at);

-- ============ Delivery log (per channel attempt) ============
create table if not exists notification_deliveries (
  id bigint generated always as identity primary key,
  notification_id uuid not null references notifications(id) on delete cascade,
  channel text not null,
  provider text,
  status text not null default 'pending',
  attempt integer not null default 0,
  max_attempts integer not null default 4,
  next_attempt_at timestamptz,
  provider_message_id text,
  error_code text,
  error_message text,
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists notification_deliveries_pending_idx on notification_deliveries (status, next_attempt_at) where status in ('pending', 'failed');

-- ============ Audit / debug logs ============
create table if not exists notification_logs (
  id bigint generated always as identity primary key,
  notification_id uuid,
  event text not null,
  channel text,
  level text not null default 'info',
  message text,
  payload jsonb,
  created_at timestamptz not null default now()
);

-- ============ Idempotent shipping tracking events ============
create table if not exists shipping_events (
  id bigint generated always as identity primary key,
  shipment_id text,
  order_id text,
  source text not null,
  external_event_id text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (source, external_event_id)
);
create index if not exists shipping_events_shipment_idx on shipping_events (shipment_id);

-- ============ RLS: new tables are service-role only (no anon access) ============
alter table notification_channels enable row level security;
alter table notification_events enable row level security;
alter table notification_templates enable row level security;
alter table notification_rules enable row level security;
alter table notification_preferences enable row level security;
alter table notifications enable row level security;
alter table notification_deliveries enable row level security;
alter table notification_logs enable row level security;
alter table shipping_events enable row level security;

-- Default channels + roles legend stored for reference
insert into notification_channels (code, name, enabled, config)
values
  ('in_app', 'داخل التطبيق', true, '{}'::jsonb),
  ('email', 'البريد الإلكتروني', false, '{}'::jsonb),
  ('sms', 'رسائل SMS', true, '{}'::jsonb),
  ('push', 'إشعارات المتصفح', false, '{}'::jsonb),
  ('whatsapp', 'واتساب', false, '{}'::jsonb)
on conflict (code) do nothing;

notify pgrst, 'reload schema';

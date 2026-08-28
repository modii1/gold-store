-- ============================================================
-- gold-store migration 016: internal analytics events tracking
-- Run ONCE in Supabase SQL Editor (after migration 015)
--
-- Lightweight, non-personal event analytics for the admin dashboard.
-- Stores anonymous visitor/session + event type only. No PII beyond the
-- anonymous IDs used to compute visitors/sessions; no names/phones/emails.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- ANALYTICS EVENTS ----------
create table if not exists analytics_events (
  id          uuid primary key default gen_random_uuid(),
  visitor_id  text not null,               -- anonymous browser-level ID
  session_id  text not null,               -- anonymous session ID (one per tab-session)
  event_type  text not null,               -- page_view | product_view | add_to_cart | remove_from_cart | checkout_start | purchase
  page_path   text,                        -- current page path e.g. /product/xyz
  product_id  uuid,
  product_slug text,
  referrer    text,                        -- external referrer (source)
  device_type text,                        -- mobile | tablet | desktop
  metadata    jsonb not null default '{}'::jsonb, -- small non-personal extras (qty, value, etc.)
  created_at  timestamptz not null default now()
);

create index if not exists idx_analytics_events_created  on analytics_events(created_at);
create index if not exists idx_analytics_events_visitor  on analytics_events(visitor_id);
create index if not exists idx_analytics_events_type     on analytics_events(event_type);
create index if not exists idx_analytics_events_product  on analytics_events(product_id);
create index if not exists idx_analytics_events_session  on analytics_events(session_id);

-- ---------- RLS ----------
alter table analytics_events enable row level security;

-- Anyone may record an event (fire-and-forget from the browser).
do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'public insert analytics_events') then
    create policy "public insert analytics_events" on analytics_events for insert with check (true);
  end if;
  -- Reads are restricted: only service_role (via the API) may read analytics.
  if not exists (select 1 from pg_policies where policyname = 'service read analytics_events') then
    create policy "service read analytics_events" on analytics_events for select to service_role using (true);
  end if;
end $$;

notify pgrst, 'reload schema';

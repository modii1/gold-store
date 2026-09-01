-- ============================================================
-- gold-store migration 025: per-screen control over the hero text overlay
-- (hide the hero title / subtitle / CTA like "تسوقي الآن" — keep the image
--  clean on selected screens. Run in Supabase SQL Editor.)
-- ============================================================
-- Purpose:
--   * Lets the admin hide the text overlay of the storefront hero
--     (hero_title, hero_subtitle, hero_cta_text "تسوقي الآن") independently
--     on mobile / tablet / desktop, keeping the hero image clean.
--   * Three independent booleans (one per screen size), no overlap so each
--     screen can be toggled separately as requested.
--   * Idempotent — safe to re-run.

alter table settings add column if not exists hero_hide_mobile   boolean not null default false;
alter table settings add column if not exists hero_hide_tablet   boolean not null default false;
alter table settings add column if not exists hero_hide_desktop  boolean not null default false;

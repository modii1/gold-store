-- ============================================================
-- gold-store migration 027: hero height + show/hide CTA button
-- (admin controls for the storefront hero height (small/medium/large/full
--  screen) and a toggle to show or hide the "تسوقي الآن" button.
--  Run in Supabase SQL Editor. Idempotent — safe to re-run.)
-- ============================================================
-- Purpose:
--   * hero_height : one of 'small' | 'medium' | 'large' | 'full'
--        small  = 420px, medium = 560px, large = 700px, full = 100dvh
--     Applied as a MIN-height on the hero section so the uploaded image is
--     never cropped and keeps its aspect ratio (image still flows at 100%
--     width with auto height).
--   * hero_show_cta : boolean, default true. false hides the Hero CTA button
--     ("تسوقي الآن") completely.

alter table settings add column if not exists hero_height    text    not null default 'medium';
alter table settings add column if not exists hero_show_cta boolean not null default true;

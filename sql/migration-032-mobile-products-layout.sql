-- ============================================================
-- gold-store migration 032: mobile products layout
-- Adds settings to control product display on mobile.
--  Run in Supabase SQL Editor. Idempotent -- safe to re-run.)
-- ============================================================

-- Default layout: "grid" or "horizontal"
ALTER TABLE settings ADD COLUMN IF NOT EXISTS mobile_products_layout text DEFAULT 'grid';

-- Allow end-user to toggle layout via icons on mobile
ALTER TABLE settings ADD COLUMN IF NOT EXISTS mobile_products_allow_user_toggle boolean DEFAULT false;

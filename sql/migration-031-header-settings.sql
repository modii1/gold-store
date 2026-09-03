-- ============================================================
-- gold-store migration 031: header settings
-- Independent header customization from the Settings page.
--  Run in Supabase SQL Editor. Idempotent — safe to re-run.)
-- ============================================================

-- Height and spacing
ALTER TABLE settings ADD COLUMN IF NOT EXISTS header_height integer;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS header_padding_top integer;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS header_padding_bottom integer;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS header_gap integer;

-- Logo
ALTER TABLE settings ADD COLUMN IF NOT EXISTS header_logo_width integer;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS header_logo_height integer;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS header_logo_align text;

-- Colors
ALTER TABLE settings ADD COLUMN IF NOT EXISTS header_bg_color text;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS header_text_color text;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS header_link_color text;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS header_link_hover_color text;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS header_icon_color text;
